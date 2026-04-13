/**
 * ANSI stripping and text normalization pipeline.
 *
 * Ports strip_ansi, compact_whitespace, and related utilities from the
 * ai_monitor Python project. Used to clean raw PTY output before parsing.
 */

// Matches CSI sequences (ESC[...m), OSC sequences (ESC]...BEL/ST), and
// other Fe escape sequences (ESC followed by @-Z, \-_).
// NOTE: JS requires the ESC character as a literal \x1b; the rest mirrors
// the Python ANSI_RE pattern exactly.
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1b\\))/g;

// Matches control characters except \t (\x09) and \n (\x0a).
// Removes NUL through BS (\x00-\x08), VT through US (\x0b-\x1f) — note that
// \r (\x0d) falls in this range and is stripped here — and DEL (\x7f).
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

// Matches Unicode block-drawing fill characters (full block down to light shade).
const BLOCK_CHARS_RE = /[█▉▊▋▌▍▎▏▓▒░]+/g;

/**
 * Remove ANSI escape codes and non-printable control characters from text,
 * then normalize carriage returns to newlines.
 *
 * Handles:
 * - CSI sequences (ESC[...m color/style codes)
 * - OSC sequences (ESC]...BEL or ESC]...ESC\ title strings)
 * - Other Fe escape sequences
 * - Control characters \x00–\x08, \x0b–\x1f (including \r), \x7f
 *
 * NOTE: \r (\x0d) is in the CTRL_RE range and is stripped rather than
 * converted to \n. This matches the Python source behavior.
 */
export function stripAnsi(text: string): string {
  // Reset lastIndex before each use — shared regex objects retain state
  // between calls when the /g flag is set.
  ANSI_RE.lastIndex = 0;
  CTRL_RE.lastIndex = 0;

  let result = text.replace(ANSI_RE, "");
  result = result.replace(CTRL_RE, "");
  return result.replace(/\r/g, "\n");
}

/**
 * Collapse consecutive blank lines into a single blank line and strip
 * leading/trailing whitespace from the result.
 *
 * Mirrors Python compact_whitespace: trailing whitespace on each line is
 * removed, then runs of two or more blank lines are reduced to one.
 */
export function compactWhitespace(text: string): string {
  const lines = text.split("\n").map((line) => line.trimEnd());
  const output: string[] = [];
  let prevBlank = false;

  for (const line of lines) {
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) {
      // Skip this blank — it's part of a consecutive run.
      continue;
    }
    output.push(line);
    prevBlank = isBlank;
  }

  return output.join("\n").trim();
}

/**
 * Remove Unicode block-drawing fill characters (█▉▊▋▌▍▎▏▓▒░) from text.
 *
 * These appear in progress-bar rendering (e.g. Claude's /usage output) and
 * are not meaningful for parsing.
 */
export function stripBlockChars(text: string): string {
  BLOCK_CHARS_RE.lastIndex = 0;
  return text.replace(BLOCK_CHARS_RE, "");
}

/**
 * Full normalization pipeline for raw PTY probe output.
 *
 * Applies: stripAnsi → compactWhitespace
 *
 * Use this as the entry point for cleaning captured CLI output before
 * handing it to provider-specific parsers.
 */
export function normalizeProbeOutput(text: string): string {
  return compactWhitespace(stripAnsi(text));
}
