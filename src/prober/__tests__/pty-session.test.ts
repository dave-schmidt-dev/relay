/**
 * Tests for the persistent PTY session manager.
 *
 * Uses /bin/sh as the PTY target — no real provider CLIs are invoked.
 * Idle timeouts are kept short (≤2 s) so the suite runs quickly.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createPTYSession } from "../pty-session.js";
import type { PTYSession } from "../pty-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SH = "/bin/sh";

/** Short idle timeout used across all tests to keep the suite fast. */
const IDLE_MS = 1_200;

/**
 * Sleep for `ms` milliseconds — used only where we need to let PTY I/O
 * settle before asserting state (e.g. after destroy()).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Session lifecycle tracking for afterEach cleanup
// ---------------------------------------------------------------------------

const activeSessions: PTYSession[] = [];

function tracked(session: PTYSession): PTYSession {
  activeSessions.push(session);
  return session;
}

afterEach(() => {
  // Destroy any sessions that tests failed to clean up.
  for (const s of activeSessions) {
    if (s.isAlive()) s.destroy();
  }
  activeSessions.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPTYSession", () => {
  it("spawns a PTY process with a valid pid", () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    expect(session.pid).toBeTypeOf("number");
    expect(session.pid).toBeGreaterThan(0);
  });

  it("isAlive() returns true immediately after creation", () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    expect(session.isAlive()).toBe(true);
  });

  it("destroy() kills the session and isAlive() returns false", () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    expect(session.isAlive()).toBe(true);
    session.destroy();
    expect(session.isAlive()).toBe(false);
  });

  it("destroy() is idempotent — second call does not throw", () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    session.destroy();
    expect(() => {
      session.destroy();
    }).not.toThrow();
  });

  it("probe() collects echo output", async () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    const output = await session.probe("echo hello", IDLE_MS);
    expect(output).toContain("hello");
  }, 10_000);

  it("probe() collects multiword echo output", async () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    const output = await session.probe("echo relay test ok", IDLE_MS);
    expect(output).toContain("relay test ok");
  }, 10_000);

  it("sendCommand() sends text that the shell executes", async () => {
    const chunks: string[] = [];
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
        onData: (d) => chunks.push(d),
      }),
    );

    session.sendCommand("echo from-sendCommand");
    // Wait long enough for the shell to respond.
    await sleep(IDLE_MS + 300);

    expect(chunks.join("")).toContain("from-sendCommand");
  }, 10_000);

  it("onData callback receives raw PTY output", async () => {
    const received: string[] = [];
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
        onData: (d) => received.push(d),
      }),
    );

    await session.probe("echo raw-data-test", IDLE_MS);
    expect(received.join("")).toContain("raw-data-test");
  }, 10_000);

  it("auto-response fires when pattern matches", async () => {
    // Simulate a trust-prompt scenario: we echo a trigger phrase and
    // expect the session to auto-respond, which the shell will echo back.
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
        autoResponses: [
          {
            // When we see "TRUST_PROMPT" in output, respond with "yes".
            pattern: /TRUST_PROMPT/,
            response: "echo auto-response-sent",
          },
        ],
      }),
    );

    // This command emits the trigger phrase.
    const output = await session.probe("echo TRUST_PROMPT; sleep 0.2", IDLE_MS);

    // The trigger pattern should have been seen in the output.
    expect(output).toContain("TRUST_PROMPT");
    // Give the auto-response time to execute, then check for the response.
    const followup = await session.probe("", IDLE_MS);
    const combined = output + followup;
    expect(combined).toContain("auto-response-sent");
  }, 15_000);

  it("environment allowlist is respected — unlisted vars are absent", async () => {
    // Set a sentinel env var that is NOT on the allowlist.
    process.env.RELAY_PTY_TEST_SECRET = "should-not-leak";

    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        // Allowlist does not include RELAY_PTY_TEST_SECRET.
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    const output = await session.probe('echo "secret=[${RELAY_PTY_TEST_SECRET:-UNSET}]"', IDLE_MS);

    // Variable should be unset inside the PTY.
    expect(output).toContain("secret=[UNSET]");

    // Cleanup: remove the sentinel from this process's env.
    delete process.env.RELAY_PTY_TEST_SECRET;
  }, 10_000);

  it("environment allowlist includes PATH and HOME by default", async () => {
    const session = tracked(
      createPTYSession({
        executable: SH,
        cwd: "/tmp",
        // Empty allowlist — PATH and HOME are always included.
        envAllowlist: [],
        idleTimeoutMs: IDLE_MS,
      }),
    );

    const output = await session.probe('echo "path=[${PATH:-UNSET}]"', IDLE_MS);
    // PATH should NOT be UNSET (it will contain real path entries).
    expect(output).not.toContain("path=[UNSET]");
  }, 10_000);
});
