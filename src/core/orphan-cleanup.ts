import { listRunIds, loadRun, updateRunMetadata } from "./run-persistence.js";
import { transitionRun } from "./run-lifecycle.js";

/**
 * Check whether a process is alive by sending signal 0.
 *
 * Returns true if the process exists, false if ESRCH is thrown (no such process).
 * Re-throws any other error (e.g. EPERM — process exists but we lack permission).
 *
 * @param pid OS process ID to probe.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") {
      return false;
    }
    // EPERM means the process exists but we can't signal it — treat as alive.
    return true;
  }
}

/**
 * Scan for orphaned runs and mark them as failed.
 *
 * On startup, any run recorded as "running" whose PID is no longer alive (or
 * whose PID was never set) is considered orphaned — the relay process that
 * owned the run died without cleaning up.  This function marks all such runs
 * as "failed" with exit_reason "orphaned" and persists the updated metadata.
 *
 * @param projectRoot Absolute path to the project root.
 * @returns Array of run IDs that were marked as orphaned.
 */
export async function cleanupOrphans(projectRoot: string): Promise<string[]> {
  const runIds = await listRunIds(projectRoot);

  const orphanedIds: string[] = [];

  await Promise.all(
    runIds.map(async (runId) => {
      const run = await loadRun(projectRoot, runId);

      if (run.status !== "running") {
        return;
      }

      // A run with no PID is orphaned by definition — there is no process to check.
      const dead = run.pid === null || !isProcessAlive(run.pid);

      if (!dead) {
        return;
      }

      const failed = transitionRun(run, "failed", { exit_reason: "orphaned" });
      await updateRunMetadata(projectRoot, failed);
      orphanedIds.push(runId);
    }),
  );

  return orphanedIds;
}
