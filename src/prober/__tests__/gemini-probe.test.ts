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

  it("parses all fields correctly", () => {
    expect(() => parseGeminiStats(raw)).not.toThrow();
    // Fixture: gemini-2.5-flash at 98.3% → rounds to 98
    expect(snapshot.flashPercentLeft).toBe(98);
    // Fixture: gemini-2.5-pro at 83.3% → rounds to 83
    expect(snapshot.proPercentLeft).toBe(83);
    expect(snapshot.flashReset).toBe("resets in 15h 36m");
    // Fixture: "resets in 22h 23m"
    expect(snapshot.proReset).toBe("resets in 22h 23m");
    // Fixture: "Logged in with Google (user@example.com)"
    expect(snapshot.accountEmail).toBe("user@example.com");
    // Fixture: "Tier:  Gemini Code Assist in Google One AI Pro"
    expect(snapshot.accountTier).toBe("Gemini Code Assist in Google One AI Pro");
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Error fixture: stats-error-no-panel.txt
// ---------------------------------------------------------------------------

describe("parseGeminiStats: error fixture (stats-error-no-panel.txt)", () => {
  it("throws on fixture and inline string", () => {
    // raw fixture: "No session stats available."
    const raw = readFixture("gemini", "stats-error-no-panel.txt");
    expect(() => parseGeminiStats(raw)).toThrow();
    expect(() => parseGeminiStats("Completely different string")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("parseGeminiStats: edge cases", () => {
  it("throws on empty and whitespace-only input", () => {
    expect(() => parseGeminiStats("")).toThrow(/empty/i);
    expect(() => parseGeminiStats("   \n\n   ")).toThrow(/empty/i);
  });

  it("throws if no metrics found in panel", () => {
    const text = "Session Stats\nAuth Method: API Key";
    expect(() => parseGeminiStats(text)).toThrow(/stats panel not found/i);
  });

  it("first flash row wins and first pro row wins — subsequent rows ignored", () => {
    const flashText = [
      "Session Stats",
      "gemini-2.5-flash  90.0%  resets in 1h 0m",
      "gemini-2.5-flash-lite  50.0%  resets in 2h 0m",
    ].join("\n");
    const flashSnap = parseGeminiStats(flashText);
    expect(flashSnap.flashPercentLeft).toBe(90);
    expect(flashSnap.flashReset).toBe("resets in 1h 0m");

    const proText = [
      "Session Stats",
      "gemini-2.5-pro  70.0%  resets in 5h 0m",
      "gemini-3.1-pro-preview  40.0%  resets in 9h 0m",
    ].join("\n");
    const proSnap = parseGeminiStats(proText);
    expect(proSnap.proPercentLeft).toBe(70);
    expect(proSnap.proReset).toBe("resets in 5h 0m");
  });
});
