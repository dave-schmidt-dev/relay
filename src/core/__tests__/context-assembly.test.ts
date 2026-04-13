import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { assembleContext } from "../context-assembly.js";

describe("context-assembly", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-context-assembly-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("handles missing AGENTS.md", async () => {
    const items = await assembleContext({ projectRoot: tempDir });
    expect(items).toHaveLength(0);
  });

  it("snapshots and includes AGENTS.md if it exists", async () => {
    const agentsContent = "test agents content";
    await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsContent, "utf-8");

    const items = await assembleContext({ projectRoot: tempDir });
    expect(items).toHaveLength(1);

    const memoryItem = items[0];
    expect(memoryItem).toBeDefined();

    if (memoryItem?.type === "memory") {
      const hash = crypto.createHash("sha256").update(agentsContent).digest("hex");
      expect(memoryItem.content.hash).toBe(hash);

      const snapshotPath = path.join(tempDir, ".relay", "memory-snapshots", `${hash}.md`);
      const snapshotContent = await fs.readFile(snapshotPath, "utf-8");
      expect(snapshotContent).toBe(agentsContent);
    }
  });

  it("includes excerpts", async () => {
    const items = await assembleContext({
      projectRoot: tempDir,
      excerpts: [
        {
          source_run_id: "run-1",
          source_file: "stdout.log",
          byte_start: 0,
          byte_end: 10,
          text: "hello world",
        },
      ],
    });

    expect(items).toHaveLength(1);
    const excerptItem = items[0];
    expect(excerptItem).toBeDefined();
    if (!excerptItem) throw new Error("Item is undefined");
    expect(excerptItem.type).toBe("excerpt");

    if (excerptItem.type === "excerpt") {
      expect(excerptItem.content.text).toBe("hello world");
      expect(excerptItem.content.sha256).toBe(
        crypto.createHash("sha256").update("hello world").digest("hex"),
      );
    }
  });

  it("stubs files when no handoffId is provided", async () => {
    const filePath = path.join(tempDir, "file.txt");
    const fileContent = "file content";
    await fs.writeFile(filePath, fileContent, "utf-8");

    const items = await assembleContext({
      projectRoot: tempDir,
      files: [{ original_path: "file.txt" }],
    });

    expect(items).toHaveLength(1);
    const fileItem = items[0];
    expect(fileItem).toBeDefined();
    if (!fileItem) throw new Error("Item is undefined");
    expect(fileItem.type).toBe("file");

    if (fileItem.type === "file") {
      const hash = crypto.createHash("sha256").update(fileContent).digest("hex");
      expect(fileItem.content.sha256).toBe(hash);
      expect(fileItem.content.snapshot_path).toBe(`PENDING_SNAPSHOT-${hash}`);
      expect(fileItem.content.original_path).toBe("file.txt");
    }
  });

  it("snapshots files when handoffId is provided", async () => {
    const filePath = path.join(tempDir, "file.txt");
    const fileContent = "file content";
    await fs.writeFile(filePath, fileContent, "utf-8");

    const handoffId = "test-handoff-id";

    const items = await assembleContext({
      projectRoot: tempDir,
      handoffId,
      files: [{ original_path: "file.txt" }],
    });

    expect(items).toHaveLength(1);
    const fileItem = items[0];
    expect(fileItem).toBeDefined();
    if (!fileItem) throw new Error("Item is undefined");

    if (fileItem.type === "file") {
      const hash = crypto.createHash("sha256").update(fileContent).digest("hex");
      expect(fileItem.content.sha256).toBe(hash);

      const expectedSnapshotPath = path.posix.join(
        ".relay",
        "handoffs",
        handoffId,
        "artifacts",
        `${hash.substring(0, 8)}-file.txt`,
      );

      // Allow for both backslash and forward slash depending on OS, snapshotFile returns path.relative
      expect(fileItem.content.snapshot_path.replace(/\\\\/g, "/")).toBe(expectedSnapshotPath);

      // Verify the snapshot file actually exists
      const snapshotAbsPath = path.join(tempDir, fileItem.content.snapshot_path);
      const snapshotContent = await fs.readFile(snapshotAbsPath, "utf-8");
      expect(snapshotContent).toBe(fileContent);
    }
  });
});
