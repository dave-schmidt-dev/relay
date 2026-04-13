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

  it("does not throw", () => {
    expect(() => parseCodexStatus(raw)).not.toThrow();
  });

  it("credits is 12.5", () => {
    expect(snapshot.credits).toBe(12.5);
  });

  it("fiveHourPercentLeft is 68", () => {
    expect(snapshot.fiveHourPercentLeft).toBe(68);
  });

  it("weeklyPercentLeft is 91", () => {
    expect(snapshot.weeklyPercentLeft).toBe(91);
  });

  it("fiveHourReset is extracted", () => {
    // Fixture line: "5h limit: 68% left  Resets in 2h 14m"
    expect(snapshot.fiveHourReset).toBe("in 2h 14m");
  });

  it("weeklyReset is extracted", () => {
    // Fixture line: "Weekly limit: 91% left  Resets on Mar 18, 9:00AM"
    expect(snapshot.weeklyReset).toBe("on Mar 18, 9:00AM");
  });

  it("rawText is the original input", () => {
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

  it("does not throw", () => {
    expect(() => parseCodexStatus(raw)).not.toThrow();
  });

  it("credits is null (not present in fixture)", () => {
    expect(snapshot.credits).toBeNull();
  });

  it("fiveHourPercentLeft is 96", () => {
    expect(snapshot.fiveHourPercentLeft).toBe(96);
  });

  it("weeklyPercentLeft is 92", () => {
    expect(snapshot.weeklyPercentLeft).toBe(92);
  });

  it("fiveHourReset is extracted from parenthesized form", () => {
    // Fixture line: "(resets 00:15 on 14 Mar)"
    expect(snapshot.fiveHourReset).toBe("00:15 on 14 Mar");
  });

  it("weeklyReset is extracted from parenthesized form", () => {
    // Fixture line: "(resets 03:09 on 17 Mar)"
    expect(snapshot.weeklyReset).toBe("03:09 on 17 Mar");
  });

  it("rawText is the original input", () => {
    expect(snapshot.rawText).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Error detection: data unavailable
// ---------------------------------------------------------------------------

describe("parseCodexStatus: unavailable error (status-error-unavailable.txt)", () => {
  it("throws on 'data not available yet' fixture", () => {
    const raw = readFixture("codex", "status-error-unavailable.txt");
    expect(() => parseCodexStatus(raw)).toThrow(/Codex status unavailable/i);
  });

  it("throws on inline 'data not available yet' string", () => {
    expect(() => parseCodexStatus("Data not available yet. Please try again later.")).toThrow(
      /Codex status unavailable/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("parseCodexStatus: edge cases", () => {
  it("throws on empty input", () => {
    expect(() => parseCodexStatus("")).toThrow(/empty/i);
  });

  it("throws on whitespace-only input", () => {
    expect(() => parseCodexStatus("   \n\n   ")).toThrow(/empty/i);
  });

  it("returns null fields for a minimal valid line with no usage data", () => {
    const snapshot = parseCodexStatus("Codex CLI status");
    expect(snapshot.credits).toBeNull();
    expect(snapshot.fiveHourPercentLeft).toBeNull();
    expect(snapshot.weeklyPercentLeft).toBeNull();
    expect(snapshot.fiveHourReset).toBeNull();
    expect(snapshot.weeklyReset).toBeNull();
  });

  it("parses credits as a float", () => {
    const snapshot = parseCodexStatus("Credits: 0.75\n5h limit: 50% left");
    expect(snapshot.credits).toBe(0.75);
  });

  it("parses credits when value is a whole number", () => {
    const snapshot = parseCodexStatus("Credits: 5\n5h limit: 50% left");
    expect(snapshot.credits).toBe(5);
  });

  it("attributes reset on a continuation line to the right section (5h)", () => {
    const text =
      "5h limit: 80% left\n(resets 01:00 on 15 Apr)\nWeekly limit: 60% left\n(resets 05:00 on 18 Apr)";
    const snapshot = parseCodexStatus(text);
    expect(snapshot.fiveHourReset).toBe("01:00 on 15 Apr");
    expect(snapshot.weeklyReset).toBe("05:00 on 18 Apr");
  });

  it("throws when 'update available' and 'codex' both appear", () => {
    expect(() => parseCodexStatus("Update available for codex CLI")).toThrow(
      /Codex CLI update required/i,
    );
  });

  it("does not throw when 'update available' appears without 'codex'", () => {
    // Should not trigger the update-required error — unrelated output.
    expect(() =>
      parseCodexStatus("Update available for some other tool\n5h limit: 50% left"),
    ).not.toThrow();
  });

  it("preserves rawText even when fields are missing", () => {
    const text = "Some unrecognized codex output line";
    const snapshot = parseCodexStatus(text);
    expect(snapshot.rawText).toBe(text);
  });
});
