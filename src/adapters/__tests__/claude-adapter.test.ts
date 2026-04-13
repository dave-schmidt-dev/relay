/**
 * Unit tests for the Claude provider adapter.
 *
 * Uses golden fixtures from fixtures/claude/ to validate parsing logic against
 * real captured CLI output rather than invented strings.
 *
 * REQ-004, REQ-013
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { claudeAdapter } from "../claude-adapter.js";

// Fixtures are at <project root>/fixtures/claude/.
// Test file is 4 directories deep: src/adapters/__tests__/<file>.
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/claude");

function readFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), "utf8");
}

// ---------------------------------------------------------------------------
// buildCommand
// ---------------------------------------------------------------------------

describe("claudeAdapter.buildCommand", () => {
  it("produces correct argv with default output format", () => {
    const argv = claudeAdapter.buildCommand("hello world");
    expect(argv).toEqual(["claude", "-p", "hello world", "--output-format", "json"]);
  });

  it("uses the specified output format", () => {
    const argv = claudeAdapter.buildCommand("do something", {
      outputFormat: "text",
    });
    expect(argv).toEqual(["claude", "-p", "do something", "--output-format", "text"]);
  });

  it("appends --model when a model is specified", () => {
    const argv = claudeAdapter.buildCommand("think hard", {
      model: "claude-opus-4-6",
      outputFormat: "json",
    });
    expect(argv).toEqual([
      "claude",
      "-p",
      "think hard",
      "--output-format",
      "json",
      "--model",
      "claude-opus-4-6",
    ]);
  });

  it("does not include --model when no model is given", () => {
    const argv = claudeAdapter.buildCommand("simple task");
    expect(argv).not.toContain("--model");
  });

  it("executable is the first element", () => {
    const argv = claudeAdapter.buildCommand("x");
    expect(argv[0]).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — JSON format (golden file)
// ---------------------------------------------------------------------------

describe("claudeAdapter.parseOutput — JSON format", () => {
  it("extracts .result from the golden JSON fixture", () => {
    const raw = readFixture("task-output.json");
    const result = claudeAdapter.parseOutput(raw, "json");
    expect(result).toBe("Hello from Claude.");
  });

  it("defaults to JSON parsing when outputFormat is omitted", () => {
    const raw = readFixture("task-output.json");
    const result = claudeAdapter.parseOutput(raw);
    expect(result).toBe("Hello from Claude.");
  });

  it("throws when JSON output lacks a .result field", () => {
    const malformed = JSON.stringify({ type: "result", subtype: "success" });
    expect(() => claudeAdapter.parseOutput(malformed, "json")).toThrow(
      /missing or non-string \.result/,
    );
  });

  it("throws on completely invalid JSON", () => {
    expect(() => claudeAdapter.parseOutput("not json", "json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseOutput — text format (golden file)
// ---------------------------------------------------------------------------

describe("claudeAdapter.parseOutput — text format", () => {
  it("returns trimmed text from the golden text fixture", () => {
    const raw = readFixture("task-output-text.txt");
    const result = claudeAdapter.parseOutput(raw, "text");
    expect(result).toBe("Hello from Claude.");
  });

  it("trims surrounding whitespace", () => {
    const padded = "  Hello from Claude.  \n";
    expect(claudeAdapter.parseOutput(padded, "text")).toBe("Hello from Claude.");
  });

  it("treats stream-json format the same as text (trimmed raw stdout)", () => {
    const raw = "  some streamed output\n";
    expect(claudeAdapter.parseOutput(raw, "stream-json")).toBe("some streamed output");
  });
});

// ---------------------------------------------------------------------------
// interpretExitCode
// ---------------------------------------------------------------------------

describe("claudeAdapter.interpretExitCode", () => {
  it("maps exit code 0 to success", () => {
    const result = claudeAdapter.interpretExitCode(0);
    expect(result.success).toBe(true);
    expect(result.reason).toBe("success");
  });

  it("maps exit code 1 to failure with a descriptive reason", () => {
    const result = claudeAdapter.interpretExitCode(1);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/general failure/i);
  });

  it("maps exit code 2 to usage error", () => {
    const result = claudeAdapter.interpretExitCode(2);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/usage error/i);
  });

  it("maps an unknown exit code to failure with code in reason", () => {
    const result = claudeAdapter.interpretExitCode(99);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("99");
  });

  it("maps negative exit codes to failure", () => {
    const result = claudeAdapter.interpretExitCode(-1);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRateLimit — golden fixture
// ---------------------------------------------------------------------------

describe("claudeAdapter.detectRateLimit", () => {
  it("detects rate limit pattern in the golden rate-limit fixture", () => {
    const raw = readFixture("usage-error-rate-limit.txt");
    expect(claudeAdapter.detectRateLimit(raw)).toBe(true);
  });

  it("detects the subscription-plan typo pattern", () => {
    // The real-world typo: "vilable" not "available"
    const raw = readFixture("usage-error-subscription.txt");
    expect(claudeAdapter.detectRateLimit(raw)).toBe(true);
  });

  it("detects 'rate_limit_error' in arbitrary text", () => {
    expect(claudeAdapter.detectRateLimit("Error: rate_limit_error encountered")).toBe(true);
  });

  it("detects 'rate limit' (with space) in arbitrary text", () => {
    expect(claudeAdapter.detectRateLimit("You have hit the rate limit for this API")).toBe(true);
  });

  it("returns false for normal task output", () => {
    const raw = readFixture("task-output.json");
    expect(claudeAdapter.detectRateLimit(raw)).toBe(false);
  });

  it("returns false for plain text output", () => {
    const raw = readFixture("task-output-text.txt");
    expect(claudeAdapter.detectRateLimit(raw)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(claudeAdapter.detectRateLimit("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

describe("claudeAdapter.buildHandoffPrompt", () => {
  it("produces a markdown string with the task title as h1", () => {
    const prompt = claudeAdapter.buildHandoffPrompt({
      title: "Implement the widget",
      objective: "Build a robust widget module.",
      contextItems: [],
    });
    expect(prompt).toContain("# Implement the widget");
  });

  it("includes the objective under an h2 heading", () => {
    const prompt = claudeAdapter.buildHandoffPrompt({
      title: "Task",
      objective: "Do the thing correctly.",
      contextItems: [],
    });
    expect(prompt).toContain("## Objective");
    expect(prompt).toContain("Do the thing correctly.");
  });

  it("includes each context item as its own h2 section", () => {
    const prompt = claudeAdapter.buildHandoffPrompt({
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

  it("produces a string (not empty) even with no context items", () => {
    const prompt = claudeAdapter.buildHandoffPrompt({
      title: "Minimal",
      objective: "Just the objective.",
      contextItems: [],
    });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("preserves ordering of context items", () => {
    const prompt = claudeAdapter.buildHandoffPrompt({
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
});

// ---------------------------------------------------------------------------
// Adapter metadata
// ---------------------------------------------------------------------------

describe("claudeAdapter metadata", () => {
  it("provider is 'claude'", () => {
    expect(claudeAdapter.provider).toBe("claude");
  });

  it("executable is 'claude'", () => {
    expect(claudeAdapter.executable).toBe("claude");
  });

  it("requiredEnvVars includes ANTHROPIC_API_KEY", () => {
    expect(claudeAdapter.requiredEnvVars).toContain("ANTHROPIC_API_KEY");
  });
});
