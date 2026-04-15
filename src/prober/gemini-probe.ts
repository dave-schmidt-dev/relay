/**
 * Gemini /stats output parser.
 *
 * Extracts Flash and Pro quota percentages and reset times from
 * Gemini CLI output.
 */

import { compactWhitespace, stripBlockChars } from "./ansi.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeminiUsageSnapshot {
  flashPercentLeft: number | null;
  proPercentLeft: number | null;
  flashReset: string | null;
  proReset: string | null;
  accountEmail: string | null;
  accountTier: string | null;
  rawText: string;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseGeminiStats(text: string): GeminiUsageSnapshot {
  const clean = compactWhitespace(stripBlockChars(text));
  if (!clean) {
    throw new Error("empty Gemini output");
  }

  const lines = clean.split("\n");
  if (
    !clean.toLowerCase().includes("session stats") &&
    !clean.toLowerCase().includes("usage remaining")
  ) {
    throw new Error("Gemini stats panel not found");
  }
  const snapshot: GeminiUsageSnapshot = {
    flashPercentLeft: null,
    proPercentLeft: null,
    flashReset: null,
    proReset: null,
    accountEmail: null,
    accountTier: null,
    rawText: text,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Flash Model
    if (/gemini-.*flash/i.exec(trimmed)) {
      snapshot.flashPercentLeft ??= extractPercent(trimmed);
      snapshot.flashReset ??= extractReset(trimmed);
    }

    // Pro Model
    if (/gemini-.*pro/i.exec(trimmed)) {
      snapshot.proPercentLeft ??= extractPercent(trimmed);
      snapshot.proReset ??= extractReset(trimmed);
    }

    // Identity
    if (trimmed.toLowerCase().includes("auth method:")) {
      const match = /\(([^()]+@[^()]+)\)/.exec(trimmed);
      if (match?.[1]) snapshot.accountEmail = match[1];
    }
    if (trimmed.toLowerCase().includes("tier:")) {
      let tier = trimmed.split(":")[1]?.trim() ?? null;
      if (tier) {
        // Strip trailing box-drawing characters and extra space
        tier = tier.replace(/[│╭╮╰╯─▄ ]+$/, "").trim();
      }
      snapshot.accountTier = tier;
    }
  }

  return snapshot;
}

function extractPercent(line: string): number | null {
  const match = /(\d+(?:\.\d+)?)%/.exec(line);
  if (!match?.[1]) return null;

  const val = parseFloat(match[1]);
  const lower = line.toLowerCase();
  if (lower.includes("used") || lower.includes("spent")) {
    return Math.max(0, 100 - Math.round(val));
  }
  return Math.round(val);
}

function extractReset(line: string): string | null {
  const match = /(resets?\s+in\s+\d+h(?:\s+\d+m)?|resets?\s+in\s+\d+m)/i.exec(line);
  return match?.[1] ? match[1].trim() : null;
}
