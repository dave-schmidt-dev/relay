/**
 * Persistent PTY session manager.
 *
 * Wraps node-pty to create long-lived interactive terminal sessions for
 * provider CLI usage probing. Sessions are reused across probe cycles instead
 * of being spawned fresh each time, so the provider's interactive context
 * (auth, conversation state) is preserved.
 *
 * Key responsibilities:
 *  - Spawn a PTY process with a filtered environment (same allowlist pattern
 *    as subprocess-runner.ts).
 *  - Auto-respond to known blocking prompts (trust gates, confirmations)
 *    without stalling the probe cycle.
 *  - Collect output for a given probe command and resolve when the stream
 *    goes idle for idleTimeoutMs.
 *  - Expose isAlive() and destroy() for lifecycle management.
 */

import * as nodePty from "node-pty";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PTYSessionOptions {
  /** Executable to launch (e.g. "claude", "codex", "gemini"). */
  executable: string;
  /** CLI args for interactive mode. Defaults to []. */
  args?: string[];
  /** Working directory for the PTY process. */
  cwd: string;
  /**
   * Environment variable names to inherit from process.env.
   * PATH and HOME are always included regardless of this list.
   */
  envAllowlist: string[];
  /**
   * Auto-response rules. When incoming PTY data matches a pattern, the
   * corresponding response string is written back to the PTY automatically.
   * Use this to dismiss trust prompts, confirmation gates, etc.
   */
  autoResponses?: { pattern: RegExp; response: string }[];
  /**
   * How long to wait (ms) after the last output chunk before considering
   * a probe command's output "complete". Defaults to 30000.
   */
  idleTimeoutMs?: number;
  /** Called with each raw PTY output chunk (before any processing). */
  onData?: (data: string) => void;
}

export interface PTYSession {
  /** Send a command string to the PTY (a newline is appended automatically). */
  sendCommand(command: string): void;

  /**
   * Send a command to the PTY and collect all output until the stream goes
   * idle for `timeoutMs` (defaults to the session's idleTimeoutMs).
   *
   * @returns All output received from command dispatch until idle.
   */
  probe(command: string, timeoutMs?: number): Promise<string>;

  /** Returns true if the underlying PTY process is still running. */
  isAlive(): boolean;

  /** Terminate the PTY process immediately (SIGKILL). */
  destroy(): void;

  /** OS process ID of the PTY process. */
  readonly pid: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build a filtered environment map from the allowlist.
 *
 * PATH and HOME are unconditionally included so the child process can
 * resolve executables and expand ~ paths correctly — identical to the
 * pattern used in subprocess-runner.ts.
 */
function buildEnv(allowlist: string[]): Record<string, string> {
  const keys = new Set<string>(["PATH", "HOME", ...allowlist]);
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

class PTYSessionImpl implements PTYSession {
  private readonly _pty: nodePty.IPty;
  private readonly _idleTimeoutMs: number;
  private readonly _autoResponses: { pattern: RegExp; response: string }[];
  private _alive = true;

  constructor(options: PTYSessionOptions) {
    const {
      executable,
      args = [],
      cwd,
      envAllowlist,
      autoResponses = [],
      idleTimeoutMs = 30_000,
      onData,
    } = options;

    this._idleTimeoutMs = idleTimeoutMs;
    this._autoResponses = autoResponses;

    const env = buildEnv(envAllowlist);

    this._pty = nodePty.spawn(executable, args, {
      name: "xterm-256color",
      cols: 220,
      rows: 50,
      cwd,
      env,
    });

    // Wire the data handler: forward to caller's onData callback, then scan
    // for auto-response triggers.
    this._pty.onData((chunk: string) => {
      onData?.(chunk);
      this._handleAutoResponses(chunk);
    });

    // Track process exit so isAlive() stays accurate.
    this._pty.onExit(() => {
      this._alive = false;
    });
  }

  get pid(): number {
    return this._pty.pid;
  }

  sendCommand(command: string): void {
    // Append \r (carriage return) which is what PTY-based CLIs expect for
    // "Enter". Using \n alone is not reliably interpreted by interactive CLIs
    // running under a PTY.
    this._pty.write(`${command}\r`);
  }

  probe(command: string, timeoutMs?: number): Promise<string> {
    const idleMs = timeoutMs ?? this._idleTimeoutMs;

    return new Promise((resolve) => {
      const chunks: string[] = [];
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      // Reset the idle timer on every data chunk — we resolve when the
      // timer fires without any intervening data.
      const resetIdle = (): void => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          disposable.dispose();
          resolve(chunks.join(""));
        }, idleMs);
      };

      const disposable = this._pty.onData((chunk: string) => {
        chunks.push(chunk);
        resetIdle();
      });

      // Send the probe command and start the idle timer immediately.
      // The timer fires if no output arrives within idleMs, which handles
      // the case where the command produces no output at all.
      this.sendCommand(command);
      resetIdle();
    });
  }

  isAlive(): boolean {
    return this._alive;
  }

  destroy(): void {
    if (!this._alive) return;
    // NOTE: node-pty kill() defaults to SIGTERM; we use SIGKILL for
    // immediate cleanup since this is an explicit destroy, not a graceful
    // shutdown. The onExit handler sets _alive = false.
    this._pty.kill("SIGKILL");
    // Belt-and-suspenders: mark dead synchronously in case the onExit event
    // is delayed (e.g. in test environments with mocked timers).
    this._alive = false;
  }

  /**
   * Scan incoming data against all auto-response patterns.
   * Fires synchronously inside the onData handler — keep it fast.
   */
  private _handleAutoResponses(chunk: string): void {
    for (const { pattern, response } of this._autoResponses) {
      if (pattern.test(chunk)) {
        // Reset lastIndex on stateful regexes to avoid false negatives
        // on the next call.
        if (pattern.global || pattern.sticky) {
          pattern.lastIndex = 0;
        }
        this._pty.write(`${response}\r`);
      }
    }
  }
}

/**
 * Create a persistent PTY session.
 *
 * @param options - Session configuration.
 * @returns A PTYSession handle for sending commands and collecting output.
 */
export function createPTYSession(options: PTYSessionOptions): PTYSession {
  return new PTYSessionImpl(options);
}
