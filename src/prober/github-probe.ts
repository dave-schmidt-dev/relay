/**
 * Github (Copilot) CLI usage output parser.
 *
 * Extracts premium request counts and percentages from the interactive
 * PTY output of the GitHub Copilot CLI.
 */

import { compactWhitespace } from "./ansi.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GithubUsageSnapshot {
  premiumRequests: number | null;
  sampleDurationSeconds: number | null;
  premiumPercentLeft: number | null;
  premiumReset: string | null;
  rawText: string;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse Copilot status-line usage text from interactive PTY capture.
 */
export function parseGithubUsage(text: string): GithubUsageSnapshot {
  const clean = compactWhitespace(text);
  if (!clean) {
    throw new Error("empty Github output");
  }

  // Look for "Requests 123 Premium (5m)" or similar
  const requestMatches = Array.from(
    clean.matchAll(/Requests\s+(\d+)\s+Premium(?:\s+\(([^)]+)\))?/gi),
  );

  // Look for "Remaining reqs.: 85%" or similar
  const remainingMatches = Array.from(
    clean.matchAll(/Remaining\s+reqs?\.\s*:?\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*%/gi),
  );

  if (requestMatches.length === 0 && remainingMatches.length === 0) {
    // If we don't find the specific patterns but have text, return nulls rather than throw
    // to allow the permissive router to still function.
    return {
      premiumRequests: null,
      sampleDurationSeconds: null,
      premiumPercentLeft: null,
      premiumReset: null,
      rawText: text,
    };
  }

  let premiumRequests: number | null = null;
  let durationSeconds: number | null = null;
  if (requestMatches.length > 0) {
    const lastMatch = requestMatches[requestMatches.length - 1];
    if (lastMatch?.[1]) {
      premiumRequests = parseInt(lastMatch[1], 10);
      if (lastMatch[2]) {
        durationSeconds = parseDurationSeconds(lastMatch[2]);
      }
    }
  }

  let premiumPercentLeft: number | null = null;
  if (remainingMatches.length > 0) {
    const lastMatch = remainingMatches[remainingMatches.length - 1];
    if (lastMatch?.[1]) {
      premiumPercentLeft = Math.round(parseFloat(lastMatch[1]));
    }
  }

  return {
    premiumRequests,
    sampleDurationSeconds: durationSeconds,
    premiumPercentLeft,
    premiumReset: null, // Reset logic handled by orchestrator/provider logic
    rawText: text,
  };
}

function parseDurationSeconds(value: string): number | null {
  const match = /\s*(\d+)\s*([smh])\s*/i.exec(value);
  if (!match?.[1] || !match[2]) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 3600;
  return null;
}
