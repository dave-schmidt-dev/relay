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
    // executable-first and prompt-is-last are already covered by the full argv assertion above
    expect(argv[0]).toBe("codex");
    expect(argv[1]).toBe("exec");
    expect(argv[argv.length - 1]).toBe("hello world");
    expect(argv).not.toContain("--json");
  });

  it("uses the specified model", () => {
    const argv = codexAdapter.buildCommand("think hard", {
      model: "gpt-4o",
    });
    expect(argv).toContain("-m");
    expect(argv).toContain("gpt-4o");
    expect(argv).not.toContain("gpt-5.4");
  });

  it("adds --json flag when outputFormat is jsonl and omits it for text", () => {
    const jsonlArgv = codexAdapter.buildCommand("output in jsonl", { outputFormat: "jsonl" });
    expect(jsonlArgv).toContain("--json");

    const textArgv = codexAdapter.buildCommand("output in text", { outputFormat: "text" });
    expect(textArgv).not.toContain("--json");
  });

  it("prompt is the last element", () => {
    const prompt = "the final prompt";
    const argv = codexAdapter.buildCommand(prompt);
    expect(argv[argv.length - 1]).toBe(prompt);
  });
});

// ---------------------------------------------------------------------------
// parseOutput — text format (golden file)
// ---------------------------------------------------------------------------

describe("codexAdapter.parseOutput — text format", () => {
  it("returns trimmed text from the golden fixture, defaults to text, and trims whitespace", () => {
    const raw = readFixture("task-output.txt");
    expect(codexAdapter.parseOutput(raw, "text")).toBe("Hello from Codex. Nothing else.");
    expect(codexAdapter.parseOutput(raw)).toBe("Hello from Codex. Nothing else.");
    expect(codexAdapter.parseOutput("  Hello from Codex.  \n", "text")).toBe("Hello from Codex.");
  });
});

// ---------------------------------------------------------------------------
// parseOutput — JSONL format (golden file)
// ---------------------------------------------------------------------------

describe("codexAdapter.parseOutput — JSONL format", () => {
  it("extracts last assistant message from the golden JSONL fixture and returns the last when multiple exist", () => {
    const raw = readFixture("task-output-jsonl.jsonl");
    expect(codexAdapter.parseOutput(raw, "jsonl")).toBe("Hello from Codex.");

    const multiAssistant = [
      '{"type":"message","role":"assistant","content":"First response."}',
      '{"type":"message","role":"assistant","content":"Final response."}',
      '{"type":"session_end","exit_code":0}',
    ].join("\n");
    expect(codexAdapter.parseOutput(multiAssistant, "jsonl")).toBe("Final response.");
  });

  it("throws on no assistant message, non-string content, and completely invalid JSONL", () => {
    expect(() =>
      codexAdapter.parseOutput('{"type":"session_end","exit_code":0}\n', "jsonl"),
    ).toThrow(/no assistant message/);

    expect(() =>
      codexAdapter.parseOutput('{"type":"message","role":"assistant","content":42}\n', "jsonl"),
    ).toThrow(/non-string content/);

    expect(() => codexAdapter.parseOutput("not json at all", "jsonl")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// interpretExitCode
// ---------------------------------------------------------------------------

describe("codexAdapter.interpretExitCode", () => {
  it("maps exit codes to the correct success/reason values", () => {
    const ok = codexAdapter.interpretExitCode(0);
    expect(ok.success).toBe(true);
    expect(ok.reason).toBe("success");

    const general = codexAdapter.interpretExitCode(1);
    expect(general.success).toBe(false);
    expect(general.reason).toMatch(/general error/i);

    const unknown = codexAdapter.interpretExitCode(99);
    expect(unknown.success).toBe(false);
    expect(unknown.reason).toContain("99");

    const negative = codexAdapter.interpretExitCode(-1);
    expect(negative.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectRateLimit
// ---------------------------------------------------------------------------

describe("codexAdapter.detectRateLimit", () => {
  it("detects rate limit patterns (golden fixture and arbitrary text, case-insensitive)", () => {
    expect(codexAdapter.detectRateLimit(readFixture("status-error-unavailable.txt"))).toBe(true);
    expect(codexAdapter.detectRateLimit("You have hit the rate limit")).toBe(true);
    expect(codexAdapter.detectRateLimit("Error: too many requests, please wait")).toBe(true);
    expect(codexAdapter.detectRateLimit("RATE LIMIT exceeded")).toBe(true);
    expect(codexAdapter.detectRateLimit("Too Many Requests")).toBe(true);
    expect(codexAdapter.detectRateLimit("Data Not Available Yet")).toBe(true);
  });

  it("returns false for non-rate-limit text", () => {
    expect(codexAdapter.detectRateLimit(readFixture("task-output.txt"))).toBe(false);
    expect(codexAdapter.detectRateLimit(readFixture("task-stderr.txt"))).toBe(false);
    expect(codexAdapter.detectRateLimit("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

describe("codexAdapter.buildHandoffPrompt", () => {
  it("produces correct markdown: h1 title, h2 objective, context items included, empty context works, ordering preserved, starts with h1", () => {
    // h1 title + h2 objective
    const basic = codexAdapter.buildHandoffPrompt({
      title: "Implement the widget",
      objective: "Build a robust widget module.",
      contextItems: [],
    });
    expect(basic).toContain("# Implement the widget");
    expect(basic).toContain("## Objective");
    expect(basic).toContain("Build a robust widget module.");

    // context items included
    const withContext = codexAdapter.buildHandoffPrompt({
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
    const minimal = codexAdapter.buildHandoffPrompt({
      title: "Minimal",
      objective: "Just the objective.",
      contextItems: [],
    });
    expect(typeof minimal).toBe("string");
    expect(minimal.length).toBeGreaterThan(0);

    // ordering preserved
    const ordered = codexAdapter.buildHandoffPrompt({
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
    const startCheck = codexAdapter.buildHandoffPrompt({
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

describe("codexAdapter metadata", () => {
  it("has correct provider, executable, and requiredEnvVars", () => {
    expect(codexAdapter.provider).toBe("codex");
    expect(codexAdapter.executable).toBe("codex");
    expect(codexAdapter.requiredEnvVars).toContain("OPENAI_API_KEY");
  });
});
