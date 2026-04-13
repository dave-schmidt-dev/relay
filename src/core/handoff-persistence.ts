import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Handoff } from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getHandoffDir(projectRoot: string, handoffId: string): string {
  return path.join(projectRoot, ".relay", "handoffs", handoffId);
}

function getHandoffJsonPath(projectRoot: string, handoffId: string): string {
  return path.join(getHandoffDir(projectRoot, handoffId), "handoff.json");
}

function getPromptPreviewPath(projectRoot: string, handoffId: string): string {
  return path.join(getHandoffDir(projectRoot, handoffId), "prompt-preview.md");
}

function getArtifactsDir(projectRoot: string, handoffId: string): string {
  return path.join(getHandoffDir(projectRoot, handoffId), "artifacts");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a Handoff object to .relay/handoffs/<handoff_id>/handoff.json.
 *
 * @param projectRoot Absolute path to the project root.
 * @param handoff The Handoff object to save.
 */
export async function saveHandoff(projectRoot: string, handoff: Handoff): Promise<void> {
  const dir = getHandoffDir(projectRoot, handoff.handoff_id);
  await fs.mkdir(dir, { recursive: true });

  await Promise.all([
    fs.writeFile(
      getHandoffJsonPath(projectRoot, handoff.handoff_id),
      JSON.stringify(handoff, null, 2),
      "utf-8",
    ),
    fs.writeFile(
      getPromptPreviewPath(projectRoot, handoff.handoff_id),
      handoff.template_prompt,
      "utf-8",
    ),
  ]);
}

/**
 * Load a Handoff object from .relay/handoffs/<handoff_id>/handoff.json.
 *
 * @param projectRoot Absolute path to the project root.
 * @param handoffId UUID of the handoff to load.
 * @returns The loaded Handoff object.
 */
export async function loadHandoff(projectRoot: string, handoffId: string): Promise<Handoff> {
  const data = await fs.readFile(getHandoffJsonPath(projectRoot, handoffId), "utf-8");
  return JSON.parse(data) as Handoff;
}

/**
 * Snapshot a file by copying it into the handoff's artifacts directory and calculating its SHA256.
 * Rejects files outside the project root and symlinks.
 *
 * @param projectRoot Absolute path to the project root.
 * @param handoffId UUID of the handoff.
 * @param sourcePath Path to the file to snapshot (can be relative to project root or absolute).
 * @returns An object containing the snapshot path (relative to project root) and the SHA256 hash.
 */
export async function snapshotFile(
  projectRoot: string,
  handoffId: string,
  sourcePath: string,
): Promise<{ snapshot_path: string; sha256: string }> {
  const absoluteSourcePath = path.resolve(projectRoot, sourcePath);

  // Reject if outside project root
  const relativeToRoot = path.relative(projectRoot, absoluteSourcePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Cannot snapshot file outside project root: ${sourcePath}`);
  }

  // Reject if it's a symlink
  const stats = await fs.lstat(absoluteSourcePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Cannot snapshot symlink: ${sourcePath}`);
  }

  const content = await fs.readFile(absoluteSourcePath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  const artifactsDir = getArtifactsDir(projectRoot, handoffId);
  await fs.mkdir(artifactsDir, { recursive: true });

  const fileName = path.basename(absoluteSourcePath);
  const snapshotName = `${hash.substring(0, 8)}-${fileName}`;
  const snapshotPath = path.join(artifactsDir, snapshotName);

  await fs.writeFile(snapshotPath, content);

  return {
    snapshot_path: path.relative(projectRoot, snapshotPath),
    sha256: hash,
  };
}
