/**
 * Codex /status output parser.
 *
 * Ports parse_codex_status from the ai_monitor Python project to TypeScript.
 * Extracts credits, 5h limit, weekly limit, and reset times from the text
 * that `codex status` emits.
 *
 * Entry point: parseCodexStatus(text)
 * Pre-condition: caller should ANSI-strip the raw PTY output first; block
 * chars (progress-bar fills) are stripped internally.
 */

import { stripBlockChars, compactWhitespace } from "./ansi.js";

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
// Error patterns — throw on any of these
// ---------------------------------------------------------------------------

// "data not available yet" — Codex hasn't synced usage data yet.
const DATA_UNAVAILABLE_RE = /data not available yet/i;

// "update available" + "codex" on the same line or nearby — CLI is stale.
const UPDATE_REQUIRED_RE = /update available/i;
const UPDATE_CODEX_RE = /codex/i;

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a credits value from a "Credits: X.XX" line.
 *
 * Returns null if the pattern is absent.
 */
function extractCredits(line: string): number | null {
  const m = /credits:\s*(?<val>\d+(?:\.\d+)?)/i.exec(line);
  if (m === null) return null;
  const val = m.groups?.val ?? "";
  return parseFloat(val);
}

/**
 * Extract a percent-left value from a "X% left" phrase.
 *
 * Codex /status always uses "X% left" (not "X% used"), so this is a simple
 * extraction. Returns null if the pattern is absent.
 */
function extractPercentLeft(line: string): number | null {
  const m = /(?<digits>\d+)%\s*left/i.exec(line);
  if (m === null) return null;
  const digits = m.groups?.digits ?? "";
  return parseInt(digits, 10);
}

/**
 * Extract a reset time from a line.
 *
 * Handles two formats observed in Codex output:
 *   "Resets in 2h 14m"                 => "in 2h 14m"
 *   "(resets 00:15 on 14 Mar)"         => "00:15 on 14 Mar"
 *   "Resets on Mar 18, 9:00AM"         => "on Mar 18, 9:00AM"
 *
 * Returns null if no reset marker is found.
 */
function extractReset(line: string): string | null {
  // Parenthesized form: "(resets <rest>)" — strip parens
  const parenM = /\(\s*resets\s+(?<rest>[^)]+)\)/i.exec(line);
  if (parenM !== null) {
    return (parenM.groups?.rest ?? "").trim();
  }

  // Plain form: "Resets <rest>"
  const plainM = /resets\s+(?<rest>.+)/i.exec(line);
  if (plainM !== null) {
    return (plainM.groups?.rest ?? "").trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse Codex /status output (already ANSI-stripped) into a snapshot.
 *
 * The parser is intentionally line-by-line so it handles both the "clean"
 * single-line format and the "live-style" box-drawing format without needing
 * to know which format is in use.
 *
 * @param text  ANSI-stripped text from "codex status".
 * @throws {Error} if the text signals data unavailability or a required CLI
 *                 update.
 */
export function parseCodexStatus(text: string): CodexUsageSnapshot {
  // Check for "data not available yet" before stripping.
  if (DATA_UNAVAILABLE_RE.test(text)) {
    throw new Error(`Codex status unavailable: ${text.trim()}`);
  }

  // Check for CLI update required: "update available" must also mention "codex"
  // to avoid false positives from unrelated output.
  if (UPDATE_REQUIRED_RE.test(text) && UPDATE_CODEX_RE.test(text)) {
    throw new Error(`Codex CLI update required: ${text.trim()}`);
  }

  if (text.trim() === "") {
    throw new Error("Codex status text is empty");
  }

  // Strip block chars (progress-bar fills) then compact whitespace.
  const cleaned = compactWhitespace(stripBlockChars(text));

  const snapshot: CodexUsageSnapshot = {
    credits: null,
    fiveHourPercentLeft: null,
    weeklyPercentLeft: null,
    fiveHourReset: null,
    weeklyReset: null,
    rawText: text,
  };

  // Track which section the current line belongs to, so that a reset time on
  // a continuation line is attributed to the right limit.
  //
  // "none"    — not inside a limit section
  // "5h"      — inside the "5h limit" block
  // "weekly"  — inside the "Weekly limit" block
  type Section = "none" | "5h" | "weekly";
  let section: Section = "none";

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // -------------------------------------------------------------------------
    // Credits line — section-agnostic, typically at the top.
    // -------------------------------------------------------------------------
    if (snapshot.credits === null) {
      const credits = extractCredits(trimmed);
      if (credits !== null) {
        snapshot.credits = credits;
        continue;
      }
    }

    // -------------------------------------------------------------------------
    // 5h limit line — sets section and may carry inline percent + reset.
    // e.g. "5h limit: 68% left  Resets in 2h 14m"
    // -------------------------------------------------------------------------
    if (/5h\s*limit/i.test(trimmed)) {
      section = "5h";

      if (snapshot.fiveHourPercentLeft === null) {
        const pct = extractPercentLeft(trimmed);
        if (pct !== null) snapshot.fiveHourPercentLeft = pct;
      }

      if (snapshot.fiveHourReset === null) {
        const reset = extractReset(trimmed);
        if (reset !== null) snapshot.fiveHourReset = reset;
      }

      continue;
    }

    // -------------------------------------------------------------------------
    // Weekly limit line — sets section and may carry inline percent + reset.
    // e.g. "Weekly limit: 91% left  Resets on Mar 18, 9:00AM"
    // -------------------------------------------------------------------------
    if (/weekly\s*limit/i.test(trimmed)) {
      section = "weekly";

      if (snapshot.weeklyPercentLeft === null) {
        const pct = extractPercentLeft(trimmed);
        if (pct !== null) snapshot.weeklyPercentLeft = pct;
      }

      if (snapshot.weeklyReset === null) {
        const reset = extractReset(trimmed);
        if (reset !== null) snapshot.weeklyReset = reset;
      }

      continue;
    }

    // -------------------------------------------------------------------------
    // Continuation line: percent or reset not yet captured for current section.
    // -------------------------------------------------------------------------

    const pct = extractPercentLeft(trimmed);
    if (pct !== null) {
      if (section === "5h" && snapshot.fiveHourPercentLeft === null) {
        snapshot.fiveHourPercentLeft = pct;
      } else if (section === "weekly" && snapshot.weeklyPercentLeft === null) {
        snapshot.weeklyPercentLeft = pct;
      }
      // Don't continue — a reset might also appear on this line.
    }

    const reset = extractReset(trimmed);
    if (reset !== null) {
      if (section === "5h" && snapshot.fiveHourReset === null) {
        snapshot.fiveHourReset = reset;
      } else if (section === "weekly" && snapshot.weeklyReset === null) {
        snapshot.weeklyReset = reset;
      }
    }
  }

  return snapshot;
}
