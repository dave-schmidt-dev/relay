/**
 * Gemini /stats output parser.
 *
 * Ports parse_gemini_status from the ai_monitor Python project to TypeScript.
 * Extracts per-model usage percentages and reset times from the text that
 * `gemini /stats` emits (the Session Stats panel).
 *
 * Entry point: parseGeminiStats(text)
 * Pre-condition: caller should ANSI-strip the raw PTY output first; box-drawing
 * characters (╭╮╰╯│─▄) are normalized internally.
 */

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
// Error patterns — throw on any of these
// ---------------------------------------------------------------------------

const ERROR_PATTERNS: readonly RegExp[] = [/no session stats available/i];

// ---------------------------------------------------------------------------
// Model classification
// ---------------------------------------------------------------------------

// Flash model name patterns — match any known flash variant.
const FLASH_MODEL_MARKERS: readonly RegExp[] = [
  /gemini-3-flash-preview/i,
  /gemini-2\.5-flash/i, // matches gemini-2.5-flash and gemini-2.5-flash-lite
];

// Pro model name patterns — match any known pro variant.
const PRO_MODEL_MARKERS: readonly RegExp[] = [/gemini-3\.1-pro-preview/i, /gemini-2\.5-pro/i];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Replace box-drawing and panel-border characters with spaces so that the
 * parseable text can be extracted with simple regex patterns.
 *
 * Normalized: ╭ ╮ ╰ ╯ │ ─ ▄
 */
function normalizeBoxChars(text: string): string {
  return text.replace(/[╭╮╰╯│─▄]/g, " ");
}

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

/**
 * Classify a line as a flash model row, a pro model row, or neither.
 *
 * Returns "flash", "pro", or null.
 */
function classifyModelLine(line: string): "flash" | "pro" | null {
  for (const re of FLASH_MODEL_MARKERS) {
    if (re.test(line)) return "flash";
  }
  for (const re of PRO_MODEL_MARKERS) {
    if (re.test(line)) return "pro";
  }
  return null;
}

/**
 * Extract a percentage value from a model row.
 *
 * Gemini /stats uses "X.X%" where X.X is a decimal.  We round to the nearest
 * integer to match the Python source (int(pct_value)).
 *
 * Returns null if no percentage is found.
 */
function percentFromLine(line: string): number | null {
  const m = /(?<digits>\d+(?:\.\d+)?)%/.exec(line);
  if (m === null) return null;
  return Math.round(parseFloat(m.groups?.digits ?? "0"));
}

/**
 * Extract a "resets in Xh Ym" string from a model row.
 *
 * Returns a normalized "in Xh Ym" string, or null if absent.
 */
function extractReset(line: string): string | null {
  const m = /resets\s+in\s+(?<rest>\S.*?)(?:\s*$)/i.exec(line);
  if (m === null) return null;
  return `in ${(m.groups?.rest ?? "").trim()}`;
}

/**
 * Extract an email address from a parenthesized Auth Method line.
 *
 * Format: "Auth Method: Logged in with Google (user@example.com)"
 */
function extractEmail(line: string): string | null {
  const m = /\(\s*(?<email>[^\s@)]+@[^\s)]+)\s*\)/.exec(line);
  if (m === null) return null;
  return (m.groups?.email ?? "").trim();
}

/**
 * Extract the tier name from a "Tier: <name>" line.
 *
 * Returns the text after the colon, trimmed.
 */
function extractTier(line: string): string | null {
  const m = /tier:\s*(?<val>.+)/i.exec(line);
  if (m === null) return null;
  return (m.groups?.val ?? "").trim();
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse Gemini /stats output (already ANSI-stripped) into a snapshot.
 *
 * The parser handles the Session Stats panel delimited by box-drawing
 * characters (╭╮╰╯│─). Box chars are normalized to spaces before line-by-line
 * scanning so that value patterns are not disrupted.
 *
 * Flash models (gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3-flash-preview):
 * the first flash row's percentage and reset populate flashPercentLeft/flashReset.
 *
 * Pro models (gemini-2.5-pro, gemini-3.1-pro-preview):
 * the first pro row's percentage and reset populate proPercentLeft/proReset.
 *
 * @param text  ANSI-stripped text from "gemini /stats".
 * @throws {Error} if the text signals no stats are available or is empty.
 */
export function parseGeminiStats(text: string): GeminiUsageSnapshot {
  // Check for known error conditions before any normalization.
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Gemini stats error: ${text.trim()}`);
    }
  }

  if (text.trim() === "") {
    throw new Error("Gemini stats text is empty");
  }

  // Normalize box-drawing chars to spaces so value patterns match cleanly.
  const cleaned = normalizeBoxChars(text);

  const snapshot: GeminiUsageSnapshot = {
    flashPercentLeft: null,
    proPercentLeft: null,
    flashReset: null,
    proReset: null,
    accountEmail: null,
    accountTier: null,
    rawText: text,
  };

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // -----------------------------------------------------------------------
    // Auth Method line — extract email from parenthesized portion.
    // e.g. "Auth Method:  Logged in with Google (david.m.schmidty@gmail.com)"
    // -----------------------------------------------------------------------
    if (/auth\s*method/i.test(trimmed) && snapshot.accountEmail === null) {
      const email = extractEmail(trimmed);
      if (email !== null) snapshot.accountEmail = email;
      continue;
    }

    // -----------------------------------------------------------------------
    // Tier line — extract plan name after the colon.
    // e.g. "Tier:  Gemini Code Assist in Google One AI Pro"
    // -----------------------------------------------------------------------
    if (/^tier:/i.test(trimmed) && snapshot.accountTier === null) {
      const tier = extractTier(trimmed);
      if (tier !== null) snapshot.accountTier = tier;
      continue;
    }

    // -----------------------------------------------------------------------
    // Model rows — classify then extract percent and reset.
    // e.g. "gemini-2.5-flash    -    98.3%  resets in 15h 36m"
    // -----------------------------------------------------------------------
    const kind = classifyModelLine(trimmed);
    if (kind === null) continue;

    const pct = percentFromLine(trimmed);
    const reset = extractReset(trimmed);

    if (kind === "flash" && snapshot.flashPercentLeft === null) {
      snapshot.flashPercentLeft = pct;
      snapshot.flashReset = reset;
    } else if (kind === "pro" && snapshot.proPercentLeft === null) {
      snapshot.proPercentLeft = pct;
      snapshot.proReset = reset;
    }
  }

  return snapshot;
}
