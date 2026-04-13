/**
 * Golden file tests for Codex CLI fixtures.
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

// Golden files are at <project root>/fixtures/codex/
// Test file is at src/adapters/__tests__/ — 4 levels up is project root.
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/codex");

function readFixture(filename: string): string {
  const fullPath = path.join(fixturesDir, filename);
  return fs.readFileSync(fullPath, "utf8");
}

// ---------------------------------------------------------------------------
// Fixture presence
// ---------------------------------------------------------------------------

describe("codex golden files: fixture presence", () => {
  const expectedFiles = [
    "task-output.txt",
    "task-stderr.txt",
    "task-output-jsonl.jsonl",
    "status-probe-clean.txt",
    "status-probe-live-style.txt",
    "status-error-unavailable.txt",
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
// Task stdout
// ---------------------------------------------------------------------------

describe("codex golden files: task-output.txt", () => {
  it("contains plain text matching expected response", () => {
    const raw = readFixture("task-output.txt");
    // Wrap in void to avoid returning `any` from JSON.parse.
    expect(() => {
      JSON.parse(raw);
    }).toThrow();
    expect(raw.trim()).toBe("Hello from Codex. Nothing else.");
  });
});

// ---------------------------------------------------------------------------
// Task stderr
// ---------------------------------------------------------------------------

describe("codex golden files: task-stderr.txt", () => {
  it("contains version, model, provider, sandbox, and reasoning effort fields", () => {
    const raw = readFixture("task-stderr.txt");
    expect(raw).toMatch(/OpenAI Codex v\d+\.\d+\.\d+/);
    expect(raw).toContain("model: gpt-5.4");
    expect(raw).toContain("provider: openai");
    expect(raw).toContain("sandbox:");
    expect(raw).toContain("reasoning effort:");
  });
});

// ---------------------------------------------------------------------------
// JSONL task output
// ---------------------------------------------------------------------------

describe("codex golden files: task-output-jsonl.jsonl", () => {
  // Typed representation of a JSONL event line from `codex exec --json`.
  interface JsonlEvent {
    type: string;
    role?: string;
    content?: string;
    exit_code?: number;
  }

  // Parse JSONL: one JSON object per non-empty line.
  function parseJsonl(): JsonlEvent[] {
    const raw = readFixture("task-output-jsonl.jsonl");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JsonlEvent);
  }

  it("parses as valid JSONL with expected event types and structure", () => {
    expect(() => parseJsonl()).not.toThrow();
    const events = parseJsonl();

    const messageEvents = events.filter((e) => e.type === "message");
    expect(messageEvents.length).toBeGreaterThan(0);

    const endEvent = events.find((e) => e.type === "session_end");
    expect(endEvent).toBeDefined();
    expect(endEvent?.exit_code).toBe(0);

    const assistantMsg = events.find((e) => e.type === "message" && e.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(typeof assistantMsg?.content).toBe("string");
    expect(assistantMsg?.content?.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(typeof event.type).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Status probe — clean sample
// ---------------------------------------------------------------------------

describe("codex golden files: status-probe-clean.txt", () => {
  it("contains credits, limits, reset times, and parsed percentage values", () => {
    const raw = readFixture("status-probe-clean.txt");

    expect(raw).toContain("Credits:");
    expect(raw).toMatch(/5h limit:.*\d+%\s+left/);
    expect(raw).toMatch(/Weekly limit:.*\d+%\s+left/);
    expect(raw).toMatch(/Resets in/i);
    expect(raw).toMatch(/Resets on/i);

    // 5h limit percent parsed: 68% left
    const fiveHMatch = /5h limit:.*?(\d+)%\s+left/.exec(raw);
    expect(fiveHMatch).not.toBeNull();
    const fiveHLeftPct = parseInt(fiveHMatch?.[1] ?? "", 10);
    expect(fiveHLeftPct).toBe(68);

    // weekly limit percent parsed: 91% left
    const weeklyMatch = /Weekly limit:.*?(\d+)%\s+left/.exec(raw);
    expect(weeklyMatch).not.toBeNull();
    const weeklyLeftPct = parseInt(weeklyMatch?.[1] ?? "", 10);
    expect(weeklyLeftPct).toBe(91);
  });
});

// ---------------------------------------------------------------------------
// Status probe — live terminal style sample
// ---------------------------------------------------------------------------

describe("codex golden files: status-probe-live-style.txt", () => {
  it("contains progress bar, limits, reset reference, and parsed percentage values", () => {
    const raw = readFixture("status-probe-live-style.txt");

    // Box-drawing vertical bar and block characters used in progress bars
    expect(raw).toMatch(/[█░]/);
    expect(raw).toMatch(/\d+%\s+left/);
    expect(raw).toMatch(/resets/i);
    expect(raw).toContain("5h limit:");
    expect(raw).toContain("Weekly limit:");

    // 5h limit percent parsed: 96% left
    const fiveHMatch = /5h limit:.*?(\d+)%\s+left/.exec(raw);
    expect(fiveHMatch).not.toBeNull();
    const fiveHLeftPct = parseInt(fiveHMatch?.[1] ?? "", 10);
    expect(fiveHLeftPct).toBe(96);

    // weekly limit percent parsed: 92% left
    const weeklyMatch = /Weekly limit:.*?(\d+)%\s+left/.exec(raw);
    expect(weeklyMatch).not.toBeNull();
    const weeklyLeftPct = parseInt(weeklyMatch?.[1] ?? "", 10);
    expect(weeklyLeftPct).toBe(92);
  });
});

// ---------------------------------------------------------------------------
// Error sample
// ---------------------------------------------------------------------------

describe("codex golden files: status-error-unavailable.txt", () => {
  it("contains unavailability message and retry suggestion", () => {
    const raw = readFixture("status-error-unavailable.txt");
    expect(raw).toContain("Data not available yet");
    expect(raw).toContain("Please try again later");
  });
});

// ---------------------------------------------------------------------------
// CLI metadata
// ---------------------------------------------------------------------------

describe("codex golden files: cli-metadata.json", () => {
  interface TaskFlags {
    "-m": string;
    "--skip-git-repo-check": string;
    "--json": string;
    "-o": string;
    "-s": string;
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
    rateLimitPatterns: string[];
    envVars: string[];
  }

  function parseMetadata(): CliMetadata {
    const raw = readFixture("cli-metadata.json");
    return JSON.parse(raw) as CliMetadata;
  }

  it("has valid structure with expected fields and values", () => {
    expect(() => parseMetadata()).not.toThrow();
    const meta = parseMetadata();

    expect(meta.name).toBe("codex");

    expect(typeof meta.version).toBe("string");
    expect(meta.version).toBe("0.120.0");

    expect(Array.isArray(meta.taskCommand)).toBe(true);
    expect(meta.taskCommand[0]).toBe("codex");

    expect(typeof meta.taskFlags["-m"]).toBe("string");
    expect(meta.taskFlags["-m"]).toMatch(/model/i);
    expect(meta.taskFlags["--skip-git-repo-check"]).toBeDefined();

    expect(meta.outputFormats).toContain("text");
    expect(meta.outputFormats).toContain("jsonl");

    expect(typeof meta.exitCodes).toBe("object");
    expect(meta.exitCodes["0"]).toBeDefined();
    expect(meta.exitCodes["0"]).toMatch(/success/i);
    expect(meta.exitCodes["1"]).toBeDefined();
    expect(meta.exitCodes["1"]).toMatch(/error/i);

    expect(meta.probeCommand).toBe("/status");

    expect(Array.isArray(meta.rateLimitPatterns)).toBe(true);
    expect(meta.rateLimitPatterns.length).toBeGreaterThan(0);
    for (const pattern of meta.rateLimitPatterns) {
      expect(typeof pattern).toBe("string");
    }

    expect(Array.isArray(meta.envVars)).toBe(true);
    expect(meta.envVars).toContain("OPENAI_API_KEY");
  });
});
