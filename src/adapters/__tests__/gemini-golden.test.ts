/**
 * Golden file tests for Gemini CLI fixtures.
 *
 * These tests validate the fixture files themselves — verifying that captured
 * CLI output samples exist, are non-empty, and have the structure expected by
 * future adapter and probe parsers (Phase 1).
 *
 * NOTE: No parsing logic lives here yet. These tests lock down the shape of
 * the raw captures so parser development has a stable contract to work against.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Golden files are at <project root>/fixtures/gemini/
// Test file is at src/adapters/__tests__/ — 4 levels up is project root.
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/gemini");

function readFixture(filename: string): string {
  const fullPath = path.join(fixturesDir, filename);
  return fs.readFileSync(fullPath, "utf8");
}

// ---------------------------------------------------------------------------
// Fixture presence
// ---------------------------------------------------------------------------

describe("gemini golden files: fixture presence", () => {
  const expectedFiles = [
    "task-output.txt",
    "stats-probe-clean.txt",
    "stats-error-no-panel.txt",
    "cli-metadata.json",
  ];

  it("all expected fixture files exist and are non-empty", () => {
    for (const filename of expectedFiles) {
      const fullPath = path.join(fixturesDir, filename);
      expect(fs.existsSync(fullPath), `${filename} must exist`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size, `${filename} must not be empty`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Task output
// ---------------------------------------------------------------------------

describe("gemini golden files: task-output.txt", () => {
  it("contains plain unescaped text matching expected response", () => {
    const raw = readFixture("task-output.txt");

    // Wrap in void to avoid returning `any` from JSON.parse.
    expect(() => {
      JSON.parse(raw);
    }).toThrow();

    // ANSI escape sequences start with ESC (U+001B) followed by '['.
    // Iterate via index to avoid spread-on-string lint issue; ASCII check is
    // safe because we only care about the ESC byte (0x1B), not multi-byte chars.
    let hasAnsi = false;
    for (let i = 0; i < raw.length; i++) {
      if (raw.codePointAt(i) === 0x1b && raw[i + 1] === "[") {
        hasAnsi = true;
        break;
      }
    }
    expect(hasAnsi).toBe(false);

    expect(raw.trim()).toBe("Hello from Gemini.");
  });
});

// ---------------------------------------------------------------------------
// Stats probe — clean sample
// ---------------------------------------------------------------------------

describe("gemini golden files: stats-probe-clean.txt", () => {
  it("contains all expected sections, model entries, auth info, and parsed values", () => {
    const raw = readFixture("stats-probe-clean.txt");

    expect(raw).toContain("Session Stats");
    expect(raw).toContain("Interaction Summary");
    // e.g. "98.3%"
    expect(raw).toMatch(/\d+\.\d+%/);
    // e.g. "resets in 15h 36m"
    expect(raw).toMatch(/resets in \d+h \d+m/i);
    // e.g. "resets in 22h 23m"
    expect(raw).toMatch(/resets in 22h \d+m/i);
    expect(raw).toContain("Auth Method:");
    expect(raw).toMatch(/Logged in with Google \(.+@.+\..+\)/);
    expect(raw).toContain("Tier:");
    expect(raw).toContain("Gemini Code Assist in Google One AI Pro");
    expect(raw).toContain("gemini-2.5-flash");
    expect(raw).toContain("gemini-2.5-pro");
    expect(raw).toContain("gemini-3.1-pro-preview");

    // flash usage parsed: 98.3% remaining
    // Match flash row: "gemini-2.5-flash  - 98.3% resets in ..."
    const flashMatch = /gemini-2\.5-flash\s+-\s+([\d.]+)%/.exec(raw);
    expect(flashMatch).not.toBeNull();
    const flashPct = parseFloat(flashMatch?.[1] ?? "");
    expect(flashPct).toBeCloseTo(98.3, 1);

    // pro usage parsed: 83.3% remaining
    // Match pro row: "gemini-2.5-pro  - 83.3% resets in ..."
    const proMatch = /gemini-2\.5-pro\s+-\s+([\d.]+)%/.exec(raw);
    expect(proMatch).not.toBeNull();
    const proPct = parseFloat(proMatch?.[1] ?? "");
    expect(proPct).toBeCloseTo(83.3, 1);

    // flash reset time parsed: resets in 15h 36m
    const flashResetMatch = /gemini-2\.5-flash\s+-\s+[\d.]+%\s+(resets in [\dh m]+)/.exec(raw);
    expect(flashResetMatch).not.toBeNull();
    expect(flashResetMatch?.[1]).toContain("15h 36m");

    // pro reset time parsed: resets in 22h 23m
    const proResetMatch = /gemini-2\.5-pro\s+-\s+[\d.]+%\s+(resets in [\dh m]+)/.exec(raw);
    expect(proResetMatch).not.toBeNull();
    expect(proResetMatch?.[1]).toContain("22h 23m");

    // email parsed from auth method line
    const emailMatch = /Logged in with Google \(([^)]+)\)/.exec(raw);
    expect(emailMatch).not.toBeNull();
    expect(emailMatch?.[1]).toBe("user@example.com");
  });
});

// ---------------------------------------------------------------------------
// Error sample
// ---------------------------------------------------------------------------

describe("gemini golden files: stats-error-no-panel.txt", () => {
  it("contains expected no-stats message and absence of Session Stats panel", () => {
    const raw = readFixture("stats-error-no-panel.txt");
    expect(raw).toContain("No session stats available.");
    expect(raw).not.toContain("Session Stats");
  });
});

// ---------------------------------------------------------------------------
// CLI metadata
// ---------------------------------------------------------------------------

describe("gemini golden files: cli-metadata.json", () => {
  interface TaskFlags {
    "-m": string;
    "-o": string;
    "-p": string;
    "--approval-mode": string;
    [key: string]: string;
  }

  interface CliMetadata {
    name: string;
    version: string;
    executable: string;
    taskCommand: string[];
    taskFlags: TaskFlags;
    outputFormats: string[];
    exitCodes: Record<string, string>;
    probeCommand: string;
    probeMethod: string;
    experimentalProbeMethod: string;
    rateLimitPatterns: string[];
    envVars: string[];
    authMethod: string;
    models: string[];
  }

  function parseMetadata(): CliMetadata {
    const raw = readFixture("cli-metadata.json");
    return JSON.parse(raw) as CliMetadata;
  }

  it("has valid structure with expected fields and values", () => {
    expect(() => parseMetadata()).not.toThrow();
    const meta = parseMetadata();

    expect(meta.name).toBe("gemini");

    expect(typeof meta.version).toBe("string");
    expect(meta.version).toBe("0.37.1");

    expect(Array.isArray(meta.taskCommand)).toBe(true);
    expect(meta.taskCommand[0]).toBe("gemini");

    expect(typeof meta.taskFlags["-m"]).toBe("string");
    expect(meta.taskFlags["-m"]).toMatch(/model/i);
    expect(typeof meta.taskFlags["-p"]).toBe("string");
    expect(meta.taskFlags["-p"]).toMatch(/prompt/i);
    expect(meta.taskFlags["--approval-mode"]).toBeDefined();

    expect(meta.outputFormats).toContain("text");
    expect(meta.outputFormats).toContain("json");

    expect(typeof meta.exitCodes).toBe("object");
    expect(meta.exitCodes["0"]).toBeDefined();
    expect(meta.exitCodes["0"]).toMatch(/success/i);
    expect(meta.exitCodes["1"]).toBeDefined();
    expect(meta.exitCodes["1"]).toMatch(/error/i);

    expect(meta.probeCommand).toBe("/stats");
    expect(meta.probeMethod).toBe("pty");
    expect(meta.experimentalProbeMethod).toBe("internal");

    expect(Array.isArray(meta.rateLimitPatterns)).toBe(true);
    expect(meta.rateLimitPatterns.length).toBeGreaterThan(0);
    for (const pattern of meta.rateLimitPatterns) {
      expect(typeof pattern).toBe("string");
    }

    expect(Array.isArray(meta.envVars)).toBe(true);
    expect(meta.authMethod).toBe("google-oauth");

    expect(Array.isArray(meta.models)).toBe(true);
    expect(meta.models).toContain("gemini-2.5-flash");
    expect(meta.models).toContain("gemini-2.5-pro");
    expect(meta.models).toContain("gemini-3.1-pro-preview");
  });
});
