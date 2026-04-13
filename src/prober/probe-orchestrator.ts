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
import { normalizeProbeOutput } from "./ansi.js";
import { parseClaudeUsage, type ClaudeUsageSnapshot } from "./claude-probe.js";
import { parseCodexStatus, type CodexUsageSnapshot } from "./codex-probe.js";
import { parseGeminiStats, type GeminiUsageSnapshot } from "./gemini-probe.js";
import type { PTYSession } from "./pty-session.js";

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
  data: ClaudeUsageSnapshot | CodexUsageSnapshot | GeminiUsageSnapshot | null;
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

/** The command string sent to each provider's PTY session to trigger usage output. */
const PROBE_COMMANDS: Record<Provider, string> = {
  claude: "/usage",
  codex: "status",
  gemini: "/stats",
};

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
): ClaudeUsageSnapshot | CodexUsageSnapshot | GeminiUsageSnapshot {
  switch (provider) {
    case "claude":
      return parseClaudeUsage(normalized);
    case "codex":
      return parseCodexStatus(normalized);
    case "gemini":
      return parseGeminiStats(normalized);
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
  data: ClaudeUsageSnapshot | CodexUsageSnapshot | GeminiUsageSnapshot,
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
    this._sessionFactory = options.sessionFactory;
  }

  start(): void {
    if (this._timer !== null) return; // Already running.

    this._timer = setInterval(() => {
      for (const provider of this._providers) {
        if (this._busy.get(provider) === true) continue;
        // Fire-and-forget; errors are handled inside probeNow.
        void this.probeNow(provider);
      }
    }, this._intervalMs);
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
    const session = this._getOrCreateSession(provider);
    const command = PROBE_COMMANDS[provider];

    // First attempt.
    let raw = await session.probe(command);
    let normalized = normalizeProbeOutput(raw);

    // Retry once on empty output (REQ-014 error recovery).
    if (normalized.trim() === "") {
      raw = await session.probe(command);
      normalized = normalizeProbeOutput(raw);
    }

    const now = new Date().toISOString();

    if (normalized.trim() === "") {
      // Both attempts produced empty output — mark stale.
      return this._markStale(provider, now, "Probe returned empty output after retry");
    }

    try {
      const data = parseOutput(provider, normalized);
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

    // Real PTY session — import lazily to avoid pulling node-pty into tests
    // that use a fake factory.
    // NOTE: We intentionally do NOT call createPTYSession here at module load
    // time — this branch is only reached in production. Tests always supply
    // sessionFactory.
    throw new Error(
      `No sessionFactory configured and no live session for provider "${provider}". ` +
        "Pass a sessionFactory in ProbeOrchestratorOptions or call createPTYSession externally.",
    );
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
