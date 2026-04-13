import { describe, it, expect, vi } from "vitest";
import { cancelProcess } from "../cancellation.js";
import { spawnSubprocess } from "../subprocess-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spawns a long-running subprocess and returns its handle plus a promise that
 * resolves when the process exits (with the signal name, if any).
 */
function spawnLong(command: string[]): {
  handle: { pid: number; kill: (signal?: NodeJS.Signals) => boolean };
  exitPromise: Promise<{ code: number | null; signal: string | null }>;
} {
  let resolveExit!: (result: { code: number | null; signal: string | null }) => void;
  const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });

  const handle = spawnSubprocess({
    command,
    cwd: process.cwd(),
    envAllowlist: [],
    onStdout: () => {
      /* discard */
    },
    onStderr: () => {
      /* discard */
    },
    onExit: (code, signal) => {
      resolveExit({ code, signal });
    },
    onError: () => {
      resolveExit({ code: null, signal: null });
    },
  });

  return { handle, exitPromise };
}

/**
 * Spawns a subprocess that writes "ready\n" to stdout once its setup is done,
 * then returns the handle and a promise that resolves when the child is ready.
 *
 * This avoids a race where we send SIGTERM before the child has had time to
 * register its signal handler.
 */
function spawnWithReady(script: string): {
  handle: { pid: number; kill: (signal?: NodeJS.Signals) => boolean };
  exitPromise: Promise<{ code: number | null; signal: string | null }>;
  ready: Promise<void>;
} {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  let resolveExit!: (result: { code: number | null; signal: string | null }) => void;
  const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });

  const handle = spawnSubprocess({
    command: ["node", "-e", script],
    cwd: process.cwd(),
    envAllowlist: [],
    onStdout: (chunk) => {
      if (chunk.includes("ready")) resolveReady();
    },
    onStderr: () => {
      /* discard */
    },
    onExit: (code, signal) => {
      resolveExit({ code, signal });
    },
    onError: () => {
      resolveExit({ code: null, signal: null });
    },
  });

  return { handle, exitPromise, ready };
}

// ---------------------------------------------------------------------------
// SIGTERM — process exits gracefully
// ---------------------------------------------------------------------------

describe("cancelProcess — SIGTERM exit", () => {
  it("cancels a sleeping process and resolves with SIGTERM", async () => {
    const { handle, exitPromise } = spawnLong(["sleep", "60"]);

    const result = await cancelProcess({ handle, graceMs: 10_000 });

    expect(result).toBe("SIGTERM");
    // Confirm the process actually exited.
    const { signal } = await exitPromise;
    expect(signal).toBe("SIGTERM");
  }, 15_000);

  it("resolves SIGTERM quickly (process exits before timeout)", async () => {
    // spawn a node process that exits 200 ms after receiving SIGTERM
    const script = `
      process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200));
      setTimeout(() => {}, 60000);
    `;
    const { handle } = spawnLong(["node", "-e", script]);

    const start = Date.now();
    const result = await cancelProcess({ handle, graceMs: 8_000 });
    const elapsed = Date.now() - start;

    expect(result).toBe("SIGTERM");
    // Should have finished well under the grace period.
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// SIGKILL — stubborn process ignores SIGTERM
// ---------------------------------------------------------------------------

describe("cancelProcess — SIGKILL escalation", () => {
  it("force-kills a process that ignores SIGTERM", async () => {
    // Spawn a node process that explicitly traps SIGTERM and does nothing.
    // Write "ready\n" to stdout after the handler is installed to avoid a
    // race where SIGTERM arrives before process.on() executes.
    const script = `
      process.on('SIGTERM', () => { /* ignore */ });
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    `;
    const { handle, exitPromise, ready } = spawnWithReady(script);
    await ready;

    const result = await cancelProcess({ handle, graceMs: 1_000 });

    expect(result).toBe("SIGKILL");
    // Confirm the OS confirmed the kill.
    const { signal } = await exitPromise;
    expect(signal).toBe("SIGKILL");
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Already-dead process
// ---------------------------------------------------------------------------

describe("cancelProcess — already-dead process", () => {
  it("resolves immediately with SIGTERM when the process is already gone", async () => {
    // Spawn and wait for a process to exit on its own.
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const handle = spawnSubprocess({
      command: ["node", "-e", "process.exit(0)"],
      cwd: process.cwd(),
      envAllowlist: [],
      onStdout: () => {
        /* discard */
      },
      onStderr: () => {
        /* discard */
      },
      onExit: () => {
        resolveExit();
      },
      onError: () => {
        resolveExit();
      },
    });

    await exited;

    // The process is gone — kill() will return false.
    const result = await cancelProcess({ handle, graceMs: 10_000 });
    expect(result).toBe("SIGTERM");
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("cancelProcess — callbacks", () => {
  it("calls onTermSent when SIGTERM is dispatched", async () => {
    const { handle } = spawnLong(["sleep", "60"]);
    const onTermSent = vi.fn();

    await cancelProcess({ handle, graceMs: 10_000, onTermSent });

    expect(onTermSent).toHaveBeenCalledOnce();
  }, 15_000);

  it("calls onKillSent when SIGKILL is required", async () => {
    const script = `
      process.on('SIGTERM', () => { /* ignore */ });
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    `;
    const { handle, ready } = spawnWithReady(script);
    await ready;
    const onTermSent = vi.fn();
    const onKillSent = vi.fn();

    await cancelProcess({ handle, graceMs: 1_000, onTermSent, onKillSent });

    expect(onTermSent).toHaveBeenCalledOnce();
    expect(onKillSent).toHaveBeenCalledOnce();
  }, 10_000);

  it("does not call onKillSent when process exits gracefully", async () => {
    const { handle } = spawnLong(["sleep", "60"]);
    const onKillSent = vi.fn();

    const result = await cancelProcess({ handle, graceMs: 10_000, onKillSent });

    expect(result).toBe("SIGTERM");
    expect(onKillSent).not.toHaveBeenCalled();
  }, 15_000);

  it("calls onTermSent even when the process is already dead", async () => {
    // Build a dead handle by faking kill() returning false.
    const fakeHandle = {
      pid: 999_999_999, // highly unlikely to exist
      kill: (_signal?: NodeJS.Signals): boolean => false,
    };
    const onTermSent = vi.fn();
    const onKillSent = vi.fn();

    const result = await cancelProcess({
      handle: fakeHandle,
      graceMs: 10_000,
      onTermSent,
      onKillSent,
    });

    expect(result).toBe("SIGTERM");
    expect(onTermSent).toHaveBeenCalledOnce();
    expect(onKillSent).not.toHaveBeenCalled();
  }, 5_000);
});

// ---------------------------------------------------------------------------
// Process group — child processes are also terminated
// ---------------------------------------------------------------------------

describe("cancelProcess — process group", () => {
  it("terminates child processes spawned by the cancelled process", async () => {
    // Spawn a node parent that itself spawns a grandchild sleep.
    // We capture both pids via stdout.
    const script = `
      const { spawn } = require('child_process');
      const child = spawn('sleep', ['60'], { detached: false });
      process.stdout.write(JSON.stringify({ parent: process.pid, child: child.pid }) + '\\n');
      setTimeout(() => {}, 60000);
    `;

    let stdoutData = "";
    let resolveExit!: () => void;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const handle = spawnSubprocess({
      command: ["node", "-e", script],
      cwd: process.cwd(),
      envAllowlist: [],
      onStdout: (chunk) => {
        stdoutData += chunk;
      },
      onStderr: () => {
        /* discard */
      },
      onExit: () => {
        resolveExit();
      },
      onError: () => {
        resolveExit();
      },
    });

    // Give the child time to spawn its grandchild and print pids.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const pids = JSON.parse(stdoutData.trim()) as { parent: number; child: number };

    // Cancel the parent — this sends signals to the entire process group.
    await cancelProcess({ handle, graceMs: 5_000 });
    await exited;

    // Both grandchild and parent should be gone.
    // process.kill(pid, 0) throws ESRCH if the process doesn't exist.
    let grandchildAlive = true;
    try {
      process.kill(pids.child, 0);
    } catch {
      grandchildAlive = false;
    }
    expect(grandchildAlive).toBe(false);
  }, 15_000);
});
