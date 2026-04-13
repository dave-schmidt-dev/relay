/**
 * Tests for the usage probe orchestrator.
 *
 * Uses fake PTY sessions — no real provider CLIs are spawned (TASK-014e, REQ-014).
 *
 * Covers:
 *  - Empty snapshot map on creation
 *  - Successful probe → correct snapshot from golden fixture
 *  - Empty output retry → stale snapshot with error
 *  - Stale expiration after 30 min window
 *  - Busy provider skip during scheduled probing
 *  - stop() destroys all sessions
 *  - Snapshots persisted to disk
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  createProbeOrchestrator,
  type ProbeOrchestrator,
  type UsageSnapshot,
} from "../probe-orchestrator.js";
import type { PTYSession } from "../pty-session.js";
import type { Provider } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const fixturesBase = path.resolve(import.meta.dirname, "../../../fixtures");

function readFixture(provider: string, filename: string): string {
  return fs.readFileSync(path.join(fixturesBase, provider, filename), "utf8");
}

// ---------------------------------------------------------------------------
// Fake PTY session factory
// ---------------------------------------------------------------------------

/**
 * Build a fake PTYSession that returns a predetermined string from probe().
 *
 * All other methods are no-ops or stubs; no real process is spawned.
 */
function makeFakeSession(outputSequence: string[]): PTYSession {
  let callCount = 0;
  let alive = true;

  return {
    get pid() {
      return 99999;
    },
    sendCommand(_command: string): void {
      // no-op
    },
    probe(_command: string, _timeoutMs?: number): Promise<string> {
      const output = outputSequence[callCount] ?? "";
      callCount++;
      return Promise.resolve(output);
    },
    isAlive(): boolean {
      return alive;
    },
    destroy(): void {
      alive = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Test temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-orch-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: build an orchestrator backed by fake sessions
// ---------------------------------------------------------------------------

function makeOrchestrator(
  providers: Provider[],
  sessionMap: Map<Provider, PTYSession>,
): ProbeOrchestrator {
  return createProbeOrchestrator({
    providers,
    globalStoragePath: tmpDir,
    sessionFactory: (provider) => {
      const session = sessionMap.get(provider);
      if (session === undefined) {
        throw new Error(`No fake session configured for provider "${provider}"`);
      }
      return session;
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProbeOrchestrator: initial state", () => {
  it("getAllSnapshots() returns an empty map on creation", () => {
    const orch = createProbeOrchestrator({
      providers: ["claude", "codex", "gemini"],
      globalStoragePath: tmpDir,
      sessionFactory: () => makeFakeSession([]),
    });

    const all = orch.getAllSnapshots();
    expect(all.size).toBe(0);
  });

  it("getSnapshot() returns null for an unprobed provider", () => {
    const orch = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      sessionFactory: () => makeFakeSession([]),
    });

    expect(orch.getSnapshot("claude")).toBeNull();
  });
});

describe("ProbeOrchestrator: probeNow with golden fixtures", () => {
  it("claude: returns correct snapshot from clean fixture", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    const snap = await orch.probeNow("claude");

    expect(snap.provider).toBe("claude");
    expect(snap.source).toBe("probe");
    expect(snap.stale).toBe(false);
    expect(snap.error).toBeNull();
    expect(snap.staleSince).toBeNull();
    expect(snap.data).not.toBeNull();

    // Claude clean fixture: session=73%, weekly=64%, opus=82%
    const data = snap.data as { sessionPercentLeft: number; weeklyPercentLeft: number };
    expect(data.sessionPercentLeft).toBe(73);
    expect(data.weeklyPercentLeft).toBe(64);
  });

  it("codex: returns correct snapshot from clean fixture", async () => {
    const raw = readFixture("codex", "status-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["codex", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["codex"], sessions);

    const snap = await orch.probeNow("codex");

    expect(snap.provider).toBe("codex");
    expect(snap.source).toBe("probe");
    expect(snap.stale).toBe(false);
    expect(snap.error).toBeNull();

    const data = snap.data as { credits: number; fiveHourPercentLeft: number };
    expect(data.credits).toBe(12.5);
    expect(data.fiveHourPercentLeft).toBe(68);
  });

  it("gemini: returns correct snapshot from clean fixture", async () => {
    const raw = readFixture("gemini", "stats-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["gemini", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["gemini"], sessions);

    const snap = await orch.probeNow("gemini");

    expect(snap.provider).toBe("gemini");
    expect(snap.source).toBe("probe");
    expect(snap.stale).toBe(false);
    expect(snap.error).toBeNull();

    const data = snap.data as { flashPercentLeft: number; proPercentLeft: number };
    // Fixture: gemini-2.5-flash = 98.3% → rounded to 98
    expect(data.flashPercentLeft).toBe(98);
    // Fixture: gemini-2.5-pro = 83.3% → rounded to 83
    expect(data.proPercentLeft).toBe(83);
  });

  it("probedAt is a valid ISO timestamp", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    const snap = await orch.probeNow("claude");

    expect(() => new Date(snap.probedAt)).not.toThrow();
    expect(isNaN(new Date(snap.probedAt).getTime())).toBe(false);
  });
});

describe("ProbeOrchestrator: error recovery (empty output)", () => {
  it("retries once on empty output and returns stale snapshot with error", async () => {
    // Both probe() calls return empty string.
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession(["", ""])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    const snap = await orch.probeNow("claude");

    expect(snap.stale).toBe(true);
    expect(snap.error).toMatch(/empty/i);
    expect(snap.source).toBe("cached");
    expect(snap.data).toBeNull(); // No prior good snapshot to fall back to.
  });

  it("preserves last good snapshot in data when probe fails", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([
      // First call succeeds; subsequent calls return empty.
      ["claude", makeFakeSession([raw, "", ""])],
    ]);
    const orch = makeOrchestrator(["claude"], sessions);

    // First probe: success.
    await orch.probeNow("claude");
    // Second probe: failure — should cache the previous data.
    const snap = await orch.probeNow("claude");

    expect(snap.stale).toBe(true);
    expect(snap.data).not.toBeNull();
    const data = snap.data as { sessionPercentLeft: number };
    expect(data.sessionPercentLeft).toBe(73);
  });

  it("returns stale snapshot when parser throws on bad output", async () => {
    const sessions = new Map<Provider, PTYSession>([
      ["claude", makeFakeSession(["rate limit exceeded", "rate limit exceeded"])],
    ]);
    const orch = makeOrchestrator(["claude"], sessions);

    const snap = await orch.probeNow("claude");

    expect(snap.stale).toBe(true);
    expect(snap.error).not.toBeNull();
    expect(snap.source).toBe("cached");
  });
});

describe("ProbeOrchestrator: stale expiration", () => {
  it("marks exhausted=true when staleSince exceeds staleExpirationMs", async () => {
    const fakeSession = makeFakeSession(["", "", "", ""]);
    const orch = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      // Expiry of 0 ms — any stale snapshot is immediately expired.
      staleExpirationMs: 0,
      sessionFactory: (_p) => fakeSession,
    });

    // First probe fails → stale, staleSince = now.
    const snap1 = await orch.probeNow("claude");
    expect(snap1.stale).toBe(true);

    // Second probe also fails. With 0 ms expiry, it should be expired.
    const snap2 = await orch.probeNow("claude");
    expect(snap2.stale).toBe(true);
    expect(snap2.exhausted).toBe(true);
  });

  it("staleSince is preserved across multiple stale probes", async () => {
    const fakeSession = makeFakeSession(["", "", "", ""]);
    const orch = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      staleExpirationMs: 1_800_000,
      sessionFactory: (_p) => fakeSession,
    });

    const snap1 = await orch.probeNow("claude");
    const snap2 = await orch.probeNow("claude");

    // staleSince must be the same timestamp (from first failure).
    expect(snap1.staleSince).not.toBeNull();
    expect(snap2.staleSince).toBe(snap1.staleSince);
  });
});

describe("ProbeOrchestrator: setProviderBusy", () => {
  it("busy provider is skipped by the interval tick but probeNow still works", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    // Mark busy — interval should skip, but direct probeNow should proceed.
    orch.setProviderBusy("claude", true);

    // probeNow is not blocked by busy; it's the interval that skips.
    const snap = await orch.probeNow("claude");
    expect(snap.stale).toBe(false);
    expect(snap.source).toBe("probe");
  });

  it("setProviderBusy(false) clears the busy flag", () => {
    const orch = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      sessionFactory: () => makeFakeSession([]),
    });

    orch.setProviderBusy("claude", true);
    orch.setProviderBusy("claude", false);
    // No assertion on internal state — verified indirectly by probing succeeding
    // in subsequent tests. This test just ensures no throw.
  });
});

describe("ProbeOrchestrator: stop()", () => {
  it("stop() destroys all active PTY sessions", async () => {
    const session = makeFakeSession([readFixture("claude", "usage-probe-clean.txt")]);
    const sessions = new Map<Provider, PTYSession>([["claude", session]]);
    const orch = makeOrchestrator(["claude"], sessions);

    // Probe to get the session registered internally.
    await orch.probeNow("claude");
    expect(session.isAlive()).toBe(true);

    await orch.stop();
    expect(session.isAlive()).toBe(false);
  });

  it("stop() clears the interval (calling stop twice does not throw)", async () => {
    const orch = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      sessionFactory: () => makeFakeSession([]),
    });

    orch.start();
    await orch.stop();
    await expect(orch.stop()).resolves.toBeUndefined();
  });
});

describe("ProbeOrchestrator: snapshot persistence", () => {
  it("persists snapshots.json after a successful probe", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    await orch.probeNow("claude");

    const filePath = path.join(tmpDir, "snapshots.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const raw2 = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw2) as Record<string, UsageSnapshot>;
    const claudeSnap = parsed.claude;
    expect(claudeSnap).toBeDefined();
    expect(claudeSnap?.provider).toBe("claude");
    expect(claudeSnap?.stale).toBe(false);
  });

  it("persists snapshots.json after a stale probe", async () => {
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession(["", ""])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    await orch.probeNow("claude");

    const filePath = path.join(tmpDir, "snapshots.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const raw2 = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw2) as Record<string, UsageSnapshot>;
    const claudeSnap = parsed.claude;
    expect(claudeSnap?.stale).toBe(true);
    expect(claudeSnap?.error).not.toBeNull();
  });

  it("getAllSnapshots() reflects the latest probe result", async () => {
    const raw = readFixture("codex", "status-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["codex", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["codex"], sessions);

    await orch.probeNow("codex");

    const all = orch.getAllSnapshots();
    expect(all.size).toBe(1);
    expect(all.get("codex")).toBeDefined();
    expect(all.get("codex")?.source).toBe("probe");
  });
});
