/**
 * Tests for the Gemini /stats output parser.
 *
 * Covers golden fixture parsing, error detection, and edge cases (TASK-014d).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseGeminiStats, type GeminiUsageSnapshot } from "../gemini-probe.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Test file lives at src/prober/__tests__/ — 4 levels up is project root.
const fixturesBase = path.resolve(import.meta.dirname, "../../../fixtures");

function readFixture(provider: string, filename: string): string {
  return fs.readFileSync(path.join(fixturesBase, provider, filename), "utf8");
}

// ---------------------------------------------------------------------------
// Golden fixture: stats-probe-clean.txt
// Expected: flash=98, pro=83, resets and account fields extracted
// ---------------------------------------------------------------------------

describe("parseGeminiStats: clean fixture (stats-probe-clean.txt)", () => {
  const raw = readFixture("gemini", "stats-probe-clean.txt");
  const snapshot: GeminiUsageSnapshot = parseGeminiStats(raw);

  it("does not throw", () => {
    expect(() => parseGeminiStats(raw)).not.toThrow();
  });

  it("flashPercentLeft is 98", () => {
    // Fixture: gemini-2.5-flash at 98.3% → rounds to 98
    expect(snapshot.flashPercentLeft).toBe(98);
  });

  it("proPercentLeft is 83", () => {
    // Fixture: gemini-2.5-pro at 83.3% → rounds to 83
    expect(snapshot.proPercentLeft).toBe(83);
  });

  it("flashReset is extracted", () => {
    // Fixture: "resets in 15h 36m"
    expect(snapshot.flashReset).toBe("in 15h 36m");
  });

  it("proReset is extracted", () => {
    // Fixture: "resets in 22h 23m"
    expect(snapshot.proReset).toBe("in 22h 23m");
  });

  it("accountEmail is extracted from auth line", () => {
    // Fixture: "Logged in with Google (david.m.schmidty@gmail.com)"
    expect(snapshot.accountEmail).toBe("david.m.schmidty@gmail.com");
  });

  it("accountTier is extracted", () => {
    // Fixture: "Tier:  Gemini Code Assist in Google One AI Pro"
    expect(snapshot.accountTier).toBe("Gemini Code Assist in Google One AI Pro");
  });

  it("rawText is the original input", () => {
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Error fixture: stats-error-no-panel.txt
// Expected: throws with Gemini stats error message
// ---------------------------------------------------------------------------

describe("parseGeminiStats: error fixture (stats-error-no-panel.txt)", () => {
  it("throws on 'No session stats available' fixture", () => {
    const raw = readFixture("gemini", "stats-error-no-panel.txt");
    expect(() => parseGeminiStats(raw)).toThrow(/Gemini stats error/i);
  });

  it("throws on inline 'no session stats available' string", () => {
    expect(() => parseGeminiStats("No session stats available.")).toThrow(/Gemini stats error/i);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("parseGeminiStats: edge cases", () => {
  it("throws on empty input", () => {
    expect(() => parseGeminiStats("")).toThrow(/empty/i);
  });

  it("throws on whitespace-only input", () => {
    expect(() => parseGeminiStats("   \n\n   ")).toThrow(/empty/i);
  });

  it("returns null fields when no model rows are present", () => {
    const snapshot = parseGeminiStats("Session Stats\nAuth Method: API Key");
    expect(snapshot.flashPercentLeft).toBeNull();
    expect(snapshot.proPercentLeft).toBeNull();
    expect(snapshot.flashReset).toBeNull();
    expect(snapshot.proReset).toBeNull();
  });

  it("first flash row wins — subsequent flash rows are ignored", () => {
    const text = [
      "gemini-2.5-flash  90.0%  resets in 1h 0m",
      "gemini-2.5-flash-lite  50.0%  resets in 2h 0m",
    ].join("\n");
    const snapshot = parseGeminiStats(text);
    expect(snapshot.flashPercentLeft).toBe(90);
    expect(snapshot.flashReset).toBe("in 1h 0m");
  });

  it("first pro row wins — subsequent pro rows are ignored", () => {
    const text = [
      "gemini-2.5-pro  70.0%  resets in 5h 0m",
      "gemini-3.1-pro-preview  40.0%  resets in 9h 0m",
    ].join("\n");
    const snapshot = parseGeminiStats(text);
    expect(snapshot.proPercentLeft).toBe(70);
    expect(snapshot.proReset).toBe("in 5h 0m");
  });

  it("preserves rawText even when no fields are parsed", () => {
    const text = "Some unrecognized gemini output";
    const snapshot = parseGeminiStats(text);
    expect(snapshot.rawText).toBe(text);
  });
});
