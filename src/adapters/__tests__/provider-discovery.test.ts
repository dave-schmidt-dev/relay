import { describe, expect, it } from "vitest";

import { discoverProviders, findExecutable } from "../discovery.js";

describe("findExecutable", () => {
  it("returns a non-empty path for an executable that exists on PATH", async () => {
    const result = await findExecutable("node");
    expect(result).not.toBeNull();
    if (result === null) return; // narrowing — expect above already fails the test
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns null for an executable that does not exist on PATH", async () => {
    const result = await findExecutable("definitely-not-a-real-command-xyz");
    expect(result).toBeNull();
  });
});

describe("discoverProviders", () => {
  it("returns an array (possibly empty on CI)", async () => {
    const providers = await discoverProviders();
    expect(Array.isArray(providers)).toBe(true);
  });

  it("each discovered provider has a valid provider name and a non-empty path", async () => {
    const providers = await discoverProviders();
    const validNames = new Set(["claude", "codex", "gemini", "github"]);

    for (const discovered of providers) {
      expect(validNames.has(discovered.provider)).toBe(true);
      expect(typeof discovered.executablePath).toBe("string");
      expect(discovered.executablePath.length).toBeGreaterThan(0);
    }
  });
});
