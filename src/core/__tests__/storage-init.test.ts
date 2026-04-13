import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initProjectStorage, initGlobalStorage, loadConfig, DEFAULT_CONFIG } from "../storage.js";

describe("storage initialization", () => {
  let tmpDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-test-"));
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "relay-home-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it("creates .relay/ and all subdirectories when they don't exist", async () => {
    await initProjectStorage(tmpDir);

    const relayDir = path.join(tmpDir, ".relay");
    const dirs = ["runs", "handoffs", "exports", "debug"];

    for (const dir of dirs) {
      const stat = await fs.stat(path.join(relayDir, dir));
      expect(stat.isDirectory()).toBe(true);
    }

    const actionsStat = await fs.stat(path.join(relayDir, "actions.jsonl"));
    expect(actionsStat.isFile()).toBe(true);
  });

  it("creates config.json with default values when it doesn't exist", async () => {
    const { configPath, config } = await initProjectStorage(tmpDir);

    expect(configPath).toBe(path.join(tmpDir, ".relay", "config.json"));
    expect(config).toEqual(DEFAULT_CONFIG);

    const data = await fs.readFile(configPath, "utf-8");
    expect(JSON.parse(data)).toEqual(DEFAULT_CONFIG);
  });

  it("loads existing config.json without overwriting custom values", async () => {
    const relayDir = path.join(tmpDir, ".relay");
    await fs.mkdir(relayDir, { recursive: true });

    const existingConfig = { ...DEFAULT_CONFIG, defaultPort: 4000 };
    await fs.writeFile(path.join(relayDir, "config.json"), JSON.stringify(existingConfig));

    const { config } = await initProjectStorage(tmpDir);
    expect(config.defaultPort).toBe(4000);
  });

  it("merges missing keys from defaults into existing partial config", async () => {
    const relayDir = path.join(tmpDir, ".relay");
    await fs.mkdir(relayDir, { recursive: true });

    const partialConfig = { defaultPort: 4000 };
    await fs.writeFile(path.join(relayDir, "config.json"), JSON.stringify(partialConfig));

    const { config } = await initProjectStorage(tmpDir);
    expect(config.defaultPort).toBe(4000);
    expect(config.probeInterval).toBe(DEFAULT_CONFIG.probeInterval);
  });

  it("creates global ~/.relay/usage/ directory", async () => {
    await initGlobalStorage(fakeHome);

    const usageDir = path.join(fakeHome, ".relay", "usage");
    const stat = await fs.stat(usageDir);
    expect(stat.isDirectory()).toBe(true);

    const historyStat = await fs.stat(path.join(usageDir, "history.jsonl"));
    expect(historyStat.isFile()).toBe(true);
  });

  it("validates config types and throws on invalid types during loadConfig", async () => {
    const relayDir = path.join(tmpDir, ".relay");
    await fs.mkdir(relayDir, { recursive: true });

    const invalidConfig = { probeInterval: "invalid" };
    await fs.writeFile(path.join(relayDir, "config.json"), JSON.stringify(invalidConfig));

    await expect(loadConfig(tmpDir)).rejects.toThrow(
      "Invalid config: probeInterval must be a number",
    );
  });

  it("loads and validates valid config using loadConfig", async () => {
    await initProjectStorage(tmpDir);
    const config = await loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});
