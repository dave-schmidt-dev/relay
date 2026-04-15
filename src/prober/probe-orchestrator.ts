/**
 * Usage probe orchestrator.
 *
 * Manages periodic probing of all configured providers, snapshot caching,
 * stale detection, and error recovery across PTY sessions.
 *
 * Key responsibilities (REQ-001, REQ-014):
 *  - Configurable probe interval (default 120 s)
 *  - Independent per-provider probing
 *  - Snapshot caching: on failure hold last good snapshot and mark stale
 *  - Stale expiration: after 30 min mark provider unavailable
 *  - Probe-task mutual exclusion: skip probe if provider is busy
 *  - Error recovery: retry once on empty output before marking failed
 *  - Persist snapshots to globalStoragePath/snapshots.json after each update
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { Provider } from "../core/types.js";
import { parseClaudeUsage, type ClaudeUsageSnapshot } from "./claude-probe.js";
import { parseCodexStatus, type CodexUsageSnapshot } from "./codex-probe.js";
import { parseGeminiStats, type GeminiUsageSnapshot } from "./gemini-probe.js";
import { parseGithubUsage, type GithubUsageSnapshot } from "./github-probe.js";
import { createPTYSession, type PTYSession } from "./pty-session.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UsageSnapshot {
  provider: Provider;
  probedAt: string;
  source: "probe" | "cached";
  exhausted: boolean;
  error: string | null;
  stale: boolean;
  staleSince: string | null;
  data: ClaudeUsageSnapshot | CodexUsageSnapshot | GeminiUsageSnapshot | GithubUsageSnapshot | null;
}

export interface ProbeOrchestratorOptions {
  /** How often to probe each provider. Default: 120000 ms (2 min). */
  intervalMs?: number;
  /** How long a stale snapshot survives before the provider is marked unavailable. Default: 1800000 ms (30 min). */
  staleExpirationMs?: number;
  /** Directory for persisting snapshots.json. Typically ~/.relay/usage/. */
  globalStoragePath: string;
  /** Which providers to probe. */
  providers: Provider[];
  /** Environment variables to allow in PTY sessions. */
  envAllowlist?: string[];
  /** Working directory for PTY sessions. */
  projectRoot?: string;
  /**
   * Optional factory for creating PTY sessions.
   *
   * Production code passes undefined and the orchestrator creates real PTY
   * sessions internally. Tests pass a fake factory that returns pre-configured
   * mock sessions so no real CLIs are spawned.
   */
  sessionFactory?: (provider: Provider) => PTYSession;
}

export interface ProbeOrchestrator {
  /** Start periodic probing for all configured providers. */
  start(): void;

  /** Stop probing and clean up all PTY sessions. */
  stop(): Promise<void>;

  /** Trigger an immediate probe for a specific provider. */
  probeNow(provider: Provider): Promise<UsageSnapshot>;

  /** Get the latest cached snapshot for a provider, or null if none. */
  getSnapshot(provider: Provider): UsageSnapshot | null;

  /** Get all cached snapshots. */
  getAllSnapshots(): Map<Provider, UsageSnapshot>;

  /** Mark a provider as busy so its next scheduled probe is skipped. */
  setProviderBusy(provider: Provider, busy: boolean): void;
}

// ---------------------------------------------------------------------------
// Provider probe commands
// ---------------------------------------------------------------------------

/** Mapping from provider ID to CLI executable name. */
const PROVIDER_BINARIES: Record<Provider, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  github: "copilot",
};

/** Common trust prompts to auto-answer during PTY probing. */
const TRUST_PROMPTS = [
  { pattern: /trust the files in this folder/i, response: "y" },
  { pattern: /Quick safety check/i, response: "" },
  { pattern: /Yes, I trust this folder/i, response: "" },
  { pattern: /Ready to code here/i, response: "" },
  { pattern: /Press Enter to continue/i, response: "" },
  // Extra Claude menus
  { pattern: /Show plan usage limits/i, response: "" },
  { pattern: /Show plan/i, response: "" },
  { pattern: /Show Claude Code status/i, response: "" },
  { pattern: /Show Claude Code/i, response: "" },
];

/** The command string sent to each provider's PTY session to trigger usage output. */
const PROBE_COMMANDS: Record<Provider, string> = {
  claude: "/usage",
  codex: "/status",
  gemini: "/stats",
  github: "", // GitHub Copilot CLI shows stats in startup banner
};

/** Providers whose stats appear in startup banner and thus need a fresh session each probe. */
const RESTART_ON_PROBE: Provider[] = ["github", "gemini"];

// ---------------------------------------------------------------------------
// Parsing dispatch
// ---------------------------------------------------------------------------

/**
 * Parse normalized probe output for the given provider.
 *
 * Throws if the parser detects an error condition (rate limit, empty output, etc.).
 */
function parseOutput(
  provider: Provider,
  normalized: string,
): ClaudeUsageSnapshot | CodexUsageSnapshot | GeminiUsageSnapshot | GithubUsageSnapshot {
  switch (provider) {
    case "claude":
      return parseClaudeUsage(normalized);
    case "codex":
      return parseCodexStatus(normalized);
    case "gemini":
      return parseGeminiStats(normalized);
    case "github":
      return parseGithubUsage(normalized);
  }
}

/**
 * Determine whether a parsed snapshot represents an exhausted quota.
 *
 * For claude: exhausted if sessionPercentLeft === 0
 * For codex: exhausted if fiveHourPercentLeft === 0 or weeklyPercentLeft === 0
 * For gemini: exhausted if flashPercentLeft === 0 or proPercentLeft === 0
 */
function isExhausted(
  provider: Provider,
  data: ClaudeUsageSnapshot | CodexUsageSnapshot | GeminiUsageSnapshot | GithubUsageSnapshot,
): boolean {
  switch (provider) {
    case "claude": {
      const d = data as ClaudeUsageSnapshot;
      return d.sessionPercentLeft === 0 || d.weeklyPercentLeft === 0;
    }
    case "codex": {
      const d = data as CodexUsageSnapshot;
      return d.fiveHourPercentLeft === 0 || d.weeklyPercentLeft === 0;
    }
    case "gemini": {
      const d = data as GeminiUsageSnapshot;
      return d.flashPercentLeft === 0 || d.proPercentLeft === 0;
    }
    case "github": {
      const d = data as GithubUsageSnapshot;
      return d.premiumPercentLeft === 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ProbeOrchestratorImpl implements ProbeOrchestrator {
  private readonly _intervalMs: number;
  private readonly _staleExpirationMs: number;
  private readonly _storagePath: string;
  private readonly _providers: Provider[];
  private readonly _envAllowlist: string[];
  private readonly _projectRoot: string;
  private readonly _sessionFactory: ((provider: Provider) => PTYSession) | undefined;

  private readonly _snapshots = new Map<Provider, UsageSnapshot>();
  private readonly _sessions = new Map<Provider, PTYSession>();
  private readonly _busy = new Map<Provider, boolean>();

  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ProbeOrchestratorOptions) {
    this._intervalMs = options.intervalMs ?? 120_000;
    this._staleExpirationMs = options.staleExpirationMs ?? 1_800_000;
    this._storagePath = options.globalStoragePath;
    this._providers = options.providers;
    this._envAllowlist = options.envAllowlist ?? [];
    this._projectRoot = options.projectRoot ?? process.cwd();
    this._sessionFactory = options.sessionFactory;
  }

  start(): void {
    if (this._timer !== null) return; // Already running.

    const runProbes = () => {
      for (const provider of this._providers) {
        if (this._busy.get(provider) === true) continue;
        // Fire-and-forget; errors are handled inside probeNow.
        void this.probeNow(provider).catch((err: unknown) => {
          console.error(`[probe-orchestrator] Immediate probe failed for ${provider}:`, err);
        });
      }
    };

    // Run first probe immediately
    runProbes();

    this._timer = setInterval(runProbes, this._intervalMs);
  }

  stop(): Promise<void> {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }

    for (const session of this._sessions.values()) {
      if (session.isAlive()) {
        session.destroy();
      }
    }
    this._sessions.clear();
    return Promise.resolve();
  }

  async probeNow(provider: Provider): Promise<UsageSnapshot> {
    if (RESTART_ON_PROBE.includes(provider)) {
      const existing = this._sessions.get(provider);
      if (existing) {
        existing.destroy();
        this._sessions.delete(provider);
      }
    }

    const session = this._getOrCreateSession(provider);
    const now = new Date().toISOString();

    try {
      if (provider === "claude") {
        // EXACT ai_monitor sequence: warmup -> /usage -> /status
        // Warmup: timeout 4.0, idle 900ms
        await session.probe("", 900);

        // Usage: timeout 24.0, stop substrings, idle 2000ms
        const usageRaw = await session.probe("/usage", 2000, [
          "Current session",
          "Current week (all models)",
          "Failed to load usage data",
          "failed to load usage data",
          "failedtoloadusagedata",
          "/usage is only",
          "/usageisonly",
        ]);

        // Status: timeout 12.0, idle 3000ms
        const statusRaw = await session.probe("/status", 3000);

        const data = parseClaudeUsage(usageRaw, statusRaw);

        const snapshot: UsageSnapshot = {
          provider,
          probedAt: now,
          source: "probe",
          exhausted: isExhausted(provider, data),
          error: null,
          stale: false,
          staleSince: null,
          data,
        };
        this._snapshots.set(provider, snapshot);
        this._persistSnapshots();
        return snapshot;
      }

      if (provider === "github") {
        // EXACT ai_monitor sequence: warmup -> second capture
        // Warmup (capture startup banner): timeout 20.0, stop substrings, idle 2500ms
        const warmupRaw = await session.probe("", 2500, [
          "Environment loaded:",
          "Type your message",
        ]);

        // Second capture (extra stats): timeout 8.0, stop substrings, idle 1800ms
        const extraRaw = await session.probe("", 1800, ["Requests", "Premium"]);

        const merged = `${warmupRaw}\n${extraRaw}`;
        const data = parseGithubUsage(merged);
        data.premiumReset = this._getGithubResetLabel();

        const snapshot: UsageSnapshot = {
          provider,
          probedAt: now,
          source: "probe",
          exhausted: isExhausted(provider, data),
          error: null,
          stale: false,
          staleSince: null,
          data,
        };
        this._snapshots.set(provider, snapshot);
        this._persistSnapshots();
        return snapshot;
      }

      if (provider === "gemini") {
        // EXACT ai_monitor sequence: warmup -> /stats
        // Warmup: timeout 5.0, idle 1000ms
        await session.probe("", 1000);

        // Stats: timeout 10.0, stop substrings, idle 2200ms
        const statsRaw = await session.probe("/stats", 2200, [
          "Session Stats",
          "Usage remaining",
          "gemini-2.5-pro",
          "gemini-3.1-pro-preview",
        ]);

        const data = parseGeminiStats(statsRaw);

        const snapshot: UsageSnapshot = {
          provider,
          probedAt: now,
          source: "probe",
          exhausted: isExhausted(provider, data),
          error: null,
          stale: false,
          staleSince: null,
          data,
        };
        this._snapshots.set(provider, snapshot);
        this._persistSnapshots();
        return snapshot;
      }

      if (provider === ("codex" as Provider)) {
        // EXACT ai_monitor sequence: warmup -> /status
        // Warmup: timeout 4.0, idle 1000ms
        await session.probe("", 1000);

        // Status: timeout 18.0, stop substrings, idle 3500ms
        const statusRaw = await session.probe("/status", 3500, [
          "Credits:",
          "5h limit",
          "5-hour limit",
          "Weekly limit",
        ]);

        const data = parseCodexStatus(statusRaw);
        const snapshot: UsageSnapshot = {
          provider,
          probedAt: now,
          source: "probe",
          exhausted: isExhausted(provider, data),
          error: null,
          stale: false,
          staleSince: null,
          data,
        };
        this._snapshots.set(provider, snapshot);
        this._persistSnapshots();
        return snapshot;
      }

      // Default (should not be reached if all Providers are handled above)
      const command = PROBE_COMMANDS[provider];
      const raw = await session.probe(command);
      const data = parseOutput(provider, raw);

      const snapshot: UsageSnapshot = {
        provider,
        probedAt: now,
        source: "probe",
        exhausted: isExhausted(provider, data),
        error: null,
        stale: false,
        staleSince: null,
        data,
      };
      this._snapshots.set(provider, snapshot);
      this._persistSnapshots();
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this._markStale(provider, now, message);
    }
  }

  getSnapshot(provider: Provider): UsageSnapshot | null {
    return this._snapshots.get(provider) ?? null;
  }

  getAllSnapshots(): Map<Provider, UsageSnapshot> {
    // Return a copy so callers can't mutate the internal map.
    return new Map(this._snapshots);
  }

  setProviderBusy(provider: Provider, busy: boolean): void {
    this._busy.set(provider, busy);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Get the existing PTY session for a provider, or create a new one.
   *
   * When a sessionFactory is provided (e.g. in tests), it is used instead of
   * spawning a real provider CLI.
   */
  private _getOrCreateSession(provider: Provider): PTYSession {
    const existing = this._sessions.get(provider);
    if (existing?.isAlive() === true) {
      return existing;
    }

    if (this._sessionFactory !== undefined) {
      const session = this._sessionFactory(provider);
      this._sessions.set(provider, session);
      return session;
    }

    // Real PTY session for production
    const session = createPTYSession({
      executable: PROVIDER_BINARIES[provider],
      cwd: this._projectRoot,
      envAllowlist: this._envAllowlist,
      autoResponses: TRUST_PROMPTS,
      idleTimeoutMs: 15_000, // Reasonable timeout for probe commands
    });
    this._sessions.set(provider, session);
    return session;
  }

  /**
   * Update or create a stale snapshot for a provider.
   *
   * If a previous good snapshot exists, it is preserved in .data with source
   * changed to "cached". If the stale window has expired, exhausted is set to
   * true to signal unavailability.
   */
  private _markStale(provider: Provider, now: string, errorMessage: string): UsageSnapshot {
    const existing = this._snapshots.get(provider);

    // Determine staleSince: use existing staleSince if already stale,
    // otherwise start the clock now.
    const staleSince = existing?.stale === true ? (existing.staleSince ?? now) : now;

    const staleAgeMs = new Date(now).getTime() - new Date(staleSince).getTime();
    const expired = staleAgeMs >= this._staleExpirationMs;

    const snapshot: UsageSnapshot = {
      provider,
      probedAt: now,
      source: "cached",
      // Mark exhausted when the stale window expires — provider is unavailable.
      exhausted: expired || (existing?.exhausted ?? false),
      error: errorMessage,
      stale: true,
      staleSince,
      data: existing?.data ?? null,
    };

    this._snapshots.set(provider, snapshot);
    this._persistSnapshots();
    return snapshot;
  }

  /**
   * Serialize all snapshots to globalStoragePath/snapshots.json.
   *
   * Creates the directory if it does not exist. Errors are swallowed with a
   * console.error so a disk-write failure does not crash the probe cycle.
   */
  private _persistSnapshots(): void {
    try {
      fs.mkdirSync(this._storagePath, { recursive: true });
      const filePath = path.join(this._storagePath, "snapshots.json");
      const payload = Object.fromEntries(this._snapshots.entries());
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      // NOTE: Swallow — disk errors must not stall the probe cycle.
      console.error("[probe-orchestrator] Failed to persist snapshots:", err);
    }
  }

  private _getGithubResetLabel(): string {
    const now = new Date();
    const year = now.getUTCFullYear() + (now.getUTCMonth() === 11 ? 1 : 0);
    const month = (now.getUTCMonth() + 1) % 12;
    const reset = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const monthName = reset.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day = reset.getUTCDate().toString().padStart(2, "0");
    return `Resets ${monthName} ${day} 12:00 AM UTC`;
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a new ProbeOrchestrator.
 *
 * Call .start() after construction to begin periodic probing.
 */
export function createProbeOrchestrator(options: ProbeOrchestratorOptions): ProbeOrchestrator {
  return new ProbeOrchestratorImpl(options);
}
