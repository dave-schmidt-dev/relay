/**
 * Claude /usage output parser.
 *
 * Extracts session/weekly/Opus quota percentages and reset times from the
 * text that Claude's TUI emits.
 */

import { stripBlockChars, compactWhitespace } from "./ansi.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClaudeUsageSnapshot {
  sessionPercentLeft: number | null;
  weeklyPercentLeft: number | null;
  opusPercentLeft: number | null;
  primaryReset: string | null;
  secondaryReset: string | null;
  opusReset: string | null;
  accountEmail: string | null;
  accountOrganization: string | null;
  loginMethod: string | null;
  rawText: string;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseClaudeUsage(usageText: string, statusText?: string): ClaudeUsageSnapshot {
  const cleanUsage = compactWhitespace(stripBlockChars(usageText));
  const cleanStatus = statusText ? compactWhitespace(stripBlockChars(statusText)) : "";
  const combined = cleanUsage + "\n" + cleanStatus;

  if (!cleanUsage) {
    throw new Error("empty Claude output");
  }

  // Check for common error patterns
  const lowerCombined = combined.toLowerCase();
  if (lowerCombined.includes("rate limit") || lowerCombined.includes("ratelimited")) {
    throw new Error("Claude usage endpoint is rate limited");
  }
  if (
    lowerCombined.includes("subscription plans") ||
    lowerCombined.includes("only available for subscription")
  ) {
    throw new Error("Claude usage only available for subscription plans");
  }

  const snapshot: ClaudeUsageSnapshot = {
    sessionPercentLeft: null,
    weeklyPercentLeft: null,
    opusPercentLeft: null,
    primaryReset: null,
    secondaryReset: null,
    opusReset: null,
    accountEmail: null,
    accountOrganization: null,
    loginMethod: null,
    rawText: usageText + (statusText ? "\n" + statusText : ""),
  };

  const lines = combined.split("\n");

  // Robust multi-pass parsing
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Normalize for matching: lowercase and strip spaces
    const normal = line.toLowerCase().replace(/\s+/g, "");

    // Email/Identity
    if (normal.includes("account:") || normal.includes("email:")) {
      const match = /([^\s@]+@[^\s@]+)/i.exec(line);
      if (match?.[1]) snapshot.accountEmail = match[1];
    }

    if (normal.includes("org:") || normal.includes("organization:")) {
      const parts = line.split(/org:|organization:/i);
      if (parts[1]) snapshot.accountOrganization = parts[1].trim();
    }

    // Quota sections - look for labels and then scan nearby lines for percentages
    // Normalization helps with "Currentweek(allmodels)" noise
    if (normal.includes("currentsession")) {
      snapshot.sessionPercentLeft = extractPercent(lines, i);
      snapshot.primaryReset = extractReset(lines, i);
    } else if (
      normal.includes("currentweek") &&
      (normal.includes("allmodels") || !normal.includes("("))
    ) {
      snapshot.weeklyPercentLeft = extractPercent(lines, i);
      snapshot.secondaryReset = extractReset(lines, i);
    } else if (
      normal.includes("currentweek") &&
      (normal.includes("opus") || normal.includes("sonnet"))
    ) {
      snapshot.opusPercentLeft = extractPercent(lines, i);
      snapshot.opusReset = extractReset(lines, i);
    }
  }

  // Fallback: if we found percentages but couldn't attribute them via labels,
  // take the first one as session if session is still null.
  if (snapshot.sessionPercentLeft === null) {
    for (let i = 0; i < lines.length; i++) {
      const pct = extractPercent(lines, i, 1); // look only at current line
      if (pct !== null) {
        snapshot.sessionPercentLeft = pct;
        break;
      }
    }
  }

  return snapshot;
}

function extractPercent(lines: string[], startIdx: number, window = 6): number | null {
  for (let i = startIdx; i < Math.min(startIdx + window, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;

    // Normalize: strip block chars and most spaces between % and label
    const normal = line.replace(/[█▓▒░]+/g, "").replace(/\s+/g, " ");

    // Look for "XX%" followed by "used" or "left/remaining"
    const match = /(\d+(?:\.\d+)?)\s*%\s*(used|left|remaining|available)/i.exec(normal);
    if (match?.[1] && match[2]) {
      const val = Math.round(parseFloat(match[1]));
      const type = match[2].toLowerCase();
      return type === "used" ? Math.max(0, 100 - val) : val;
    }

    // Also support "XX%used" (no space)
    const tightMatch = /(\d+(?:\.\d+)?)\s*%(used|left|remaining|available)/i.exec(normal);
    if (tightMatch?.[1] && tightMatch[2]) {
      const val = Math.round(parseFloat(tightMatch[1]));
      const type = tightMatch[2].toLowerCase();
      return type === "used" ? Math.max(0, 100 - val) : val;
    }
  }
  return null;
}

function extractReset(lines: string[], startIdx: number, window = 6): string | null {
  for (let i = startIdx; i < Math.min(startIdx + window, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;

    // Look for "Resets" label
    const match = /resets?\s+(.+)/i.exec(line);
    if (match?.[1]) {
      // Clean up trailing noise
      return match[1].replace(/[│╭╮╰╯─▄ )]+$/, "").trim();
    }

    // Look for "(resets ...)"
    const parenMatch = /\(resets?\s+([^)]+)\)/i.exec(line);
    if (parenMatch?.[1]) {
      return parenMatch[1].trim();
    }
  }
  return null;
}
