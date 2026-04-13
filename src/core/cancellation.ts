import * as nodeProcess from "node:process";

/**
 * Options for cancelling a subprocess with SIGTERM → SIGKILL escalation.
 */
export interface CancelOptions {
  /** The subprocess handle to cancel. */
  handle: { pid: number; kill: (signal?: NodeJS.Signals) => boolean };
  /** Timeout in ms before escalating to SIGKILL (default: 10000). */
  graceMs?: number;
  /** Called when SIGTERM is sent. */
  onTermSent?: () => void;
  /** Called when SIGKILL is sent (timeout exceeded). */
  onKillSent?: () => void;
}

/**
 * Returns true if a process with the given PID is still alive.
 * Uses signal 0 which performs an existence check without sending an actual signal.
 */
function isAlive(pid: number): boolean {
  try {
    nodeProcess.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process — dead or never existed
    return false;
  }
}

/**
 * Cancel a running subprocess with SIGTERM → SIGKILL escalation.
 *
 * Sends SIGTERM first. If the process does not exit within `graceMs` (default
 * 10 000 ms), sends SIGKILL. Resolves once the process is confirmed dead.
 *
 * @returns A promise that resolves to the signal that actually stopped the
 *   process: "SIGTERM" if it exited gracefully, "SIGKILL" if it had to be
 *   force-killed.
 */
export async function cancelProcess(options: CancelOptions): Promise<"SIGTERM" | "SIGKILL"> {
  const { handle, graceMs = 10_000, onTermSent, onKillSent } = options;
  const { pid } = handle;

  // Send SIGTERM. If kill() returns false the process is already gone.
  const delivered = handle.kill("SIGTERM");
  onTermSent?.();

  if (!delivered) {
    // Process was already dead before we sent the signal.
    return "SIGTERM";
  }

  // Poll every 500 ms to see whether the process has exited within the grace
  // period. Using polling (rather than waiting for an "exit" event) lets this
  // function work against any handle shape, not just ChildProcess instances.
  const pollIntervalMs = 500;
  const deadline = Date.now() + graceMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    if (!isAlive(pid)) {
      return "SIGTERM";
    }
  }

  // Grace period exhausted — escalate to SIGKILL.
  handle.kill("SIGKILL");
  onKillSent?.();

  // Wait until the kernel confirms the process is gone.
  while (isAlive(pid)) {
    await sleep(pollIntervalMs);
  }

  return "SIGKILL";
}

/** Minimal async sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
