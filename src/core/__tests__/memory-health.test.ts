import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import { checkMemoryHealth, updateMemoryHealth } from "../memory-health.js";

describe("memory-health", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-memory-health-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns missing if AGENTS.md does not exist", async () => {
    const result = await checkMemoryHealth(tempDir);
    expect(result.status).toBe("missing");
    expect(result.currentHash).toBeNull();
  });

  it("returns modified if AGENTS.md exists but no last known hash", async () => {
    await fs.writeFile(path.join(tempDir, "AGENTS.md"), "test content", "utf-8");
    const result = await checkMemoryHealth(tempDir);

    expect(result.status).toBe("modified");
    expect(result.currentHash).toBe(
      crypto.createHash("sha256").update("test content").digest("hex"),
    );
    expect(result.lastKnownHash).toBeNull();
  });

  it("returns healthy if hashes match", async () => {
    const content = "test content";
    await fs.writeFile(path.join(tempDir, "AGENTS.md"), content, "utf-8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    await updateMemoryHealth(tempDir, hash);

    const result = await checkMemoryHealth(tempDir);
    expect(result.status).toBe("healthy");
    expect(result.currentHash).toBe(hash);
    expect(result.lastKnownHash).toBe(hash);
  });

  it("returns modified if hashes differ", async () => {
    await fs.writeFile(path.join(tempDir, "AGENTS.md"), "new content", "utf-8");
    await updateMemoryHealth(tempDir, "old-hash");

    const result = await checkMemoryHealth(tempDir);
    expect(result.status).toBe("modified");
    expect(result.currentHash).toBe(
      crypto.createHash("sha256").update("new content").digest("hex"),
    );
    expect(result.lastKnownHash).toBe("old-hash");
  });
});
