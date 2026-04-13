/**
 * Tests for the Claude /usage output parser.
 *
 * Covers golden fixtures for clean and live-style output, error detection,
 * and edge cases (TASK-014b, REQ-014).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseClaudeUsage, type ClaudeUsageSnapshot } from "../claude-probe.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Test file lives at src/prober/__tests__/ -- 4 levels up is project root.
const fixturesBase = path.resolve(import.meta.dirname, "../../../fixtures");

function readFixture(provider: string, filename: string): string {
  return fs.readFileSync(path.join(fixturesBase, provider, filename), "utf8");
}

// ---------------------------------------------------------------------------
// Golden fixture: usage-probe-clean.txt
// Expected: session=73%, weekly=64%, opus=82%
// ---------------------------------------------------------------------------

describe("parseClaudeUsage: clean fixture (usage-probe-clean.txt)", () => {
  const raw = readFixture("claude", "usage-probe-clean.txt");
  // Parse once at describe scope -- parseClaudeUsage is synchronous and pure.
  const snapshot: ClaudeUsageSnapshot = parseClaudeUsage(raw);

  it("parses all fields correctly", () => {
    expect(() => parseClaudeUsage(raw)).not.toThrow();
    // session: 100 - 27% used = 73
    expect(snapshot.sessionPercentLeft).toBe(73);
    // weekly: 64% left (no subtraction)
    expect(snapshot.weeklyPercentLeft).toBe(64);
    // opus: 100 - 18% used = 82
    expect(snapshot.opusPercentLeft).toBe(82);
    // Fixture line: "Resets in 3h 02m"
    expect(snapshot.primaryReset).toBe("in 3h 02m");
    // Fixture line: "Resets on Mar 17, 8:00AM"
    expect(snapshot.secondaryReset).toBe("on Mar 17, 8:00AM");
    // Fixture line: "Resets on Mar 17, 8:00AM" (same date as weekly)
    expect(snapshot.opusReset).toBe("on Mar 17, 8:00AM");
    expect(snapshot.accountEmail).toBe("dave@example.com");
    expect(snapshot.accountOrganization).toBe("Zero Delta LLC");
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Golden fixture: usage-probe-live-style.txt
// Expected: session=30%, weekly=52%
// (no Opus section, no account info in this fixture)
// ---------------------------------------------------------------------------

describe("parseClaudeUsage: live-style fixture (usage-probe-live-style.txt)", () => {
  const raw = readFixture("claude", "usage-probe-live-style.txt");
  const snapshot: ClaudeUsageSnapshot = parseClaudeUsage(raw);

  it("parses all fields correctly", () => {
    expect(() => parseClaudeUsage(raw)).not.toThrow();
    // session: 100 - 70% used = 30
    expect(snapshot.sessionPercentLeft).toBe(30);
    // weekly: 100 - 48% used = 52
    expect(snapshot.weeklyPercentLeft).toBe(52);
    expect(snapshot.opusPercentLeft).toBeNull();
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Error detection: rate-limit and subscription gate
// ---------------------------------------------------------------------------

describe("parseClaudeUsage: error detection", () => {
  it("throws on rate-limit fixture and inline string", () => {
    const raw = readFixture("claude", "usage-error-rate-limit.txt");
    expect(() => parseClaudeUsage(raw)).toThrow(/Claude usage error detected/i);
    expect(() => parseClaudeUsage("Failed to load usage data: rate limited")).toThrow(
      /Claude usage error detected/i,
    );
  });

  it("throws on subscription-gate fixture and correct spelling", () => {
    const raw = readFixture("claude", "usage-error-subscription.txt");
    // Fixture contains the "vilable" typo from real Claude output
    expect(() => parseClaudeUsage(raw)).toThrow(/Claude usage error detected/i);
    expect(() => parseClaudeUsage("/usage is only available for subscription plans")).toThrow(
      /Claude usage error detected/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("parseClaudeUsage: edge cases", () => {
  it("throws on empty and whitespace-only input", () => {
    expect(() => parseClaudeUsage("")).toThrow(/empty/i);
    expect(() => parseClaudeUsage("   \n\n   ")).toThrow(/empty/i);
  });

  it("returns null fields and preserves rawText for minimal input", () => {
    const text = "Settings: Account Usage\nSome other line";
    const snapshot = parseClaudeUsage(text);
    expect(snapshot.sessionPercentLeft).toBeNull();
    expect(snapshot.weeklyPercentLeft).toBeNull();
    expect(snapshot.opusPercentLeft).toBeNull();
    expect(snapshot.rawText).toBe(text);
  });

  it("handles % left, % used, boundary values correctly", () => {
    // 64% left — no subtraction
    expect(parseClaudeUsage("Current session\n64% left\nResets in 1h 00m").sessionPercentLeft).toBe(
      64,
    );
    // 30% used → 100 - 30 = 70
    expect(parseClaudeUsage("Current session\n30% used\nResets in 1h 00m").sessionPercentLeft).toBe(
      70,
    );
    // 0% used → full quota remaining
    expect(parseClaudeUsage("Current session\n0% used").sessionPercentLeft).toBe(100);
    // 100% used → no quota remaining
    expect(parseClaudeUsage("Current session\n100% used").sessionPercentLeft).toBe(0);
  });
});
