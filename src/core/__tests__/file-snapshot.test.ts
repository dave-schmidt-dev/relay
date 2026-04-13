import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { snapshotFile } from "../handoff-persistence.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-file-snapshot-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("File Snapshotting", () => {
  it("snapshots a file and calculates SHA256", async () => {
    const sourceFilePath = path.join(tmpDir, "test-file.txt");
    const content = "Hello, world!";
    await fs.writeFile(sourceFilePath, content, "utf-8");

    const result = await snapshotFile(tmpDir, "handoff-123", "test-file.txt");

    // Hash of "Hello, world!"
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    expect(result.sha256).toBe(expectedHash);

    const absoluteSnapshotPath = path.resolve(tmpDir, result.snapshot_path);
    const snapshotContent = await fs.readFile(absoluteSnapshotPath, "utf-8");
    expect(snapshotContent).toBe(content);
  });

  it("rejects files outside the project root", async () => {
    const outsideFile = path.join(os.tmpdir(), "outside-file.txt");
    await fs.writeFile(outsideFile, "outside", "utf-8");

    await expect(snapshotFile(tmpDir, "handoff-123", outsideFile)).rejects.toThrow(
      /Cannot snapshot file outside project root/,
    );

    // Also test with relative path navigating outside
    await expect(snapshotFile(tmpDir, "handoff-123", "../outside.txt")).rejects.toThrow(
      /Cannot snapshot file outside project root/,
    );
  });

  it("rejects symlinks", async () => {
    const targetFile = path.join(tmpDir, "target.txt");
    await fs.writeFile(targetFile, "target", "utf-8");

    const symlinkPath = path.join(tmpDir, "symlink.txt");
    await fs.symlink(targetFile, symlinkPath);

    await expect(snapshotFile(tmpDir, "handoff-123", "symlink.txt")).rejects.toThrow(
      /Cannot snapshot symlink/,
    );
  });
});
