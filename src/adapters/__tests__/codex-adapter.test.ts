/**
 * Unit tests for the Codex provider adapter.
 *
 * Uses golden fixtures from fixtures/codex/ to validate parsing logic against
 * real captured CLI output rather than invented strings.
 *
 * REQ-004, REQ-013
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { codexAdapter } from "../codex-adapter.js";

// Fixtures are at <project root>/fixtures/codex/.
// Test file is 4 directories deep: src/adapters/__tests__/<file>.
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/codex");

function readFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), "utf8");
}

// ---------------------------------------------------------------------------
// buildCommand
// ---------------------------------------------------------------------------

describe("codexAdapter.buildCommand", () => {
  it("produces correct argv with default model and text format", () => {
    const argv = codexAdapter.buildCommand("hello world");
    expect(argv).toEqual([
      "codex",
      "exec",
      "--skip-git-repo-check",
      "-m",
      "gpt-5.4",
      "hello world",
    ]);
  });

  it("always includes --skip-git-repo-check", () => {
    const argv = codexAdapter.buildCommand("do something");
    expect(argv).toContain("--skip-git-repo-check");
  });

  it("uses the specified model", () => {
    const argv = codexAdapter.buildCommand("think hard", {
      model: "gpt-4o",
    });
    expect(argv).toContain("-m");
    expect(argv).toContain("gpt-4o");
    expect(argv).not.toContain("gpt-5.4");
  });

  it("adds --json flag when outputFormat is jsonl", () => {
    const argv = codexAdapter.buildCommand("output in jsonl", {
      outputFormat: "jsonl",
    });
    expect(argv).toContain("--json");
  });

  it("does not add --json flag for text format", () => {
    const argv = codexAdapter.buildCommand("output in text", {
      outputFormat: "text",
    });
    expect(argv).not.toContain("--json");
  });

  it("defaults to text format (no --json flag)", () => {
    const argv = codexAdapter.buildCommand("no format specified");
    expect(argv).not.toContain("--json");
  });

  it("prompt is the last element", () => {
    const prompt = "the final prompt";
    const argv = codexAdapter.buildCommand(prompt);
    expect(argv[argv.length - 1]).toBe(prompt);
  });

  it("executable is the first element", () => {
    const argv = codexAdapter.buildCommand("x");
    expect(argv[0]).toBe("codex");
  });

  it("second element is 'exec'", () => {
    const argv = codexAdapter.buildCommand("x");
    expect(argv[1]).toBe("exec");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — text format (golden file)
// ---------------------------------------------------------------------------

describe("codexAdapter.parseOutput — text format", () => {
  it("returns trimmed text from the golden text fixture", () => {
    const raw = readFixture("task-output.txt");
    const result = codexAdapter.parseOutput(raw, "text");
    expect(result).toBe("Hello from Codex. Nothing else.");
  });

  it("defaults to text parsing when outputFormat is omitted", () => {
    const raw = readFixture("task-output.txt");
    const result = codexAdapter.parseOutput(raw);
    expect(result).toBe("Hello from Codex. Nothing else.");
  });

  it("trims surrounding whitespace", () => {
    const padded = "  Hello from Codex.  \n";
    expect(codexAdapter.parseOutput(padded, "text")).toBe("Hello from Codex.");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — JSONL format (golden file)
// ---------------------------------------------------------------------------

describe("codexAdapter.parseOutput — JSONL format", () => {
  it("extracts last assistant message from the golden JSONL fixture", () => {
    const raw = readFixture("task-output-jsonl.jsonl");
    const result = codexAdapter.parseOutput(raw, "jsonl");
    expect(result).toBe("Hello from Codex.");
  });

  it("throws when JSONL contains no assistant message", () => {
    const noAssistant = '{"type":"session_end","exit_code":0}\n';
    expect(() => codexAdapter.parseOutput(noAssistant, "jsonl")).toThrow(/no assistant message/);
  });

  it("throws when assistant message has non-string content", () => {
    const badContent = '{"type":"message","role":"assistant","content":42}\n';
    expect(() => codexAdapter.parseOutput(badContent, "jsonl")).toThrow(/non-string content/);
  });

  it("throws on completely invalid JSONL", () => {
    expect(() => codexAdapter.parseOutput("not json at all", "jsonl")).toThrow();
  });

  it("returns the last assistant message when multiple exist", () => {
    const multiAssistant = [
      '{"type":"message","role":"assistant","content":"First response."}',
      '{"type":"message","role":"assistant","content":"Final response."}',
      '{"type":"session_end","exit_code":0}',
    ].join("\n");
    const result = codexAdapter.parseOutput(multiAssistant, "jsonl");
    expect(result).toBe("Final response.");
  });
});

// ---------------------------------------------------------------------------
// interpretExitCode
// ---------------------------------------------------------------------------

describe("codexAdapter.interpretExitCode", () => {
  it("maps exit code 0 to success", () => {
    const result = codexAdapter.interpretExitCode(0);
    expect(result.success).toBe(true);
    expect(result.reason).toBe("success");
  });

  it("maps exit code 1 to general error", () => {
    const result = codexAdapter.interpretExitCode(1);
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/general error/i);
  });

  it("maps an unknown exit code to failure with code in reason", () => {
    const result = codexAdapter.interpretExitCode(99);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("99");
  });

  it("maps negative exit codes to failure", () => {
    const result = codexAdapter.interpretExitCode(-1);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRateLimit — golden fixture
// ---------------------------------------------------------------------------

describe("codexAdapter.detectRateLimit", () => {
  it("detects 'data not available yet' from the golden error fixture", () => {
    const raw = readFixture("status-error-unavailable.txt");
    expect(codexAdapter.detectRateLimit(raw)).toBe(true);
  });

  it("detects 'rate limit' in arbitrary text", () => {
    expect(codexAdapter.detectRateLimit("You have hit the rate limit")).toBe(true);
  });

  it("detects 'too many requests' in arbitrary text", () => {
    expect(codexAdapter.detectRateLimit("Error: too many requests, please wait")).toBe(true);
  });

  it("is case-insensitive for rate limit patterns", () => {
    expect(codexAdapter.detectRateLimit("RATE LIMIT exceeded")).toBe(true);
    expect(codexAdapter.detectRateLimit("Too Many Requests")).toBe(true);
    expect(codexAdapter.detectRateLimit("Data Not Available Yet")).toBe(true);
  });

  it("returns false for normal task output", () => {
    const raw = readFixture("task-output.txt");
    expect(codexAdapter.detectRateLimit(raw)).toBe(false);
  });

  it("returns false for session metadata on stderr", () => {
    const raw = readFixture("task-stderr.txt");
    expect(codexAdapter.detectRateLimit(raw)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(codexAdapter.detectRateLimit("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

describe("codexAdapter.buildHandoffPrompt", () => {
  it("produces a markdown string with the task title as h1", () => {
    const prompt = codexAdapter.buildHandoffPrompt({
      title: "Implement the widget",
      objective: "Build a robust widget module.",
      contextItems: [],
    });
    expect(prompt).toContain("# Implement the widget");
  });

  it("includes the objective under an h2 heading", () => {
    const prompt = codexAdapter.buildHandoffPrompt({
      title: "Task",
      objective: "Do the thing correctly.",
      contextItems: [],
    });
    expect(prompt).toContain("## Objective");
    expect(prompt).toContain("Do the thing correctly.");
  });

  it("includes each context item as its own h2 section", () => {
    const prompt = codexAdapter.buildHandoffPrompt({
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
    const prompt = codexAdapter.buildHandoffPrompt({
      title: "Minimal",
      objective: "Just the objective.",
      contextItems: [],
    });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("preserves ordering of context items", () => {
    const prompt = codexAdapter.buildHandoffPrompt({
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
    const prompt = codexAdapter.buildHandoffPrompt({
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

describe("codexAdapter metadata", () => {
  it("provider is 'codex'", () => {
    expect(codexAdapter.provider).toBe("codex");
  });

  it("executable is 'codex'", () => {
    expect(codexAdapter.executable).toBe("codex");
  });

  it("requiredEnvVars includes OPENAI_API_KEY", () => {
    expect(codexAdapter.requiredEnvVars).toContain("OPENAI_API_KEY");
  });
});
