/**
 * Codex /status output parser.
 *
 * Extracts credit balance, 5-hour, and weekly quota percentages from
 * Codex CLI output.
 */

import { compactWhitespace, stripBlockChars } from "./ansi.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CodexUsageSnapshot {
  credits: number | null;
  fiveHourPercentLeft: number | null;
  weeklyPercentLeft: number | null;
  fiveHourReset: string | null;
  weeklyReset: string | null;
  rawText: string;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseCodexStatus(text: string): CodexUsageSnapshot {
  const clean = compactWhitespace(stripBlockChars(text));
  if (!clean) {
    throw new Error("empty Codex output");
  }

  // Check for unavailable error
  if (clean.toLowerCase().includes("data not available yet")) {
    throw new Error("Codex status unavailable");
  }

  const lines = clean.split("\n");
  const snapshot: CodexUsageSnapshot = {
    credits: null,
    fiveHourPercentLeft: null,
    weeklyPercentLeft: null,
    fiveHourReset: null,
    weeklyReset: null,
    rawText: text,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Credits
    const creditsMatch = /Credits:\s*([0-9][0-9.,]*)/i.exec(line);
    if (creditsMatch?.[1]) {
      snapshot.credits = parseFloat(creditsMatch[1].replace(/,/g, ""));
    }

    // 5h Limit
    if (line.toLowerCase().includes("5h limit")) {
      snapshot.fiveHourPercentLeft = extractPercent(lines, i);
      snapshot.fiveHourReset = extractReset(lines, i);
    }

    // Weekly Limit
    if (line.toLowerCase().includes("weekly limit")) {
      snapshot.weeklyPercentLeft = extractPercent(lines, i);
      snapshot.weeklyReset = extractReset(lines, i);
    }
  }

  // Check for update required
  if (clean.toLowerCase().includes("update available") && clean.toLowerCase().includes("codex")) {
    throw new Error("Codex CLI update required before probing usage");
  }

  return snapshot;
}

function extractPercent(lines: string[], startIdx: number): number | null {
  for (let i = startIdx; i < Math.min(startIdx + 3, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;
    const match = /(\d+)%\s*(used|left|remaining)/i.exec(line);
    if (match?.[1] && match[2]) {
      const val = parseInt(match[1], 10);
      const type = match[2].toLowerCase();
      return type === "used" ? 100 - val : val;
    }
  }
  return null;
}

function extractReset(lines: string[], startIdx: number): string | null {
  for (let i = startIdx; i < Math.min(startIdx + 3, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;
    const match = /resets?\s+(.+)/i.exec(line);
    if (match?.[1]) {
      // Clean up trailing box characters and parentheses
      return match[1]
        .replace(/[│╭╮╰╯─▄ ]+$/, "")
        .replace(/\)+$/, "")
        .trim();
    }
  }
  return null;
}
