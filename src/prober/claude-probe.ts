/**
 * Claude /usage output parser.
 *
 * Ports parse_claude_status from the ai_monitor Python project to TypeScript.
 * Extracts session/weekly/Opus quota percentages and reset times from the
 * text that Claude's TUI emits when the user navigates to the Usage screen.
 *
 * Entry point: parseClaudeUsage(usageText)
 * Pre-condition: caller must ANSI-strip the raw PTY output first; block chars
 * (progress-bar fills) are stripped internally.
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
// Error patterns — throw on any of these
// ---------------------------------------------------------------------------

const ERROR_PATTERNS: readonly RegExp[] = [
  /rate[\s-]?limit/i,
  // NOTE: "vilable" is the typo present in the actual Claude /usage output.
  /\/usage is only (?:available|vilable) for subscription plans/i,
  /failed to load usage data/i,
];

// ---------------------------------------------------------------------------
// Section header matchers
// ---------------------------------------------------------------------------

// Matches "Current session" with optional whitespace between words.
// The live-style PTY output can smash words together: "Currentsession".
const SESSION_HEADER_RE = /current\s*session/i;

// Matches "Current week" with optional whitespace between words.
// Live-style output: "Currentweek(allmodels)".
const WEEKLY_HEADER_RE = /current\s*week/i;

// Matches "(Opus)" with optional whitespace — distinguishes Opus from all-models week.
const OPUS_QUALIFIER_RE = /\(\s*opus\s*\)/i;

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a percent-left value from a line.
 *
 * Handles two formats from Claude's /usage output:
 *   "27% used"  => 100 - 27 = 73 left
 *   "64% left"  => 64 left
 *
 * The percent number and keyword may be adjacent ("70%used") or space-separated
 * ("27% used"). Returns null if neither pattern matches.
 */
function percentFromLine(line: string): number | null {
  const m = /(?<digits>\d+)%\s*(?<kw>used|left)/i.exec(line);
  if (m === null) return null;

  const digits = m.groups?.digits ?? "";
  const kw = (m.groups?.kw ?? "").toLowerCase();

  const raw = parseInt(digits, 10);

  if (kw === "used") {
    return 100 - raw;
  }
  // kw === "left"
  return raw;
}

/**
 * Extract a reset time string from a line.
 *
 * Handles two formats:
 *   "Resets in 3h 02m"
 *   "Resets on Mar 17, 8:00AM"
 *   "Resets 10pm (America/New_York)"
 *   "Resets Mar17at4pm"
 *
 * Returns the text after "Resets" (trimmed), or null if "Resets" is absent.
 */
function extractResetFromLine(line: string): string | null {
  const m = /resets\s+(?<rest>.+)/i.exec(line);
  if (m === null) return null;
  return (m.groups?.rest ?? "").trim();
}

// ---------------------------------------------------------------------------
// Account / identity extraction helpers
// ---------------------------------------------------------------------------

/** Extract email address from an "Account: <email>" line. */
function extractEmail(line: string): string | null {
  const m = /account:\s*(?<val>.+)/i.exec(line);
  if (m === null) return null;
  return (m.groups?.val ?? "").trim();
}

/** Extract organization name from an "Organization: <name>" line. */
function extractOrganization(line: string): string | null {
  const m = /organization:\s*(?<val>.+)/i.exec(line);
  if (m === null) return null;
  return (m.groups?.val ?? "").trim();
}

/** Extract login method from a "Logged in with <method>" or "Login: <method>" line. */
function extractLoginMethod(line: string): string | null {
  const m1 = /logged in with\s+(?<val>.+)/i.exec(line);
  if (m1 !== null) return (m1.groups?.val ?? "").trim();

  const m2 = /login(?:\s+method)?:\s*(?<val>.+)/i.exec(line);
  if (m2 !== null) return (m2.groups?.val ?? "").trim();

  return null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Section state during line-by-line parsing.
 *
 * "none"    -- not inside any quota section
 * "session" -- inside a "Current session" block
 * "weekly"  -- inside a "Current week (all models)" block
 * "opus"    -- inside a "Current week (Opus)" block
 */
type Section = "none" | "session" | "weekly" | "opus";

/**
 * Parse Claude /usage output (already ANSI-stripped) into a snapshot.
 *
 * @param usageText  -- ANSI-stripped text from Claude's usage screen.
 * @param _statusText -- Optional separate status text (unused; kept for API
 *                      parity with the Python source's dual-text approach).
 * @throws {Error} if the text contains a known error pattern (rate limit,
 *                 subscription gate, or failed load).
 */
export function parseClaudeUsage(usageText: string, _statusText?: string): ClaudeUsageSnapshot {
  // Check for known error conditions before any stripping.
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(usageText)) {
      throw new Error(`Claude usage error detected: ${usageText.trim()}`);
    }
  }

  if (usageText.trim() === "") {
    throw new Error("Claude usage text is empty");
  }

  // Strip block chars (progress-bar fills) then re-normalize whitespace.
  // The caller handles ANSI stripping; block chars are handled here because
  // they appear inline with parseable text in the live-style output.
  const cleaned = compactWhitespace(stripBlockChars(usageText));

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
    rawText: usageText,
  };

  let section: Section = "none";

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // -------------------------------------------------------------------------
    // Section detection -- must precede value extraction so the header line
    // itself does not accidentally match a percent pattern.
    // -------------------------------------------------------------------------

    if (SESSION_HEADER_RE.test(trimmed) && !WEEKLY_HEADER_RE.test(trimmed)) {
      // "Current session" line -- may also contain an inline reset time
      // e.g. "Current session * Resets 10pm (America/New_York)"
      section = "session";
      const reset = extractResetFromLine(trimmed);
      if (reset !== null && snapshot.primaryReset === null) {
        snapshot.primaryReset = reset;
      }
      continue;
    }

    if (WEEKLY_HEADER_RE.test(trimmed)) {
      if (OPUS_QUALIFIER_RE.test(trimmed)) {
        section = "opus";
        const reset = extractResetFromLine(trimmed);
        if (reset !== null && snapshot.opusReset === null) {
          snapshot.opusReset = reset;
        }
      } else {
        section = "weekly";
        const reset = extractResetFromLine(trimmed);
        if (reset !== null && snapshot.secondaryReset === null) {
          snapshot.secondaryReset = reset;
        }
      }
      continue;
    }

    // -------------------------------------------------------------------------
    // Value extraction within the current section
    // -------------------------------------------------------------------------

    const pct = percentFromLine(trimmed);
    if (pct !== null) {
      if (section === "session" && snapshot.sessionPercentLeft === null) {
        snapshot.sessionPercentLeft = pct;
      } else if (section === "weekly" && snapshot.weeklyPercentLeft === null) {
        snapshot.weeklyPercentLeft = pct;
      } else if (section === "opus" && snapshot.opusPercentLeft === null) {
        snapshot.opusPercentLeft = pct;
      }
      continue;
    }

    const reset = extractResetFromLine(trimmed);
    if (reset !== null) {
      if (section === "session" && snapshot.primaryReset === null) {
        snapshot.primaryReset = reset;
      } else if (section === "weekly" && snapshot.secondaryReset === null) {
        snapshot.secondaryReset = reset;
      } else if (section === "opus" && snapshot.opusReset === null) {
        snapshot.opusReset = reset;
      }
      continue;
    }

    // -------------------------------------------------------------------------
    // Account / identity lines (section-agnostic)
    // -------------------------------------------------------------------------

    const email = extractEmail(trimmed);
    if (email !== null) {
      snapshot.accountEmail = email;
      continue;
    }

    const org = extractOrganization(trimmed);
    if (org !== null) {
      snapshot.accountOrganization = org;
      continue;
    }

    const login = extractLoginMethod(trimmed);
    if (login !== null) {
      snapshot.loginMethod = login;
    }
  }

  return snapshot;
}
