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
  it("returns empty snapshots on creation", () => {
    const orch = createProbeOrchestrator({
      providers: ["claude", "codex", "gemini"],
      globalStoragePath: tmpDir,
      sessionFactory: () => makeFakeSession([]),
    });

    const all = orch.getAllSnapshots();
    expect(all.size).toBe(0);
    expect(orch.getSnapshot("claude")).toBeNull();
  });
});

describe("ProbeOrchestrator: probeNow with golden fixtures", () => {
  it("returns correct snapshots from clean fixtures for all providers", async () => {
    // Claude
    const claudeRaw = readFixture("claude", "usage-probe-clean.txt");
    const claudeSessions = new Map<Provider, PTYSession>([
      ["claude", makeFakeSession([claudeRaw])],
    ]);
    const claudeOrch = makeOrchestrator(["claude"], claudeSessions);
    const claudeSnap = await claudeOrch.probeNow("claude");

    expect(claudeSnap.provider).toBe("claude");
    expect(claudeSnap.source).toBe("probe");
    expect(claudeSnap.stale).toBe(false);
    expect(claudeSnap.error).toBeNull();
    expect(claudeSnap.staleSince).toBeNull();
    expect(claudeSnap.data).not.toBeNull();
    const claudeData = claudeSnap.data as { sessionPercentLeft: number; weeklyPercentLeft: number };
    expect(claudeData.sessionPercentLeft).toBe(73);
    expect(claudeData.weeklyPercentLeft).toBe(64);

    // Codex
    const codexRaw = readFixture("codex", "status-probe-clean.txt");
    const codexSessions = new Map<Provider, PTYSession>([["codex", makeFakeSession([codexRaw])]]);
    const codexOrch = makeOrchestrator(["codex"], codexSessions);
    const codexSnap = await codexOrch.probeNow("codex");

    expect(codexSnap.provider).toBe("codex");
    expect(codexSnap.source).toBe("probe");
    expect(codexSnap.stale).toBe(false);
    expect(codexSnap.error).toBeNull();
    const codexData = codexSnap.data as { credits: number; fiveHourPercentLeft: number };
    expect(codexData.credits).toBe(12.5);
    expect(codexData.fiveHourPercentLeft).toBe(68);

    // Gemini
    const geminiRaw = readFixture("gemini", "stats-probe-clean.txt");
    const geminiSessions = new Map<Provider, PTYSession>([
      ["gemini", makeFakeSession([geminiRaw])],
    ]);
    const geminiOrch = makeOrchestrator(["gemini"], geminiSessions);
    const geminiSnap = await geminiOrch.probeNow("gemini");

    expect(geminiSnap.provider).toBe("gemini");
    expect(geminiSnap.source).toBe("probe");
    expect(geminiSnap.stale).toBe(false);
    expect(geminiSnap.error).toBeNull();
    const geminiData = geminiSnap.data as { flashPercentLeft: number; proPercentLeft: number };
    expect(geminiData.flashPercentLeft).toBe(98);
    expect(geminiData.proPercentLeft).toBe(83);
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
  it("retries on empty output and returns stale snapshot; also handles parser errors", async () => {
    // Empty output case
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession(["", ""])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    const snap = await orch.probeNow("claude");

    expect(snap.stale).toBe(true);
    expect(snap.error).toMatch(/empty/i);
    expect(snap.source).toBe("cached");
    expect(snap.data).toBeNull();

    // Parser error case
    const sessions2 = new Map<Provider, PTYSession>([
      ["claude", makeFakeSession(["rate limit exceeded", "rate limit exceeded"])],
    ]);
    const orch2 = makeOrchestrator(["claude"], sessions2);

    const snap2 = await orch2.probeNow("claude");

    expect(snap2.stale).toBe(true);
    expect(snap2.error).not.toBeNull();
    expect(snap2.source).toBe("cached");
  });

  it("preserves last good snapshot in data when probe fails", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession([raw, "", ""])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    await orch.probeNow("claude");
    const snap = await orch.probeNow("claude");

    expect(snap.stale).toBe(true);
    expect(snap.data).not.toBeNull();
    const data = snap.data as { sessionPercentLeft: number };
    expect(data.sessionPercentLeft).toBe(73);
  });
});

describe("ProbeOrchestrator: stale expiration", () => {
  it("marks exhausted=true when staleSince exceeds staleExpirationMs", async () => {
    const fakeSession = makeFakeSession(["", "", "", ""]);
    const orch = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      staleExpirationMs: 0,
      sessionFactory: (_p) => fakeSession,
    });

    const snap1 = await orch.probeNow("claude");
    expect(snap1.stale).toBe(true);

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

    expect(snap1.staleSince).not.toBeNull();
    expect(snap2.staleSince).toBe(snap1.staleSince);
  });
});

describe("ProbeOrchestrator: setProviderBusy", () => {
  it("busy provider is skipped by interval but probeNow still works; clearing works", async () => {
    const raw = readFixture("claude", "usage-probe-clean.txt");
    const sessions = new Map<Provider, PTYSession>([["claude", makeFakeSession([raw])]]);
    const orch = makeOrchestrator(["claude"], sessions);

    orch.setProviderBusy("claude", true);

    const snap = await orch.probeNow("claude");
    expect(snap.stale).toBe(false);
    expect(snap.source).toBe("probe");

    // Clearing does not throw
    orch.setProviderBusy("claude", false);
  });
});

describe("ProbeOrchestrator: stop()", () => {
  it("destroys all active PTY sessions and can be called twice", async () => {
    const session = makeFakeSession([readFixture("claude", "usage-probe-clean.txt")]);
    const sessions = new Map<Provider, PTYSession>([["claude", session]]);
    const orch = makeOrchestrator(["claude"], sessions);

    await orch.probeNow("claude");
    expect(session.isAlive()).toBe(true);

    await orch.stop();
    expect(session.isAlive()).toBe(false);

    // Second stop does not throw
    const orch2 = createProbeOrchestrator({
      providers: ["claude"],
      globalStoragePath: tmpDir,
      sessionFactory: () => makeFakeSession([]),
    });
    orch2.start();
    await orch2.stop();
    await expect(orch2.stop()).resolves.toBeUndefined();
  });
});

describe("ProbeOrchestrator: snapshot persistence", () => {
  it("persists snapshots.json after successful and stale probes", async () => {
    // Successful probe
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

    // Stale probe
    const sessions2 = new Map<Provider, PTYSession>([["claude", makeFakeSession(["", ""])]]);
    const orch2 = makeOrchestrator(["claude"], sessions2);

    await orch2.probeNow("claude");

    const raw3 = fs.readFileSync(filePath, "utf8");
    const parsed2 = JSON.parse(raw3) as Record<string, UsageSnapshot>;
    const staleSnap = parsed2.claude;
    expect(staleSnap?.stale).toBe(true);
    expect(staleSnap?.error).not.toBeNull();
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
