import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Run, Event } from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function runDir(projectRoot: string, runId: string): string {
  return path.join(projectRoot, ".relay", "runs", runId);
}

function runJsonPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), "run.json");
}

function eventsPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), "events.jsonl");
}

function stdoutPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), "stdout.log");
}

function stderrPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), "stderr.log");
}

function promptPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), "prompt.md");
}

function finalPath(projectRoot: string, runId: string): string {
  return path.join(runDir(projectRoot, runId), "final.md");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the run directory and write initial files.
 *
 * Creates .relay/runs/<run_id>/ and writes:
 * - run.json: full Run metadata
 * - events.jsonl: empty (append-only)
 * - stdout.log: empty (append-only)
 * - stderr.log: empty (append-only)
 * - prompt.md: immutable prompt snapshot
 *
 * @param projectRoot Absolute path to the project root.
 * @param run The newly-created Run object.
 * @param promptContent The prompt text to persist immutably.
 * @returns The absolute path to the run directory.
 */
export async function persistNewRun(
  projectRoot: string,
  run: Run,
  promptContent: string,
): Promise<string> {
  const dir = runDir(projectRoot, run.run_id);
  await fs.mkdir(dir, { recursive: true });

  await Promise.all([
    fs.writeFile(runJsonPath(projectRoot, run.run_id), JSON.stringify(run, null, 2), "utf-8"),
    fs.writeFile(eventsPath(projectRoot, run.run_id), "", "utf-8"),
    fs.writeFile(stdoutPath(projectRoot, run.run_id), "", "utf-8"),
    fs.writeFile(stderrPath(projectRoot, run.run_id), "", "utf-8"),
    fs.writeFile(promptPath(projectRoot, run.run_id), promptContent, "utf-8"),
  ]);

  return dir;
}

/**
 * Overwrite run.json with the current Run state.
 * Called after every status transition.
 *
 * @param projectRoot Absolute path to the project root.
 * @param run The updated Run object.
 */
export async function updateRunMetadata(projectRoot: string, run: Run): Promise<void> {
  await fs.writeFile(runJsonPath(projectRoot, run.run_id), JSON.stringify(run, null, 2), "utf-8");
}

/**
 * Append one event as a JSON line to events.jsonl.
 *
 * @param projectRoot Absolute path to the project root.
 * @param runId UUID of the run.
 * @param event The event to append.
 */
export async function appendEvent(projectRoot: string, runId: string, event: Event): Promise<void> {
  await fs.appendFile(eventsPath(projectRoot, runId), JSON.stringify(event) + "\n", "utf-8");
}

/**
 * Append raw stdout text to stdout.log.
 *
 * @param projectRoot Absolute path to the project root.
 * @param runId UUID of the run.
 * @param chunk Raw stdout content.
 */
export async function appendStdout(
  projectRoot: string,
  runId: string,
  chunk: string,
): Promise<void> {
  await fs.appendFile(stdoutPath(projectRoot, runId), chunk, "utf-8");
}

/**
 * Append raw stderr text to stderr.log.
 *
 * @param projectRoot Absolute path to the project root.
 * @param runId UUID of the run.
 * @param chunk Raw stderr content.
 */
export async function appendStderr(
  projectRoot: string,
  runId: string,
  chunk: string,
): Promise<void> {
  await fs.appendFile(stderrPath(projectRoot, runId), chunk, "utf-8");
}

/**
 * Write the final extracted output to final.md.
 * Called once after the run completes. Does NOT enforce single-write at the
 * filesystem level — callers are responsible for calling this only once.
 *
 * @param projectRoot Absolute path to the project root.
 * @param runId UUID of the run.
 * @param content The final output text.
 */
export async function writeFinalOutput(
  projectRoot: string,
  runId: string,
  content: string,
): Promise<void> {
  await fs.writeFile(finalPath(projectRoot, runId), content, "utf-8");
}

/**
 * Load a Run from disk by reading run.json.
 *
 * @param projectRoot Absolute path to the project root.
 * @param runId UUID of the run to load.
 * @returns The deserialized Run object.
 * @throws If the run directory or run.json does not exist.
 */
export async function loadRun(projectRoot: string, runId: string): Promise<Run> {
  const data = await fs.readFile(runJsonPath(projectRoot, runId), "utf-8");
  return JSON.parse(data) as Run;
}

/**
 * List all run IDs in the project by reading the .relay/runs/ directory.
 * Entries that are not directories are silently excluded.
 *
 * @param projectRoot Absolute path to the project root.
 * @returns An array of run ID strings (order not guaranteed).
 */
export async function listRunIds(projectRoot: string): Promise<string[]> {
  const runsDir = path.join(projectRoot, ".relay", "runs");
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true, encoding: "utf-8" });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
