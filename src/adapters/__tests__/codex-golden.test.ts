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
// Task stdout
// ---------------------------------------------------------------------------

describe("codex golden files: task-output.txt", () => {
  it("contains plain text (no JSON structure)", () => {
    const raw = readFixture("task-output.txt");
    // Wrap in void to avoid returning `any` from JSON.parse.
    expect(() => {
      JSON.parse(raw);
    }).toThrow();
  });

  it("matches expected response text", () => {
    const raw = readFixture("task-output.txt");
    expect(raw.trim()).toBe("Hello from Codex. Nothing else.");
  });
});

// ---------------------------------------------------------------------------
// Task stderr
// ---------------------------------------------------------------------------

describe("codex golden files: task-stderr.txt", () => {
  it("contains version string", () => {
    const raw = readFixture("task-stderr.txt");
    expect(raw).toMatch(/OpenAI Codex v\d+\.\d+\.\d+/);
  });

  it("contains model name", () => {
    const raw = readFixture("task-stderr.txt");
    expect(raw).toContain("model: gpt-5.4");
  });

  it("contains provider field", () => {
    const raw = readFixture("task-stderr.txt");
    expect(raw).toContain("provider: openai");
  });

  it("contains sandbox info", () => {
    const raw = readFixture("task-stderr.txt");
    expect(raw).toContain("sandbox:");
  });

  it("contains reasoning effort field", () => {
    const raw = readFixture("task-stderr.txt");
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

  it("parses as valid JSONL (one object per line)", () => {
    expect(() => parseJsonl()).not.toThrow();
  });

  it("has at least one message event", () => {
    const events = parseJsonl();
    const messageEvents = events.filter((e) => e.type === "message");
    expect(messageEvents.length).toBeGreaterThan(0);
  });

  it("has a session_end event", () => {
    const events = parseJsonl();
    const endEvent = events.find((e) => e.type === "session_end");
    expect(endEvent).toBeDefined();
  });

  it("session_end event has exit_code 0 for success", () => {
    const events = parseJsonl();
    const endEvent = events.find((e) => e.type === "session_end");
    expect(endEvent?.exit_code).toBe(0);
  });

  it("assistant message contains expected text", () => {
    const events = parseJsonl();
    const assistantMsg = events.find((e) => e.type === "message" && e.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(typeof assistantMsg?.content).toBe("string");
    expect(assistantMsg?.content?.length).toBeGreaterThan(0);
  });

  it("all events have a type field", () => {
    const events = parseJsonl();
    for (const event of events) {
      expect(typeof event.type).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Status probe — clean sample
// ---------------------------------------------------------------------------

describe("codex golden files: status-probe-clean.txt", () => {
  it("contains credits information", () => {
    const raw = readFixture("status-probe-clean.txt");
    expect(raw).toContain("Credits:");
  });

  it("contains 5h limit with percentage left", () => {
    const raw = readFixture("status-probe-clean.txt");
    expect(raw).toMatch(/5h limit:.*\d+%\s+left/);
  });

  it("contains weekly limit with percentage left", () => {
    const raw = readFixture("status-probe-clean.txt");
    expect(raw).toMatch(/Weekly limit:.*\d+%\s+left/);
  });

  it("contains reset time for 5h limit", () => {
    const raw = readFixture("status-probe-clean.txt");
    expect(raw).toMatch(/Resets in/i);
  });

  it("contains reset date for weekly limit", () => {
    const raw = readFixture("status-probe-clean.txt");
    expect(raw).toMatch(/Resets on/i);
  });

  it("5h limit percent parsed: 68% left", () => {
    const raw = readFixture("status-probe-clean.txt");
    const match = /5h limit:.*?(\d+)%\s+left/.exec(raw);
    expect(match).not.toBeNull();
    const leftPct = parseInt(match?.[1] ?? "", 10);
    expect(leftPct).toBe(68);
  });

  it("weekly limit percent parsed: 91% left", () => {
    const raw = readFixture("status-probe-clean.txt");
    const match = /Weekly limit:.*?(\d+)%\s+left/.exec(raw);
    expect(match).not.toBeNull();
    const leftPct = parseInt(match?.[1] ?? "", 10);
    expect(leftPct).toBe(91);
  });
});

// ---------------------------------------------------------------------------
// Status probe — live terminal style sample
// ---------------------------------------------------------------------------

describe("codex golden files: status-probe-live-style.txt", () => {
  it("contains progress bar characters", () => {
    const raw = readFixture("status-probe-live-style.txt");
    // Box-drawing vertical bar and block characters used in progress bars
    expect(raw).toMatch(/[█░]/);
  });

  it("contains percentage values", () => {
    const raw = readFixture("status-probe-live-style.txt");
    expect(raw).toMatch(/\d+%\s+left/);
  });

  it("contains reset time reference", () => {
    const raw = readFixture("status-probe-live-style.txt");
    expect(raw).toMatch(/resets/i);
  });

  it("contains 5h limit section", () => {
    const raw = readFixture("status-probe-live-style.txt");
    expect(raw).toContain("5h limit:");
  });

  it("contains weekly limit section", () => {
    const raw = readFixture("status-probe-live-style.txt");
    expect(raw).toContain("Weekly limit:");
  });

  it("5h limit percent parsed: 96% left", () => {
    const raw = readFixture("status-probe-live-style.txt");
    const match = /5h limit:.*?(\d+)%\s+left/.exec(raw);
    expect(match).not.toBeNull();
    const leftPct = parseInt(match?.[1] ?? "", 10);
    expect(leftPct).toBe(96);
  });

  it("weekly limit percent parsed: 92% left", () => {
    const raw = readFixture("status-probe-live-style.txt");
    const match = /Weekly limit:.*?(\d+)%\s+left/.exec(raw);
    expect(match).not.toBeNull();
    const leftPct = parseInt(match?.[1] ?? "", 10);
    expect(leftPct).toBe(92);
  });
});

// ---------------------------------------------------------------------------
// Error sample
// ---------------------------------------------------------------------------

describe("codex golden files: status-error-unavailable.txt", () => {
  it("contains unavailability message", () => {
    const raw = readFixture("status-error-unavailable.txt");
    expect(raw).toContain("Data not available yet");
  });

  it("contains retry suggestion", () => {
    const raw = readFixture("status-error-unavailable.txt");
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

  it("parses as valid JSON", () => {
    expect(() => parseMetadata()).not.toThrow();
  });

  it("has a name field equal to 'codex'", () => {
    const meta = parseMetadata();
    expect(meta.name).toBe("codex");
  });

  it("has a version field matching captured CLI version", () => {
    const meta = parseMetadata();
    expect(typeof meta.version).toBe("string");
    expect(meta.version).toBe("0.120.0");
  });

  it("taskCommand is an array starting with 'codex'", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.taskCommand)).toBe(true);
    expect(meta.taskCommand[0]).toBe("codex");
  });

  it("taskFlags includes -m for model selection", () => {
    const meta = parseMetadata();
    expect(typeof meta.taskFlags["-m"]).toBe("string");
    expect(meta.taskFlags["-m"]).toMatch(/model/i);
  });

  it("taskFlags includes --skip-git-repo-check", () => {
    const meta = parseMetadata();
    expect(meta.taskFlags["--skip-git-repo-check"]).toBeDefined();
  });

  it("outputFormats includes text and jsonl", () => {
    const meta = parseMetadata();
    expect(meta.outputFormats).toContain("text");
    expect(meta.outputFormats).toContain("jsonl");
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

  it("probeCommand is '/status'", () => {
    const meta = parseMetadata();
    expect(meta.probeCommand).toBe("/status");
  });

  it("rateLimitPatterns is a non-empty array of strings", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.rateLimitPatterns)).toBe(true);
    expect(meta.rateLimitPatterns.length).toBeGreaterThan(0);
    for (const pattern of meta.rateLimitPatterns) {
      expect(typeof pattern).toBe("string");
    }
  });

  it("envVars includes OPENAI_API_KEY", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.envVars)).toBe(true);
    expect(meta.envVars).toContain("OPENAI_API_KEY");
  });
});
