import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ContextItem } from "./types.js";
import { snapshotFile } from "./handoff-persistence.js";

export interface ExcerptInput {
  source_run_id: string;
  source_file: string;
  byte_start: number;
  byte_end: number;
  text: string;
}

export interface FileInput {
  original_path: string;
}

export interface ContextAssemblyInput {
  projectRoot: string;
  handoffId?: string;
  excerpts?: ExcerptInput[];
  files?: FileInput[];
}

/**
 * Pre-populates the context items array for a handoff.
 * - Snapshots AGENTS.md if it exists.
 * - Includes any selected excerpts.
 * - Resolves referenced project files (and snapshots them if handoffId is provided).
 */
export async function assembleContext(input: ContextAssemblyInput): Promise<ContextItem[]> {
  const items: ContextItem[] = [];

  // 1. Memory (AGENTS.md)
  const agentsPath = path.join(input.projectRoot, "AGENTS.md");
  try {
    const content = await fs.readFile(agentsPath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    const snapshotsDir = path.join(input.projectRoot, ".relay", "memory-snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });

    const snapshotPath = path.join(snapshotsDir, `${hash}.md`);
    try {
      await fs.access(snapshotPath);
    } catch {
      await fs.writeFile(snapshotPath, content);
    }

    const content_ref = path.posix.join(".relay", "memory-snapshots", `${hash}.md`);
    items.push({
      type: "memory",
      content: { hash, content_ref },
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === "ENOENT"
    ) {
      // ignore
    } else {
      throw err;
    }
  }

  // 2. Excerpts
  if (input.excerpts) {
    for (const excerpt of input.excerpts) {
      const sha256 = crypto.createHash("sha256").update(excerpt.text).digest("hex");
      items.push({
        type: "excerpt",
        content: {
          source_run_id: excerpt.source_run_id,
          source_file: excerpt.source_file,
          byte_start: excerpt.byte_start,
          byte_end: excerpt.byte_end,
          sha256,
          text: excerpt.text,
        },
      });
    }
  }

  // 3. Files
  if (input.files) {
    for (const file of input.files) {
      if (input.handoffId) {
        // Snapshot the file directly into the handoff's artifact dir
        const { snapshot_path, sha256 } = await snapshotFile(
          input.projectRoot,
          input.handoffId,
          file.original_path,
        );
        items.push({
          type: "file",
          content: {
            original_path: path.relative(
              input.projectRoot,
              path.resolve(input.projectRoot, file.original_path),
            ),
            snapshot_path,
            sha256,
          },
        });
      } else {
        // Just compute the hash to pre-populate context for preview (pre-dispatch)
        const absolutePath = path.resolve(input.projectRoot, file.original_path);
        const content = await fs.readFile(absolutePath);
        const sha256 = crypto.createHash("sha256").update(content).digest("hex");

        items.push({
          type: "file",
          content: {
            original_path: path.relative(input.projectRoot, absolutePath),
            snapshot_path: `PENDING_SNAPSHOT-${sha256}`,
            sha256,
          },
        });
      }
    }
  }

  return items;
}
