/**
 * Unit tests for the Gemini provider adapter.
 *
 * Uses golden fixtures from fixtures/gemini/ to validate parsing logic against
 * real captured CLI output rather than invented strings.
 *
 * REQ-004, REQ-013
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { geminiAdapter } from "../gemini-adapter.js";

// Fixtures are at <project root>/fixtures/gemini/.
// Test file is 4 directories deep: src/adapters/__tests__/<file>.
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/gemini");

function readFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), "utf8");
}

// ---------------------------------------------------------------------------
// buildCommand
// ---------------------------------------------------------------------------

describe("geminiAdapter.buildCommand", () => {
  it("produces correct argv with default model and text format", () => {
    const argv = geminiAdapter.buildCommand("hello world");
    expect(argv).toEqual([
      "gemini",
      "-p",
      "hello world",
      "-m",
      "gemini-3.1-pro-preview",
      "-o",
      "text",
    ]);
  });

  it("uses the specified model", () => {
    const argv = geminiAdapter.buildCommand("think hard", {
      model: "gemini-2.5-pro",
    });
    expect(argv).toContain("-m");
    expect(argv).toContain("gemini-2.5-pro");
    expect(argv).not.toContain("gemini-3.1-pro-preview");
  });

  it("uses the specified output format", () => {
    const argv = geminiAdapter.buildCommand("do something", {
      outputFormat: "json",
    });
    expect(argv).toContain("-o");
    expect(argv).toContain("json");
  });

  it("defaults to text output format", () => {
    const argv = geminiAdapter.buildCommand("any prompt");
    expect(argv).toContain("-o");
    expect(argv).toContain("text");
  });

  it("executable is the first element", () => {
    const argv = geminiAdapter.buildCommand("x");
    expect(argv[0]).toBe("gemini");
  });

  it("second element is '-p'", () => {
    const argv = geminiAdapter.buildCommand("x");
    expect(argv[1]).toBe("-p");
  });

  it("prompt is the third element", () => {
    const prompt = "the prompt text";
    const argv = geminiAdapter.buildCommand(prompt);
    expect(argv[2]).toBe(prompt);
  });

  it("accepts stream-json as output format", () => {
    const argv = geminiAdapter.buildCommand("stream me", {
      outputFormat: "stream-json",
    });
    expect(argv).toContain("stream-json");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — text format (golden file)
// ---------------------------------------------------------------------------

describe("geminiAdapter.parseOutput — text format", () => {
  it("returns trimmed text from the golden text fixture", () => {
    const raw = readFixture("task-output.txt");
    const result = geminiAdapter.parseOutput(raw, "text");
    expect(result).toBe("Hello from Gemini.");
  });

  it("defaults to text parsing when outputFormat is omitted", () => {
    const raw = readFixture("task-output.txt");
    const result = geminiAdapter.parseOutput(raw);
    expect(result).toBe("Hello from Gemini.");
  });

  it("trims surrounding whitespace", () => {
    const padded = "  Hello from Gemini.  \n";
    expect(geminiAdapter.parseOutput(padded, "text")).toBe("Hello from Gemini.");
  });

  it("treats stream-json format the same as text (trimmed raw stdout)", () => {
    const raw = "  some streamed output\n";
    expect(geminiAdapter.parseOutput(raw, "stream-json")).toBe("some streamed output");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — JSON format
// ---------------------------------------------------------------------------

describe("geminiAdapter.parseOutput — JSON format", () => {
  it("parses valid JSON and returns trimmed stdout", () => {
    const jsonOutput = JSON.stringify({ response: "Hello from Gemini." });
    const result = geminiAdapter.parseOutput(jsonOutput, "json");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("throws on completely invalid JSON", () => {
    expect(() => geminiAdapter.parseOutput("not json", "json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// interpretExitCode
// ---------------------------------------------------------------------------

describe("geminiAdapter.interpretExitCode", () => {
  it("maps exit code 0 to success", () => {
    const result = geminiAdapter.interpretExitCode(0);
    expect(result.success).toBe(true);
    expect(result.reason).toBe("success");
  });

  it("maps exit code 1 to general error", () => {
    const result = geminiAdapter.interpretExitCode(1);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/general error/i);
  });

  it("maps an unknown exit code to failure with code in reason", () => {
    const result = geminiAdapter.interpretExitCode(99);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("99");
  });

  it("maps negative exit codes to failure", () => {
    const result = geminiAdapter.interpretExitCode(-1);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRateLimit — golden fixture
// ---------------------------------------------------------------------------

describe("geminiAdapter.detectRateLimit", () => {
  it("detects 'capacity-related errors' pattern", () => {
    expect(
      geminiAdapter.detectRateLimit("Gemini returned capacity-related errors. Please retry."),
    ).toBe(true);
  });

  it("detects 'rate limit' in arbitrary text", () => {
    expect(geminiAdapter.detectRateLimit("You have hit the rate limit for this API")).toBe(true);
  });

  it("detects 'quota exceeded' in arbitrary text", () => {
    expect(geminiAdapter.detectRateLimit("Error: quota exceeded for this model")).toBe(true);
  });

  it("is case-insensitive for rate limit patterns", () => {
    expect(geminiAdapter.detectRateLimit("RATE LIMIT exceeded")).toBe(true);
    expect(geminiAdapter.detectRateLimit("Quota Exceeded")).toBe(true);
    expect(geminiAdapter.detectRateLimit("Capacity-Related Errors encountered")).toBe(true);
  });

  it("returns false for normal task output", () => {
    const raw = readFixture("task-output.txt");
    expect(geminiAdapter.detectRateLimit(raw)).toBe(false);
  });

  it("returns false for the no-panel error fixture", () => {
    const raw = readFixture("stats-error-no-panel.txt");
    expect(geminiAdapter.detectRateLimit(raw)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(geminiAdapter.detectRateLimit("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

describe("geminiAdapter.buildHandoffPrompt", () => {
  it("produces a markdown string with the task title as h1", () => {
    const prompt = geminiAdapter.buildHandoffPrompt({
      title: "Implement the widget",
      objective: "Build a robust widget module.",
      contextItems: [],
    });
    expect(prompt).toContain("# Implement the widget");
  });

  it("includes the objective under an h2 heading", () => {
    const prompt = geminiAdapter.buildHandoffPrompt({
      title: "Task",
      objective: "Do the thing correctly.",
      contextItems: [],
    });
    expect(prompt).toContain("## Objective");
    expect(prompt).toContain("Do the thing correctly.");
  });

  it("includes each context item as its own h2 section", () => {
    const prompt = geminiAdapter.buildHandoffPrompt({
      title: "Task",
      objective: "Objective text.",
      contextItems: [
        { title: "Prior Work", body: "Some prior work description." },
        { title: "Constraints", body: "No breaking changes." },
      ],
    });
    expect(prompt).toContain("## Prior Work");
    expect(prompt).toContain("Some prior work description.");
    expect(prompt).toContain("## Constraints");
    expect(prompt).toContain("No breaking changes.");
  });

  it("produces a non-empty string even with no context items", () => {
    const prompt = geminiAdapter.buildHandoffPrompt({
      title: "Minimal",
      objective: "Just the objective.",
      contextItems: [],
    });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("preserves ordering of context items", () => {
    const prompt = geminiAdapter.buildHandoffPrompt({
      title: "Order test",
      objective: "Check ordering.",
      contextItems: [
        { title: "First", body: "First body." },
        { title: "Second", body: "Second body." },
        { title: "Third", body: "Third body." },
      ],
    });
    const firstPos = prompt.indexOf("## First");
    const secondPos = prompt.indexOf("## Second");
    const thirdPos = prompt.indexOf("## Third");
    expect(firstPos).toBeLessThan(secondPos);
    expect(secondPos).toBeLessThan(thirdPos);
  });

  it("returns a valid markdown string (starts with h1)", () => {
    const prompt = geminiAdapter.buildHandoffPrompt({
      title: "My Task",
      objective: "Some objective.",
      contextItems: [],
    });
    expect(prompt.startsWith("# My Task")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Adapter metadata
// ---------------------------------------------------------------------------

describe("geminiAdapter metadata", () => {
  it("provider is 'gemini'", () => {
    expect(geminiAdapter.provider).toBe("gemini");
  });

  it("executable is 'gemini'", () => {
    expect(geminiAdapter.executable).toBe("gemini");
  });

  it("requiredEnvVars is empty (uses Google OAuth, no API key)", () => {
    expect(geminiAdapter.requiredEnvVars).toEqual([]);
  });
});
