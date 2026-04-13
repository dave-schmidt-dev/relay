import { describe, it, expect } from "vitest";
import { spawnSubprocess } from "../subprocess-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Runs a subprocess and collects all output, resolving once the process exits.
 */
function run(
  command: string[],
  options: {
    cwd?: string;
    envAllowlist?: string[];
  } = {},
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  error: Error | null;
}> {
  return new Promise((resolve) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let capturedError: Error | null = null;

    const handle = spawnSubprocess({
      command,
      cwd: options.cwd ?? process.cwd(),
      envAllowlist: options.envAllowlist ?? [],
      onStdout: (chunk) => {
        stdoutChunks.push(chunk);
      },
      onStderr: (chunk) => {
        stderrChunks.push(chunk);
      },
      onExit: (code, signal) => {
        resolve({
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
          code,
          signal,
          error: capturedError,
        });
      },
      onError: (err) => {
        capturedError = err;
        resolve({
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
          // When a spawn error occurs, exit may never fire; treat as null.
          code: null,
          signal: null,
          error: err,
        });
      },
    });

    // Keep a reference to satisfy no-unused-vars — we don't need to act on it here.
    void handle;
  });
}

// ---------------------------------------------------------------------------
// stdout capture
// ---------------------------------------------------------------------------

describe("spawnSubprocess — stdout capture", () => {
  it("captures stdout from a simple echo command", async () => {
    const result = await run(["node", "-e", "process.stdout.write('hello world')"]);
    expect(result.stdout).toBe("hello world");
    expect(result.error).toBeNull();
  });

  it("accumulates multiple stdout chunks", async () => {
    const script = `
      process.stdout.write('line1\\n');
      process.stdout.write('line2\\n');
    `;
    const result = await run(["node", "-e", script]);
    expect(result.stdout).toContain("line1");
    expect(result.stdout).toContain("line2");
  });
});

// ---------------------------------------------------------------------------
// stderr capture
// ---------------------------------------------------------------------------

describe("spawnSubprocess — stderr capture", () => {
  it("captures stderr separately from stdout", async () => {
    const script = `
      process.stdout.write('out');
      process.stderr.write('err');
    `;
    const result = await run(["node", "-e", script]);
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
  });

  it("stderr does not bleed into stdout", async () => {
    const result = await run(["node", "-e", "process.stderr.write('only-stderr')"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("only-stderr");
  });
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

describe("spawnSubprocess — exit codes", () => {
  it("reports exit code 0 for a successful process", async () => {
    const result = await run(["node", "-e", "process.exit(0)"]);
    expect(result.code).toBe(0);
    expect(result.error).toBeNull();
  });

  it("reports the correct non-zero exit code on failure", async () => {
    const result = await run(["node", "-e", "process.exit(42)"]);
    expect(result.code).toBe(42);
  });

  it("reports exit code 1 for an uncaught exception", async () => {
    const result = await run(["node", "-e", "throw new Error('boom')"]);
    expect(result.code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Environment allowlist
// ---------------------------------------------------------------------------

describe("spawnSubprocess — environment allowlist", () => {
  it("only passes allowlisted vars to the child (plus PATH and HOME)", async () => {
    // Inject a distinctive env var into the parent, then check the child
    // sees only what we allow.
    const sentinel = "RELAY_TEST_SENTINEL_XYZ";
    const originalValue = process.env[sentinel];
    process.env[sentinel] = "should-not-appear";

    try {
      const result = await run(
        ["node", "-e", "process.stdout.write(JSON.stringify(process.env))"],
        { envAllowlist: [] },
      );

      const childEnv = JSON.parse(result.stdout) as Record<string, string>;

      // Sentinel must NOT be present — it wasn't in the allowlist.
      expect(childEnv[sentinel]).toBeUndefined();

      // PATH and HOME are always forwarded.
      expect(childEnv.PATH).toBeDefined();
      expect(childEnv.HOME).toBeDefined();
    } finally {
      if (originalValue === undefined) {
        Reflect.deleteProperty(process.env, sentinel);
      } else {
        process.env[sentinel] = originalValue;
      }
    }
  });

  it("passes explicitly allowlisted vars to the child", async () => {
    const key = "RELAY_ALLOWED_VAR";
    const originalValue = process.env[key];
    process.env[key] = "hello-from-parent";

    try {
      const result = await run(
        ["node", "-e", "process.stdout.write(JSON.stringify(process.env))"],
        { envAllowlist: [key] },
      );

      const childEnv = JSON.parse(result.stdout) as Record<string, string>;
      expect(childEnv[key]).toBe("hello-from-parent");
    } finally {
      if (originalValue === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it("does not include unlisted vars even when the allowlist is non-empty", async () => {
    const allowed = "RELAY_ALLOWED";
    const blocked = "RELAY_BLOCKED_XYZ";
    process.env[allowed] = "yes";
    process.env[blocked] = "no";

    try {
      const result = await run(
        ["node", "-e", "process.stdout.write(JSON.stringify(process.env))"],
        { envAllowlist: [allowed] },
      );

      const childEnv = JSON.parse(result.stdout) as Record<string, string>;
      expect(childEnv[allowed]).toBe("yes");
      expect(childEnv[blocked]).toBeUndefined();
    } finally {
      Reflect.deleteProperty(process.env, allowed);
      Reflect.deleteProperty(process.env, blocked);
    }
  });
});

// ---------------------------------------------------------------------------
// cwd is respected
// ---------------------------------------------------------------------------

describe("spawnSubprocess — cwd", () => {
  it("runs the process in the specified working directory", async () => {
    const result = await run(["node", "-e", "process.stdout.write(process.cwd())"], {
      cwd: "/tmp",
    });
    // On macOS /tmp is a symlink to /private/tmp; accept both.
    expect(result.stdout.replace(/^\/private/, "")).toBe("/tmp");
  });
});

// ---------------------------------------------------------------------------
// Kill / process group
// ---------------------------------------------------------------------------

describe("spawnSubprocess — kill", () => {
  it("returns a handle with a numeric pid", () => {
    // Start a long-running process so we have time to inspect the handle.
    let capturedHandle: { pid: number; kill: (sig?: NodeJS.Signals) => boolean } | null = null;

    const promise = new Promise<void>((resolve) => {
      capturedHandle = spawnSubprocess({
        command: ["node", "-e", "setTimeout(() => {}, 30000)"],
        cwd: process.cwd(),
        envAllowlist: [],
        onStdout: () => {
          /* discard */
        },
        onStderr: () => {
          /* discard */
        },
        onExit: () => {
          resolve();
        },
        onError: () => {
          resolve();
        },
      });

      // Kill immediately after capturing the handle.
      expect(capturedHandle.pid).toBeGreaterThan(0);
      capturedHandle.kill("SIGTERM");
    });

    return promise;
  });

  it("kill returns true while the process is running and false afterward", async () => {
    let handle: { pid: number; kill: (sig?: NodeJS.Signals) => boolean } | null = null;
    let exitResolve: (() => void) | null = null;

    const exitPromise = new Promise<void>((resolve) => {
      exitResolve = resolve;
    });

    handle = spawnSubprocess({
      command: ["node", "-e", "setTimeout(() => {}, 30000)"],
      cwd: process.cwd(),
      envAllowlist: [],
      onStdout: () => {
        /* discard */
      },
      onStderr: () => {
        /* discard */
      },
      onExit: () => {
        exitResolve?.();
      },
      onError: () => {
        exitResolve?.();
      },
    });

    // First kill should succeed — process is alive.
    const firstKill = handle.kill("SIGTERM");
    expect(firstKill).toBe(true);

    await exitPromise;

    // Subsequent kill should return false — process group is gone.
    const secondKill = handle.kill("SIGTERM");
    expect(secondKill).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Command not found (onError)
// ---------------------------------------------------------------------------

describe("spawnSubprocess — error handling", () => {
  it("calls onError when the command does not exist", async () => {
    const result = await run(["__relay_nonexistent_command_xyz__"]);
    expect(result.error).toBeInstanceOf(Error);
    if (result.error instanceof Error) {
      expect(result.error.message).toMatch(/ENOENT/);
    }
  });
});
