import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type MemoryHealthStatus = "healthy" | "modified" | "missing";

export interface MemoryHealthResult {
  status: MemoryHealthStatus;
  currentHash: string | null;
  lastKnownHash: string | null;
}

/**
 * Checks the health of the project's AGENTS.md file by verifying its existence,
 * computing its hash, and comparing it against the last known hash.
 */
export async function checkMemoryHealth(projectRoot: string): Promise<MemoryHealthResult> {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  const memoryJsonPath = path.join(projectRoot, ".relay", "memory.json");

  let currentHash: string | null = null;
  let lastKnownHash: string | null = null;

  try {
    const content = await fs.readFile(agentsPath);
    currentHash = crypto.createHash("sha256").update(content).digest("hex");
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

  if (!currentHash) {
    return { status: "missing", currentHash: null, lastKnownHash: null };
  }

  try {
    const memoryData = await fs.readFile(memoryJsonPath, "utf-8");
    const parsed = JSON.parse(memoryData) as { lastKnownHash?: string | null };
    lastKnownHash = parsed.lastKnownHash ?? null;
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

  const status: MemoryHealthStatus = currentHash === lastKnownHash ? "healthy" : "modified";

  return { status, currentHash, lastKnownHash };
}

/**
 * Updates the last known hash of the AGENTS.md file.
 */
export async function updateMemoryHealth(projectRoot: string, newHash: string): Promise<void> {
  const memoryJsonPath = path.join(projectRoot, ".relay", "memory.json");
  const relayDir = path.dirname(memoryJsonPath);

  await fs.mkdir(relayDir, { recursive: true });
  await fs.writeFile(memoryJsonPath, JSON.stringify({ lastKnownHash: newHash }, null, 2), "utf-8");
}
