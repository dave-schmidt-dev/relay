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

  it("parses as valid JSON", () => {
    expect(() => parseTaskOutput()).not.toThrow();
  });

  it('type is "result"', () => {
    expect(parseTaskOutput().type).toBe("result");
  });

  it('subtype is "success"', () => {
    expect(parseTaskOutput().subtype).toBe("success");
  });

  it("is_error is false for a successful run", () => {
    expect(parseTaskOutput().is_error).toBe(false);
  });

  it("result field contains the model response text", () => {
    const { result } = parseTaskOutput();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe("Hello from Claude.");
  });

  it("usage block has required token fields", () => {
    const { usage } = parseTaskOutput();
    expect(typeof usage).toBe("object");
    expect(typeof usage.input_tokens).toBe("number");
    expect(typeof usage.output_tokens).toBe("number");
    expect(typeof usage.cache_creation_input_tokens).toBe("number");
    expect(typeof usage.cache_read_input_tokens).toBe("number");
  });

  it("usage block has server_tool_use sub-object", () => {
    const { server_tool_use } = parseTaskOutput().usage;
    expect(typeof server_tool_use).toBe("object");
    expect(typeof server_tool_use.web_search_requests).toBe("number");
    expect(typeof server_tool_use.web_fetch_requests).toBe("number");
  });

  it("modelUsage has at least one model entry", () => {
    const keys = Object.keys(parseTaskOutput().modelUsage);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("modelUsage entries have required cost and token fields", () => {
    for (const [model, entry] of Object.entries(parseTaskOutput().modelUsage)) {
      expect(typeof entry.inputTokens, `${model}.inputTokens`).toBe("number");
      expect(typeof entry.outputTokens, `${model}.outputTokens`).toBe("number");
      expect(typeof entry.costUSD, `${model}.costUSD`).toBe("number");
      expect(typeof entry.contextWindow, `${model}.contextWindow`).toBe("number");
      expect(typeof entry.maxOutputTokens, `${model}.maxOutputTokens`).toBe("number");
    }
  });

  it("total_cost_usd is a non-negative number", () => {
    const { total_cost_usd } = parseTaskOutput();
    expect(typeof total_cost_usd).toBe("number");
    expect(total_cost_usd).toBeGreaterThanOrEqual(0);
  });

  it("session_id is a non-empty string", () => {
    const { session_id } = parseTaskOutput();
    expect(typeof session_id).toBe("string");
    expect(session_id.length).toBeGreaterThan(0);
  });

  it("permission_denials is an array", () => {
    expect(Array.isArray(parseTaskOutput().permission_denials)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Text task output
// ---------------------------------------------------------------------------

describe("claude golden files: task-output-text.txt", () => {
  it("contains plain text (no JSON structure)", () => {
    const raw = readFixture("task-output-text.txt");
    // Wrap in void to avoid returning `any` from JSON.parse.
    expect(() => {
      JSON.parse(raw);
    }).toThrow();
  });

  it("contains no ANSI escape sequences", () => {
    const raw = readFixture("task-output-text.txt");
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
    const raw = readFixture("task-output-text.txt");
    expect(raw.trim()).toBe("Hello from Claude.");
  });
});

// ---------------------------------------------------------------------------
// Usage probe — clean sample
// ---------------------------------------------------------------------------

describe("claude golden files: usage-probe-clean.txt", () => {
  it('contains "Current session" section', () => {
    const raw = readFixture("usage-probe-clean.txt");
    expect(raw).toContain("Current session");
  });

  it('contains "Current week" section', () => {
    const raw = readFixture("usage-probe-clean.txt");
    expect(raw).toContain("Current week");
  });

  it("contains a percent-used value in the session section", () => {
    const raw = readFixture("usage-probe-clean.txt");
    // e.g. "27% used" or "64% left"
    expect(raw).toMatch(/\d+%\s+(used|left)/);
  });

  it('contains "Opus" section for per-model tracking', () => {
    const raw = readFixture("usage-probe-clean.txt");
    expect(raw).toContain("Opus");
  });

  it("contains reset time information", () => {
    const raw = readFixture("usage-probe-clean.txt");
    expect(raw).toMatch(/Resets/i);
  });

  it("contains account email", () => {
    const raw = readFixture("usage-probe-clean.txt");
    expect(raw).toMatch(/Account:\s*.+@.+\..+/);
  });

  it("contains organization name", () => {
    const raw = readFixture("usage-probe-clean.txt");
    expect(raw).toContain("Organization:");
  });

  it("session percent parsed: 27% used → 73% left", () => {
    const raw = readFixture("usage-probe-clean.txt");
    // Extract "27% used" from session section — parser will compute 100-27=73% left
    const match = /Current session[\s\S]*?(\d+)%\s+used/.exec(raw);
    expect(match).not.toBeNull();
    const usedPct = parseInt(match?.[1] ?? "", 10);
    expect(usedPct).toBe(27);
    expect(100 - usedPct).toBe(73);
  });

  it("weekly percent parsed: 64% left stays as-is", () => {
    const raw = readFixture("usage-probe-clean.txt");
    const match = /Current week \(all models\)[\s\S]*?(\d+)%\s+left/.exec(raw);
    expect(match).not.toBeNull();
    const leftPct = parseInt(match?.[1] ?? "", 10);
    expect(leftPct).toBe(64);
  });

  it("opus percent parsed: 18% used → 82% left", () => {
    const raw = readFixture("usage-probe-clean.txt");
    const match = /Current week \(Opus\)[\s\S]*?(\d+)%\s+used/.exec(raw);
    expect(match).not.toBeNull();
    const usedPct = parseInt(match?.[1] ?? "", 10);
    expect(usedPct).toBe(18);
    expect(100 - usedPct).toBe(82);
  });
});

// ---------------------------------------------------------------------------
// Usage probe — live terminal style sample
// ---------------------------------------------------------------------------

describe("claude golden files: usage-probe-live-style.txt", () => {
  it('contains "Current session" text (compacted or spaced)', () => {
    const raw = readFixture("usage-probe-live-style.txt");
    // The live style compacts whitespace: "Current session" or similar
    expect(raw).toMatch(/Current\s*session/i);
  });

  it("contains a percentage value", () => {
    const raw = readFixture("usage-probe-live-style.txt");
    expect(raw).toMatch(/\d+%/);
  });

  it("contains reset time reference", () => {
    const raw = readFixture("usage-probe-live-style.txt");
    expect(raw).toMatch(/Reset/i);
  });

  it('contains "week" reference for weekly quota', () => {
    const raw = readFixture("usage-probe-live-style.txt");
    expect(raw).toMatch(/week/i);
  });

  it("session percent parsed: 70% used → 30% left", () => {
    const raw = readFixture("usage-probe-live-style.txt");
    // Compacted: "70%used"
    const match = /(\d+)%\s*used/i.exec(raw);
    expect(match).not.toBeNull();
    const usedPct = parseInt(match?.[1] ?? "", 10);
    expect(usedPct).toBe(70);
    expect(100 - usedPct).toBe(30);
  });

  it("weekly percent parsed: 48% used → 52% left", () => {
    const raw = readFixture("usage-probe-live-style.txt");
    // Find the second occurrence of "%used" — first is session, second is weekly
    const matches = [...raw.matchAll(/(\d+)%\s*used/gi)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const weeklyMatch = matches[1];
    expect(weeklyMatch).toBeDefined();
    const usedPct = parseInt(weeklyMatch?.[1] ?? "", 10);
    expect(usedPct).toBe(48);
    expect(100 - usedPct).toBe(52);
  });
});

// ---------------------------------------------------------------------------
// Error samples
// ---------------------------------------------------------------------------

describe("claude golden files: usage-error-rate-limit.txt", () => {
  it("contains rate limit error pattern", () => {
    const raw = readFixture("usage-error-rate-limit.txt");
    expect(raw).toContain("rate limited");
  });

  it("contains 'Failed to load usage data' prefix", () => {
    const raw = readFixture("usage-error-rate-limit.txt");
    expect(raw).toContain("Failed to load usage data");
  });
});

describe("claude golden files: usage-error-subscription.txt", () => {
  it("contains subscription plan error pattern", () => {
    const raw = readFixture("usage-error-subscription.txt");
    expect(raw).toContain("subscription plans");
  });

  it("contains /usage command reference", () => {
    const raw = readFixture("usage-error-subscription.txt");
    expect(raw).toContain("/usage");
  });

  it('preserves real-world typo "vilable" (not "available")', () => {
    // NOTE: This typo exists in the actual Claude CLI output. Preserve it as-is
    // so parsers can match on the real string, not a corrected version.
    const raw = readFixture("usage-error-subscription.txt");
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

  it("parses as valid JSON", () => {
    expect(() => parseMetadata()).not.toThrow();
  });

  it("has a version field", () => {
    const meta = parseMetadata();
    expect(typeof meta.version).toBe("string");
    expect(meta.version.length).toBeGreaterThan(0);
  });

  it("version matches captured CLI version", () => {
    const meta = parseMetadata();
    expect(meta.version).toBe("2.1.92");
  });

  it("has exit_codes map with key '0' for success", () => {
    const meta = parseMetadata();
    expect(typeof meta.exit_codes).toBe("object");
    expect(meta.exit_codes["0"]).toBeDefined();
    expect(meta.exit_codes["0"]).toMatch(/success/i);
  });

  it("has exit_codes map with key '1' for error", () => {
    const meta = parseMetadata();
    expect(meta.exit_codes["1"]).toBeDefined();
    expect(meta.exit_codes["1"]).toMatch(/error/i);
  });

  it("json_output_fields includes required fields", () => {
    const meta = parseMetadata();
    const required = ["type", "result", "usage", "modelUsage"];
    for (const field of required) {
      expect(meta.json_output_fields, `json_output_fields must include "${field}"`).toContain(
        field,
      );
    }
  });

  it("flags map includes -p task flag", () => {
    const meta = parseMetadata();
    expect(meta.flags.task).toBe("-p");
  });

  it("rate_limit_patterns is a non-empty array of strings", () => {
    const meta = parseMetadata();
    expect(Array.isArray(meta.rate_limit_patterns)).toBe(true);
    expect(meta.rate_limit_patterns.length).toBeGreaterThan(0);
    for (const pattern of meta.rate_limit_patterns) {
      expect(typeof pattern).toBe("string");
    }
  });
});
