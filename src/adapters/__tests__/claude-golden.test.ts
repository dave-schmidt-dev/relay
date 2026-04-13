/**
 * Golden file tests for Claude CLI fixtures.
 *
 * These tests validate the fixture files themselves — verifying that captured
 * CLI output samples exist, are non-empty, and have the structure expected by
 * future adapter and probe parsers (Phase 1, TASK-009 / TASK-014b).
 *
 * NOTE: No parsing logic lives here yet. These tests lock down the shape of
 * the raw captures so parser development has a stable contract to work against.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Golden files are at <project root>/fixtures/claude/
// Test file is at src/adapters/__tests__/ — 4 levels up is project root.
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/claude");

function readFixture(filename: string): string {
  const fullPath = path.join(fixturesDir, filename);
  return fs.readFileSync(fullPath, "utf8");
}

// ---------------------------------------------------------------------------
// Fixture presence
// ---------------------------------------------------------------------------

describe("claude golden files: fixture presence", () => {
  const expectedFiles = [
    "task-output.json",
    "task-output-text.txt",
    "usage-probe-clean.txt",
    "usage-probe-live-style.txt",
    "usage-error-rate-limit.txt",
    "usage-error-subscription.txt",
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
// JSON task output
// ---------------------------------------------------------------------------

describe("claude golden files: task-output.json", () => {
  // Parse once for all assertions in this describe block.
  interface ServerToolUse {
    web_search_requests: number;
    web_fetch_requests: number;
  }

  interface UsageBlock {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
    server_tool_use: ServerToolUse;
    service_tier: string;
  }

  interface ModelUsageEntry {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    contextWindow: number;
    maxOutputTokens: number;
  }

  interface TaskOutput {
    type: string;
    subtype: string;
    is_error: boolean;
    duration_ms: number;
    duration_api_ms: number;
    num_turns: number;
    result: string;
    stop_reason: string;
    session_id: string;
    total_cost_usd: number;
    usage: UsageBlock;
    modelUsage: Record<string, ModelUsageEntry>;
    permission_denials: unknown[];
    terminal_reason: string;
    fast_mode_state: string;
  }

  // Helper to re-parse the fixture for each test (no shared mutable state).
  function parseTaskOutput(): TaskOutput {
    const raw = readFixture("task-output.json");
    return JSON.parse(raw) as TaskOutput;
  }

  it("has valid structure with expected fields", () => {
    expect(() => parseTaskOutput()).not.toThrow();
    const data = parseTaskOutput();

    expect(data.type).toBe("result");
    expect(data.subtype).toBe("success");
    expect(data.is_error).toBe(false);

    const { result } = data;
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe("Hello from Claude.");

    const { usage } = data;
    expect(typeof usage).toBe("object");
    expect(typeof usage.input_tokens).toBe("number");
    expect(typeof usage.output_tokens).toBe("number");
    expect(typeof usage.cache_creation_input_tokens).toBe("number");
    expect(typeof usage.cache_read_input_tokens).toBe("number");

    const { server_tool_use } = usage;
    expect(typeof server_tool_use).toBe("object");
    expect(typeof server_tool_use.web_search_requests).toBe("number");
    expect(typeof server_tool_use.web_fetch_requests).toBe("number");

    const keys = Object.keys(data.modelUsage);
    expect(keys.length).toBeGreaterThan(0);
    for (const [model, entry] of Object.entries(data.modelUsage)) {
      expect(typeof entry.inputTokens, `${model}.inputTokens`).toBe("number");
      expect(typeof entry.outputTokens, `${model}.outputTokens`).toBe("number");
      expect(typeof entry.costUSD, `${model}.costUSD`).toBe("number");
      expect(typeof entry.contextWindow, `${model}.contextWindow`).toBe("number");
      expect(typeof entry.maxOutputTokens, `${model}.maxOutputTokens`).toBe("number");
    }

    expect(typeof data.total_cost_usd).toBe("number");
    expect(data.total_cost_usd).toBeGreaterThanOrEqual(0);

    expect(typeof data.session_id).toBe("string");
    expect(data.session_id.length).toBeGreaterThan(0);

    expect(Array.isArray(data.permission_denials)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Text task output
// ---------------------------------------------------------------------------

describe("claude golden files: task-output-text.txt", () => {
  it("contains plain unescaped text matching expected response", () => {
    const raw = readFixture("task-output-text.txt");

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

    expect(raw.trim()).toBe("Hello from Claude.");
  });
});

// ---------------------------------------------------------------------------
// Usage probe — clean sample
// ---------------------------------------------------------------------------

describe("claude golden files: usage-probe-clean.txt", () => {
  it("contains all expected sections, labels, and parsed values", () => {
    const raw = readFixture("usage-probe-clean.txt");

    expect(raw).toContain("Current session");
    expect(raw).toContain("Current week");
    // e.g. "27% used" or "64% left"
    expect(raw).toMatch(/\d+%\s+(used|left)/);
    expect(raw).toContain("Opus");
    expect(raw).toMatch(/Resets/i);
    expect(raw).toMatch(/Account:\s*.+@.+\..+/);
    expect(raw).toContain("Organization:");

    // session percent parsed: 27% used → 73% left
    const sessionMatch = /Current session[\s\S]*?(\d+)%\s+used/.exec(raw);
    expect(sessionMatch).not.toBeNull();
    const sessionUsedPct = parseInt(sessionMatch?.[1] ?? "", 10);
    expect(sessionUsedPct).toBe(27);
    expect(100 - sessionUsedPct).toBe(73);

    // weekly percent parsed: 64% left stays as-is
    const weeklyMatch = /Current week \(all models\)[\s\S]*?(\d+)%\s+left/.exec(raw);
    expect(weeklyMatch).not.toBeNull();
    const weeklyLeftPct = parseInt(weeklyMatch?.[1] ?? "", 10);
    expect(weeklyLeftPct).toBe(64);

    // opus percent parsed: 18% used → 82% left
    const opusMatch = /Current week \(Opus\)[\s\S]*?(\d+)%\s+used/.exec(raw);
    expect(opusMatch).not.toBeNull();
    const opusUsedPct = parseInt(opusMatch?.[1] ?? "", 10);
    expect(opusUsedPct).toBe(18);
    expect(100 - opusUsedPct).toBe(82);
  });
});

// ---------------------------------------------------------------------------
// Usage probe — live terminal style sample
// ---------------------------------------------------------------------------

describe("claude golden files: usage-probe-live-style.txt", () => {
  it("contains expected sections and parsed percentage values", () => {
    const raw = readFixture("usage-probe-live-style.txt");

    // The live style compacts whitespace: "Current session" or similar
    expect(raw).toMatch(/Current\s*session/i);
    expect(raw).toMatch(/\d+%/);
    expect(raw).toMatch(/Reset/i);
    expect(raw).toMatch(/week/i);

    // session percent parsed: 70% used → 30% left
    // Compacted: "70%used"
    const sessionMatch = /(\d+)%\s*used/i.exec(raw);
    expect(sessionMatch).not.toBeNull();
    const sessionUsedPct = parseInt(sessionMatch?.[1] ?? "", 10);
    expect(sessionUsedPct).toBe(70);
    expect(100 - sessionUsedPct).toBe(30);

    // weekly percent parsed: 48% used → 52% left
    // Find the second occurrence of "%used" — first is session, second is weekly
    const matches = [...raw.matchAll(/(\d+)%\s*used/gi)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const weeklyMatch = matches[1];
    expect(weeklyMatch).toBeDefined();
    const weeklyUsedPct = parseInt(weeklyMatch?.[1] ?? "", 10);
    expect(weeklyUsedPct).toBe(48);
    expect(100 - weeklyUsedPct).toBe(52);
  });
});

// ---------------------------------------------------------------------------
// Error samples
// ---------------------------------------------------------------------------

describe("claude golden files: usage-error-rate-limit.txt", () => {
  it("contains rate limit error indicators", () => {
    const raw = readFixture("usage-error-rate-limit.txt");
    expect(raw).toContain("rate limited");
    expect(raw).toContain("Failed to load usage data");
  });
});

describe("claude golden files: usage-error-subscription.txt", () => {
  it("contains subscription error indicators with real-world typo preserved", () => {
    const raw = readFixture("usage-error-subscription.txt");
    expect(raw).toContain("subscription plans");
    expect(raw).toContain("/usage");
    // NOTE: This typo exists in the actual Claude CLI output. Preserve it as-is
    // so parsers can match on the real string, not a corrected version.
    expect(raw).toContain("vilable");
    expect(raw).not.toContain("available");
  });
});

// ---------------------------------------------------------------------------
// CLI metadata
// ---------------------------------------------------------------------------

describe("claude golden files: cli-metadata.json", () => {
  interface CliFlags {
    task: string;
    output_format: string;
    output_format_values: string[];
    [key: string]: unknown;
  }

  interface CliMetadata {
    version: string;
    name: string;
    flags: CliFlags;
    exit_codes: Record<string, string>;
    json_output_fields: string[];
    usage_probe: Record<string, unknown>;
    rate_limit_patterns: string[];
  }

  function parseMetadata(): CliMetadata {
    const raw = readFixture("cli-metadata.json");
    return JSON.parse(raw) as CliMetadata;
  }

  it("has valid structure with expected fields and values", () => {
    expect(() => parseMetadata()).not.toThrow();
    const meta = parseMetadata();

    expect(typeof meta.version).toBe("string");
    expect(meta.version.length).toBeGreaterThan(0);
    expect(meta.version).toBe("2.1.92");

    expect(typeof meta.exit_codes).toBe("object");
    expect(meta.exit_codes["0"]).toBeDefined();
    expect(meta.exit_codes["0"]).toMatch(/success/i);
    expect(meta.exit_codes["1"]).toBeDefined();
    expect(meta.exit_codes["1"]).toMatch(/error/i);

    const required = ["type", "result", "usage", "modelUsage"];
    for (const field of required) {
      expect(meta.json_output_fields, `json_output_fields must include "${field}"`).toContain(
        field,
      );
    }

    expect(meta.flags.task).toBe("-p");

    expect(Array.isArray(meta.rate_limit_patterns)).toBe(true);
    expect(meta.rate_limit_patterns.length).toBeGreaterThan(0);
    for (const pattern of meta.rate_limit_patterns) {
      expect(typeof pattern).toBe("string");
    }
  });
});
