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
    // executable-first, prompt position, and default text format are covered by the full assertion above
    expect(argv[0]).toBe("gemini");
    expect(argv[1]).toBe("-p");
    expect(argv[2]).toBe("hello world");
    expect(argv).toContain("-o");
    expect(argv).toContain("text");
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
    const argv = geminiAdapter.buildCommand("do something", { outputFormat: "json" });
    expect(argv).toContain("-o");
    expect(argv).toContain("json");
  });

  it("accepts stream-json as output format", () => {
    const argv = geminiAdapter.buildCommand("stream me", { outputFormat: "stream-json" });
    expect(argv).toContain("stream-json");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — text format (golden file)
// ---------------------------------------------------------------------------

describe("geminiAdapter.parseOutput — text format", () => {
  it("returns trimmed text from the golden fixture, defaults to text, trims whitespace, and handles stream-json", () => {
    const raw = readFixture("task-output.txt");
    expect(geminiAdapter.parseOutput(raw, "text")).toBe("Hello from Gemini.");
    expect(geminiAdapter.parseOutput(raw)).toBe("Hello from Gemini.");
    expect(geminiAdapter.parseOutput("  Hello from Gemini.  \n", "text")).toBe(
      "Hello from Gemini.",
    );
    expect(geminiAdapter.parseOutput("  some streamed output\n", "stream-json")).toBe(
      "some streamed output",
    );
  });
});

// ---------------------------------------------------------------------------
// parseOutput — JSON format
// ---------------------------------------------------------------------------

describe("geminiAdapter.parseOutput — JSON format", () => {
  it("parses valid JSON and returns a non-empty string, throws on invalid JSON", () => {
    const jsonOutput = JSON.stringify({ response: "Hello from Gemini." });
    const result = geminiAdapter.parseOutput(jsonOutput, "json");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);

    expect(() => geminiAdapter.parseOutput("not json", "json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// interpretExitCode
// ---------------------------------------------------------------------------

describe("geminiAdapter.interpretExitCode", () => {
  it("maps exit codes to the correct success/reason values", () => {
    const ok = geminiAdapter.interpretExitCode(0);
    expect(ok.success).toBe(true);
    expect(ok.reason).toBe("success");

    const general = geminiAdapter.interpretExitCode(1);
    expect(general.success).toBe(false);
    expect(general.reason).toMatch(/general error/i);

    const unknown = geminiAdapter.interpretExitCode(99);
    expect(unknown.success).toBe(false);
    expect(unknown.reason).toContain("99");

    const negative = geminiAdapter.interpretExitCode(-1);
    expect(negative.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRateLimit
// ---------------------------------------------------------------------------

describe("geminiAdapter.detectRateLimit", () => {
  it("detects rate limit patterns (arbitrary text and case-insensitive)", () => {
    expect(
      geminiAdapter.detectRateLimit("Gemini returned capacity-related errors. Please retry."),
    ).toBe(true);
    expect(geminiAdapter.detectRateLimit("You have hit the rate limit for this API")).toBe(true);
    expect(geminiAdapter.detectRateLimit("Error: quota exceeded for this model")).toBe(true);
    expect(geminiAdapter.detectRateLimit("RATE LIMIT exceeded")).toBe(true);
    expect(geminiAdapter.detectRateLimit("Quota Exceeded")).toBe(true);
    expect(geminiAdapter.detectRateLimit("Capacity-Related Errors encountered")).toBe(true);
  });

  it("returns false for non-rate-limit text", () => {
    expect(geminiAdapter.detectRateLimit(readFixture("task-output.txt"))).toBe(false);
    expect(geminiAdapter.detectRateLimit(readFixture("stats-error-no-panel.txt"))).toBe(false);
    expect(geminiAdapter.detectRateLimit("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

describe("geminiAdapter.buildHandoffPrompt", () => {
  it("produces correct markdown: h1 title, h2 objective, context items included, empty context works, ordering preserved, starts with h1", () => {
    // h1 title + h2 objective
    const basic = geminiAdapter.buildHandoffPrompt({
      title: "Implement the widget",
      objective: "Build a robust widget module.",
      contextItems: [],
    });
    expect(basic).toContain("# Implement the widget");
    expect(basic).toContain("## Objective");
    expect(basic).toContain("Build a robust widget module.");

    // context items included
    const withContext = geminiAdapter.buildHandoffPrompt({
      title: "Task",
      objective: "Objective text.",
      contextItems: [
        { title: "Prior Work", body: "Some prior work description." },
        { title: "Constraints", body: "No breaking changes." },
      ],
    });
    expect(withContext).toContain("## Prior Work");
    expect(withContext).toContain("Some prior work description.");
    expect(withContext).toContain("## Constraints");
    expect(withContext).toContain("No breaking changes.");

    // empty context still produces a non-empty string
    const minimal = geminiAdapter.buildHandoffPrompt({
      title: "Minimal",
      objective: "Just the objective.",
      contextItems: [],
    });
    expect(typeof minimal).toBe("string");
    expect(minimal.length).toBeGreaterThan(0);

    // ordering preserved
    const ordered = geminiAdapter.buildHandoffPrompt({
      title: "Order test",
      objective: "Check ordering.",
      contextItems: [
        { title: "First", body: "First body." },
        { title: "Second", body: "Second body." },
        { title: "Third", body: "Third body." },
      ],
    });
    const firstPos = ordered.indexOf("## First");
    const secondPos = ordered.indexOf("## Second");
    const thirdPos = ordered.indexOf("## Third");
    expect(firstPos).toBeLessThan(secondPos);
    expect(secondPos).toBeLessThan(thirdPos);

    // starts with h1
    const startCheck = geminiAdapter.buildHandoffPrompt({
      title: "My Task",
      objective: "Some objective.",
      contextItems: [],
    });
    expect(startCheck.startsWith("# My Task")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Adapter metadata
// ---------------------------------------------------------------------------

describe("geminiAdapter metadata", () => {
  it("has correct provider, executable, and requiredEnvVars", () => {
    expect(geminiAdapter.provider).toBe("gemini");
    expect(geminiAdapter.executable).toBe("gemini");
    expect(geminiAdapter.requiredEnvVars).toEqual([]);
  });
});
