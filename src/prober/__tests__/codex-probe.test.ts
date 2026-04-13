/**
 * Tests for the Codex /status output parser.
 *
 * Covers golden fixtures for clean and live-style output, error detection,
 * and edge cases (TASK-014c, REQ-014).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCodexStatus, type CodexUsageSnapshot } from "../codex-probe.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Test file lives at src/prober/__tests__/ -- 4 levels up is project root.
const fixturesBase = path.resolve(import.meta.dirname, "../../../fixtures");

function readFixture(provider: string, filename: string): string {
  return fs.readFileSync(path.join(fixturesBase, provider, filename), "utf8");
}

// ---------------------------------------------------------------------------
// Golden fixture: status-probe-clean.txt
// Expected: credits=12.50, 5h=68%, weekly=91%, resets extracted
// ---------------------------------------------------------------------------

describe("parseCodexStatus: clean fixture (status-probe-clean.txt)", () => {
  const raw = readFixture("codex", "status-probe-clean.txt");
  const snapshot: CodexUsageSnapshot = parseCodexStatus(raw);

  it("parses all fields correctly", () => {
    expect(() => parseCodexStatus(raw)).not.toThrow();
    expect(snapshot.credits).toBe(12.5);
    expect(snapshot.fiveHourPercentLeft).toBe(68);
    expect(snapshot.weeklyPercentLeft).toBe(91);
    // Fixture line: "5h limit: 68% left  Resets in 2h 14m"
    expect(snapshot.fiveHourReset).toBe("in 2h 14m");
    // Fixture line: "Weekly limit: 91% left  Resets on Mar 18, 9:00AM"
    expect(snapshot.weeklyReset).toBe("on Mar 18, 9:00AM");
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Golden fixture: status-probe-live-style.txt
// Expected: 5h=96%, weekly=92%, resets extracted (no credits in this fixture)
// ---------------------------------------------------------------------------

describe("parseCodexStatus: live-style fixture (status-probe-live-style.txt)", () => {
  const raw = readFixture("codex", "status-probe-live-style.txt");
  const snapshot: CodexUsageSnapshot = parseCodexStatus(raw);

  it("parses all fields correctly", () => {
    expect(() => parseCodexStatus(raw)).not.toThrow();
    expect(snapshot.credits).toBeNull();
    expect(snapshot.fiveHourPercentLeft).toBe(96);
    expect(snapshot.weeklyPercentLeft).toBe(92);
    // Fixture line: "(resets 00:15 on 14 Mar)"
    expect(snapshot.fiveHourReset).toBe("00:15 on 14 Mar");
    // Fixture line: "(resets 03:09 on 17 Mar)"
    expect(snapshot.weeklyReset).toBe("03:09 on 17 Mar");
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Error detection: data unavailable
// ---------------------------------------------------------------------------

describe("parseCodexStatus: unavailable error (status-error-unavailable.txt)", () => {
  it("throws on fixture and inline string", () => {
    const raw = readFixture("codex", "status-error-unavailable.txt");
    expect(() => parseCodexStatus(raw)).toThrow(/Codex status unavailable/i);
    expect(() => parseCodexStatus("Data not available yet. Please try again later.")).toThrow(
      /Codex status unavailable/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("parseCodexStatus: edge cases", () => {
  it("throws on empty and whitespace-only input", () => {
    expect(() => parseCodexStatus("")).toThrow(/empty/i);
    expect(() => parseCodexStatus("   \n\n   ")).toThrow(/empty/i);
  });

  it("returns null fields and preserves rawText for minimal input", () => {
    const snapshot = parseCodexStatus("Codex CLI status");
    expect(snapshot.credits).toBeNull();
    expect(snapshot.fiveHourPercentLeft).toBeNull();
    expect(snapshot.weeklyPercentLeft).toBeNull();
    expect(snapshot.fiveHourReset).toBeNull();
    expect(snapshot.weeklyReset).toBeNull();
    const text = "Some unrecognized codex output line";
    expect(parseCodexStatus(text).rawText).toBe(text);
  });

  it("parses credits, attributes resets correctly, and handles update-available detection", () => {
    // Credits as float and whole number
    expect(parseCodexStatus("Credits: 0.75\n5h limit: 50% left").credits).toBe(0.75);
    expect(parseCodexStatus("Credits: 5\n5h limit: 50% left").credits).toBe(5);
    // Reset attribution to the correct section via parenthesized form
    const text =
      "5h limit: 80% left\n(resets 01:00 on 15 Apr)\nWeekly limit: 60% left\n(resets 05:00 on 18 Apr)";
    const snap = parseCodexStatus(text);
    expect(snap.fiveHourReset).toBe("01:00 on 15 Apr");
    expect(snap.weeklyReset).toBe("05:00 on 18 Apr");
    // Update-available throws only when 'codex' also appears
    expect(() => parseCodexStatus("Update available for codex CLI")).toThrow(
      /Codex CLI update required/i,
    );
    // Does not throw when 'update available' appears without 'codex'
    expect(() =>
      parseCodexStatus("Update available for some other tool\n5h limit: 50% left"),
    ).not.toThrow();
  });
});
