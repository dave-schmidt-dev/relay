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
    expect(argv[0]).toBe("claude");
    expect(argv).not.toContain("--model");
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
});

// ---------------------------------------------------------------------------
// parseOutput — JSON format (golden file)
// ---------------------------------------------------------------------------

describe("claudeAdapter.parseOutput — JSON format", () => {
  it("extracts .result from the golden JSON fixture and defaults to JSON when format is omitted", () => {
    const raw = readFixture("task-output.json");
    expect(claudeAdapter.parseOutput(raw, "json")).toBe("Hello from Claude.");
    expect(claudeAdapter.parseOutput(raw)).toBe("Hello from Claude.");
  });

  it("throws on missing .result field or completely invalid JSON", () => {
    const malformed = JSON.stringify({ type: "result", subtype: "success" });
    expect(() => claudeAdapter.parseOutput(malformed, "json")).toThrow(
      /missing or non-string \.result/,
    );
    expect(() => claudeAdapter.parseOutput("not json", "json")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseOutput — text format (golden file)
// ---------------------------------------------------------------------------

describe("claudeAdapter.parseOutput — text format", () => {
  it("returns trimmed text from the golden fixture, trims whitespace, and handles stream-json", () => {
    const raw = readFixture("task-output-text.txt");
    expect(claudeAdapter.parseOutput(raw, "text")).toBe("Hello from Claude.");
    expect(claudeAdapter.parseOutput("  Hello from Claude.  \n", "text")).toBe(
      "Hello from Claude.",
    );
    expect(claudeAdapter.parseOutput("  some streamed output\n", "stream-json")).toBe(
      "some streamed output",
    );
  });
});

// ---------------------------------------------------------------------------
// interpretExitCode
// ---------------------------------------------------------------------------

describe("claudeAdapter.interpretExitCode", () => {
  it("maps exit codes to the correct success/reason values", () => {
    const ok = claudeAdapter.interpretExitCode(0);
    expect(ok.success).toBe(true);
    expect(ok.reason).toBe("success");

    const general = claudeAdapter.interpretExitCode(1);
    expect(general.success).toBe(false);
    expect(general.reason).toMatch(/general failure/i);

    const usage = claudeAdapter.interpretExitCode(2);
    expect(usage.success).toBe(false);
    expect(usage.reason).toMatch(/usage error/i);

    const unknown = claudeAdapter.interpretExitCode(99);
    expect(unknown.success).toBe(false);
    expect(unknown.reason).toContain("99");

    const negative = claudeAdapter.interpretExitCode(-1);
    expect(negative.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRateLimit
// ---------------------------------------------------------------------------

describe("claudeAdapter.detectRateLimit", () => {
  it("detects rate limit patterns (golden fixtures and arbitrary text)", () => {
    expect(claudeAdapter.detectRateLimit(readFixture("usage-error-rate-limit.txt"))).toBe(true);
    // The real-world typo: "vilable" not "available"
    expect(claudeAdapter.detectRateLimit(readFixture("usage-error-subscription.txt"))).toBe(true);
    expect(claudeAdapter.detectRateLimit("Error: rate_limit_error encountered")).toBe(true);
    expect(claudeAdapter.detectRateLimit("You have hit the rate limit for this API")).toBe(true);
  });

  it("returns false for non-rate-limit text", () => {
    expect(claudeAdapter.detectRateLimit(readFixture("task-output.json"))).toBe(false);
    expect(claudeAdapter.detectRateLimit(readFixture("task-output-text.txt"))).toBe(false);
    expect(claudeAdapter.detectRateLimit("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

describe("claudeAdapter.buildHandoffPrompt", () => {
  it("produces correct format: objective block, context items included, empty context works, ordering preserved", () => {
    // objective block
    const basic = claudeAdapter.buildHandoffPrompt({
      title: "Implement the widget",
      objective: "Build a robust widget module.",
      contextItems: [],
    });
    expect(basic).toContain("<objective>");
    expect(basic).toContain("# Implement the widget");
    expect(basic).toContain("Build a robust widget module.");
    expect(basic).toContain("</objective>");

    // context items included
    const withContext = claudeAdapter.buildHandoffPrompt({
      title: "Task",
      objective: "Objective text.",
      contextItems: [
        { title: "Prior Work", body: "Some prior work description." },
        { title: "Constraints", body: "No breaking changes." },
      ],
    });
    expect(withContext).toContain("<context>");
    expect(withContext).toContain('<context_item title="Prior Work">');
    expect(withContext).toContain("Some prior work description.");
    expect(withContext).toContain('<context_item title="Constraints">');
    expect(withContext).toContain("No breaking changes.");

    // empty context still produces a non-empty string
    const minimal = claudeAdapter.buildHandoffPrompt({
      title: "Minimal",
      objective: "Just the objective.",
      contextItems: [],
    });
    expect(typeof minimal).toBe("string");
    expect(minimal.length).toBeGreaterThan(0);

    // ordering preserved
    const ordered = claudeAdapter.buildHandoffPrompt({
      title: "Order test",
      objective: "Check ordering.",
      contextItems: [
        { title: "First", body: "First body." },
        { title: "Second", body: "Second body." },
        { title: "Third", body: "Third body." },
      ],
    });
    const firstPos = ordered.indexOf('title="First"');
    const secondPos = ordered.indexOf('title="Second"');
    const thirdPos = ordered.indexOf('title="Third"');
    expect(firstPos).toBeLessThan(secondPos);
    expect(secondPos).toBeLessThan(thirdPos);
  });
});

// ---------------------------------------------------------------------------
// Adapter metadata
// ---------------------------------------------------------------------------

describe("claudeAdapter metadata", () => {
  it("has correct provider, executable, and requiredEnvVars", () => {
    expect(claudeAdapter.provider).toBe("claude");
    expect(claudeAdapter.executable).toBe("claude");
    expect(claudeAdapter.requiredEnvVars).toContain("ANTHROPIC_API_KEY");
  });
});
