import * as childProcess from "node:child_process";

/**
 * Options for spawning a provider CLI subprocess.
 */
export interface SubprocessOptions {
  /** Full argv — first element is the executable, rest are arguments. */
  command: string[];
  /** Working directory for the spawned process. */
  cwd: string;
  /**
   * Environment variable names to inherit from process.env.
   * PATH and HOME are always included regardless of this list.
   */
  envAllowlist: string[];
  /** Called with each decoded stdout chunk. */
  onStdout: (chunk: string) => void;
  /** Called with each decoded stderr chunk. */
  onStderr: (chunk: string) => void;
  /**
   * Called when the process exits.
   * @param code - OS exit code, or null if the process was killed by a signal.
   * @param signal - Signal name that killed the process, or null on clean exit.
   */
  onExit: (code: number | null, signal: string | null) => void;
  /** Called if the process cannot be spawned (e.g. command not found). */
  onError: (err: Error) => void;
}

/**
 * Handle returned by spawnSubprocess — lets callers inspect and signal the process.
 */
export interface SubprocessHandle {
  /** OS process ID of the spawned process. */
  pid: number;
  /**
   * Send a signal to the entire process group (negative PID).
   * Defaults to SIGTERM if no signal is supplied.
   *
   * @param signal - The POSIX signal to send.
   * @returns true if the signal was delivered; false if the process had already exited.
   */
  kill: (signal?: NodeJS.Signals) => boolean;
}

/**
 * Spawns a provider CLI as a headless, pipe-based subprocess with a filtered
 * environment and process group management.
 *
 * Design choices:
 * - stdio: "pipe" — never a PTY; stdout/stderr are separate streams.
 * - detached: true — places the child in its own process group so that
 *   `kill(-pid, signal)` terminates the entire tree (important for providers
 *   that themselves launch sub-agents).
 * - Environment is constructed from the explicit allowlist only, always
 *   augmented with PATH and HOME so the child can locate executables.
 *
 * @param options - Spawn configuration and lifecycle callbacks.
 * @returns A handle with the process PID and a group-kill function.
 * @throws If `options.command` is empty.
 */
export function spawnSubprocess(options: SubprocessOptions): SubprocessHandle {
  const { command, cwd, envAllowlist, onStdout, onStderr, onExit, onError } = options;

  if (command.length === 0) {
    throw new Error("subprocess-runner: command must not be empty");
  }

  // Build the filtered environment from the allowlist.
  // PATH and HOME are unconditionally included so the child can resolve
  // executables and expand ~ paths correctly.
  const alwaysInclude = new Set<string>(["PATH", "HOME", ...envAllowlist]);
  const filteredEnv: Record<string, string> = {};
  for (const key of alwaysInclude) {
    const value = process.env[key];
    if (value !== undefined) {
      filteredEnv[key] = value;
    }
  }

  const [executable, ...args] = command;

  // NOTE: detached:true creates a new process group. We use the negative PID
  // to send signals to the whole group (see SubprocessHandle.kill below).
  const child = childProcess.spawn(executable ?? "", args, {
    cwd,
    env: filteredEnv,
    stdio: "pipe",
    detached: true,
  });

  // Wire stdout/stderr data events. Buffer encoding is "utf8" so callbacks
  // always receive decoded strings rather than raw Buffers.
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    onStdout(chunk);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    onStderr(chunk);
  });

  // "exit" fires after the child process and its stdio streams have closed.
  child.on("exit", (code, signal) => {
    onExit(code, signal);
  });

  // "error" fires if the process cannot be spawned (ENOENT, EACCES, etc.).
  child.on("error", (err) => {
    onError(err);
  });

  // Obtain the PID. Since detached:true and stdio:pipe are both synchronous
  // flags, the PID is available immediately after spawn() returns for most
  // commands. However, if the executable does not exist, Node sets child.pid
  // to undefined and emits "error" asynchronously. In that case we return a
  // sentinel handle (pid = -1, no-op kill) so callers are not required to
  // handle a thrown exception — the error surfaces via onError instead.
  if (child.pid === undefined) {
    return {
      pid: -1,
      kill(): boolean {
        return false;
      },
    };
  }

  const pid = child.pid;

  return {
    pid,
    kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
      try {
        // Negative PID targets the process group created by detached:true,
        // ensuring child processes spawned by the provider are also terminated.
        process.kill(-pid, signal);
        return true;
      } catch {
        // ESRCH means the process group no longer exists — already exited.
        return false;
      }
    },
  };
}
