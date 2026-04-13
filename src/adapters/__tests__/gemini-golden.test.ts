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

  for (const filename of expectedFiles) {
    it(`${filename} exists and is non-empty`, () => {
      const fullPath = path.join(fixturesDir, filename);
      expect(fs.existsSync(fullPath), `${filename} must exist`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size, `${filename} must not be empty`).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Task output
// ---------------------------------------------------------------------------

describe("gemini golden files: task-output.txt", () => {
  it("contains plain text (no JSON structure)", () => {
    const raw = readFixture("task-output.txt");
    // Wrap in void to avoid returning `any` from JSON.parse.
    expect(() => {
      JSON.parse(raw);
    }).toThrow();
  });

  it("contains no ANSI escape sequences", () => {
    const raw = readFixture("task-output.txt");
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
  });

  it("matches expected response text", () => {
    const raw = readFixture("task-output.txt");
    expect(raw.trim()).toBe("Hello from Gemini.");
  });
});

// ---------------------------------------------------------------------------
// Stats probe — clean sample
// ---------------------------------------------------------------------------

describe("gemini golden files: stats-probe-clean.txt", () => {
  it('contains "Session Stats" panel header', () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("Session Stats");
  });

  it('contains "Interaction Summary" section', () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("Interaction Summary");
  });

  it("contains per-model usage rows with percentages", () => {
    const raw = readFixture("stats-probe-clean.txt");
    // e.g. "98.3%"
    expect(raw).toMatch(/\d+\.\d+%/);
  });

  it("contains reset time strings for flash model", () => {
    const raw = readFixture("stats-probe-clean.txt");
    // e.g. "resets in 15h 36m"
    expect(raw).toMatch(/resets in \d+h \d+m/i);
  });

  it("contains reset time strings for pro model", () => {
    const raw = readFixture("stats-probe-clean.txt");
    // e.g. "resets in 22h 23m"
    expect(raw).toMatch(/resets in 22h \d+m/i);
  });

  it("contains auth method with google email", () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("Auth Method:");
    expect(raw).toMatch(/Logged in with Google \(.+@.+\..+\)/);
  });

  it("contains tier information", () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("Tier:");
    expect(raw).toContain("Gemini Code Assist in Google One AI Pro");
  });

  it("contains model names: gemini-2.5-flash", () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("gemini-2.5-flash");
  });

  it("contains model names: gemini-2.5-pro", () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("gemini-2.5-pro");
  });

  it("contains model names: gemini-3.1-pro-preview", () => {
    const raw = readFixture("stats-probe-clean.txt");
    expect(raw).toContain("gemini-3.1-pro-preview");
  });

  it("flash usage parsed: 98.3% remaining", () => {
    const raw = readFixture("stats-probe-clean.txt");
    // Match flash row: "gemini-2.5-flash  - 98.3% resets in ..."
    const match = /gemini-2\.5-flash\s+-\s+([\d.]+)%/.exec(raw);
    expect(match).not.toBeNull();
    const pct = parseFloat(match?.[1] ?? "");
    expect(pct).toBeCloseTo(98.3, 1);
  });

  it("pro usage parsed: 83.3% remaining", () => {
    const raw = readFixture("stats-probe-clean.txt");
    // Match pro row: "gemini-2.5-pro  - 83.3% resets in ..."
    const match = /gemini-2\.5-pro\s+-\s+([\d.]+)%/.exec(raw);
    expect(match).not.toBeNull();
    const pct = parseFloat(match?.[1] ?? "");
    expect(pct).toBeCloseTo(83.3, 1);
  });

  it("flash reset time parsed: resets in 15h 36m", () => {
    const raw = readFixture("stats-probe-clean.txt");
    const match = /gemini-2\.5-flash\s+-\s+[\d.]+%\s+(resets in [\dh m]+)/.exec(raw);
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain("15h 36m");
  });

  it("pro reset time parsed: resets in 22h 23m", () => {
    const raw = readFixture("stats-probe-clean.txt");
    const match = /gemini-2\.5-pro\s+-\s+[\d.]+%\s+(resets in [\dh m]+)/.exec(raw);
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain("22h 23m");
  });

  it("email parsed from auth method line", () => {
    const raw = readFixture("stats-probe-clean.txt");
    const match = /Logged in with Google \(([^)]+)\)/.exec(raw);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("david.m.schmidty@gmail.com");
  });
});

// ---------------------------------------------------------------------------
// Error sample
// ---------------------------------------------------------------------------

describe("gemini golden files: stats-error-no-panel.txt", () => {
  it("contains expected no-stats message", () => {
    const raw = readFixture("stats-error-no-panel.txt");
    expect(raw).toContain("No session stats available.");
  });

  it("does not contain Session Stats panel", () => {
    const raw = readFixture("stats-error-no-panel.txt");
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

  it("parses as valid JSON", () => {
    expect(() => parseMetadata()).not.toThrow();
  });

  it("has a name field equal to 'gemini'", () => {
    const meta = parseMetadata();
    expect(meta.name).toBe("gemini");
  });

  it("has a version field matching captured CLI version", () => {
    const meta = parseMetadata();
    expect(typeof meta.version).toBe("string");
    expect(meta.version).toBe("0.37.1");
  });

  it("taskCommand is an array starting with 'gemini'", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.taskCommand)).toBe(true);
    expect(meta.taskCommand[0]).toBe("gemini");
  });

  it("taskFlags includes -m for model selection", () => {
    const meta = parseMetadata();
    expect(typeof meta.taskFlags["-m"]).toBe("string");
    expect(meta.taskFlags["-m"]).toMatch(/model/i);
  });

  it("taskFlags includes -p for non-interactive prompt", () => {
    const meta = parseMetadata();
    expect(typeof meta.taskFlags["-p"]).toBe("string");
    expect(meta.taskFlags["-p"]).toMatch(/prompt/i);
  });

  it("taskFlags includes --approval-mode", () => {
    const meta = parseMetadata();
    expect(meta.taskFlags["--approval-mode"]).toBeDefined();
  });

  it("outputFormats includes text and json", () => {
    const meta = parseMetadata();
    expect(meta.outputFormats).toContain("text");
    expect(meta.outputFormats).toContain("json");
  });

  it("exitCodes has key '0' for success", () => {
    const meta = parseMetadata();
    expect(typeof meta.exitCodes).toBe("object");
    expect(meta.exitCodes["0"]).toBeDefined();
    expect(meta.exitCodes["0"]).toMatch(/success/i);
  });

  it("exitCodes has key '1' for error", () => {
    const meta = parseMetadata();
    expect(meta.exitCodes["1"]).toBeDefined();
    expect(meta.exitCodes["1"]).toMatch(/error/i);
  });

  it("probeCommand is '/stats'", () => {
    const meta = parseMetadata();
    expect(meta.probeCommand).toBe("/stats");
  });

  it("probeMethod is 'pty'", () => {
    const meta = parseMetadata();
    expect(meta.probeMethod).toBe("pty");
  });

  it("experimentalProbeMethod is 'internal'", () => {
    const meta = parseMetadata();
    expect(meta.experimentalProbeMethod).toBe("internal");
  });

  it("rateLimitPatterns is a non-empty array of strings", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.rateLimitPatterns)).toBe(true);
    expect(meta.rateLimitPatterns.length).toBeGreaterThan(0);
    for (const pattern of meta.rateLimitPatterns) {
      expect(typeof pattern).toBe("string");
    }
  });

  it("envVars is an array (empty for gemini — uses google-oauth)", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.envVars)).toBe(true);
  });

  it("authMethod is 'google-oauth'", () => {
    const meta = parseMetadata();
    expect(meta.authMethod).toBe("google-oauth");
  });

  it("models array includes gemini-2.5-flash", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.models)).toBe(true);
    expect(meta.models).toContain("gemini-2.5-flash");
  });

  it("models array includes gemini-2.5-pro", () => {
    const meta = parseMetadata();
    expect(meta.models).toContain("gemini-2.5-pro");
  });

  it("models array includes gemini-3.1-pro-preview", () => {
    const meta = parseMetadata();
    expect(meta.models).toContain("gemini-3.1-pro-preview");
  });
});
