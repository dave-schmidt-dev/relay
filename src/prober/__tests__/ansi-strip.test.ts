/**
 * Tests for the ANSI stripping and text normalization pipeline.
 *
 * Covers both synthetic sequences and real PTY captures from golden fixtures
 * (TASK-014, REQ-014).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { stripAnsi, compactWhitespace, stripBlockChars, normalizeProbeOutput } from "../ansi.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Test file lives at src/prober/__tests__/ — 4 levels up is project root.
const fixturesBase = path.resolve(import.meta.dirname, "../../../fixtures");

function readFixture(provider: string, filename: string): string {
  return fs.readFileSync(path.join(fixturesBase, provider, filename), "utf8");
}

// ---------------------------------------------------------------------------
// stripAnsi — synthetic sequences
// ---------------------------------------------------------------------------

describe("stripAnsi: CSI color sequences", () => {
  it("removes ESC[31m (foreground red)", () => {
    expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
  });

  it("removes ESC[0m (reset)", () => {
    expect(stripAnsi("\x1b[0m")).toBe("");
  });

  it("removes multi-parameter sequences (ESC[1;32m)", () => {
    expect(stripAnsi("\x1b[1;32mgreen bold\x1b[0m")).toBe("green bold");
  });

  it("removes 256-color sequences (ESC[38;5;208m)", () => {
    expect(stripAnsi("\x1b[38;5;208morange\x1b[0m")).toBe("orange");
  });

  it("preserves text between sequences", () => {
    expect(stripAnsi("before\x1b[31mred\x1b[0mafter")).toBe("beforeredafter");
  });

  it("handles adjacent sequences with no text between", () => {
    expect(stripAnsi("\x1b[1m\x1b[31m\x1b[0m")).toBe("");
  });
});

describe("stripAnsi: OSC sequences", () => {
  // NOTE: The ANSI_RE pattern matches ] as a single-char Fe escape (branch 1:
  // [@-Z\\-_]), stripping the ESC+] introducer but NOT the OSC payload or
  // terminator. This matches the Python source behavior exactly — the OSC
  // branch in the regex is effectively shadowed by the Fe branch for ].
  // BEL (\x07) is then removed by CTRL_RE; ESC\ ST is stripped on a second
  // pass as another Fe sequence.
  it("strips ESC+] introducer; BEL terminator removed by CTRL_RE", () => {
    // ESC] stripped by ANSI_RE branch 1; BEL stripped by CTRL_RE
    expect(stripAnsi("\x1b]0;My Terminal Title\x07text")).toBe("0;My Terminal Titletext");
  });

  it("strips ESC+] introducer and ESC+\\ ST terminator separately", () => {
    // ESC] stripped by branch 1; ESC\ also stripped by branch 1
    expect(stripAnsi("\x1b]0;My Terminal Title\x1b\\text")).toBe("0;My Terminal Titletext");
  });

  it("handles OSC introducer mid-string", () => {
    // ESC] stripped by branch 1; remaining payload + BEL stripped by CTRL_RE
    expect(stripAnsi("start\x1b]0;title\x07end")).toBe("start0;titleend");
  });
});

describe("stripAnsi: control characters", () => {
  it("removes NUL (\\x00)", () => {
    expect(stripAnsi("a\x00b")).toBe("ab");
  });

  it("removes BS (\\x08)", () => {
    expect(stripAnsi("a\x08b")).toBe("ab");
  });

  it("removes VT (\\x0b)", () => {
    expect(stripAnsi("a\x0bb")).toBe("ab");
  });

  it("removes the full range \\x00–\\x08", () => {
    const controls = Array.from({ length: 9 }, (_, i) => String.fromCharCode(i)).join("");
    expect(stripAnsi(`a${controls}b`)).toBe("ab");
  });

  it("removes the range \\x0b–\\x1f", () => {
    const controls = Array.from({ length: 21 }, (_, i) => String.fromCharCode(0x0b + i)).join("");
    expect(stripAnsi(`a${controls}b`)).toBe("ab");
  });

  it("removes DEL (\\x7f)", () => {
    expect(stripAnsi("a\x7fb")).toBe("ab");
  });

  it("preserves tab (\\x09)", () => {
    expect(stripAnsi("a\tb")).toBe("a\tb");
  });

  it("preserves newline (\\x0a)", () => {
    expect(stripAnsi("a\nb")).toBe("a\nb");
  });
});

describe("stripAnsi: \\r normalization", () => {
  // NOTE: \r (\x0d) falls within the CTRL_RE range \x0b-\x1f and is removed
  // by CTRL_RE before the \r→\n replacement runs. This matches the Python
  // behavior: CTRL_RE strips \r, then .replace("\r", "\n") is a no-op.
  // The net effect is that \r is stripped (not converted to \n).
  it("removes bare \\r (stripped by CTRL_RE before \\r→\\n replacement)", () => {
    expect(stripAnsi("a\rb")).toBe("ab");
  });

  it("removes \\r from \\r\\n sequences, leaving \\n intact", () => {
    // \r stripped by CTRL_RE; \n preserved
    expect(stripAnsi("a\r\nb")).toBe("a\nb");
  });

  it("removes multiple \\r characters", () => {
    expect(stripAnsi("a\r\r\rb")).toBe("ab");
  });
});

describe("stripAnsi: edge cases", () => {
  it("returns empty string for empty input", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("is idempotent on already-clean text", () => {
    const clean = "hello\nworld\n";
    expect(stripAnsi(clean)).toBe(clean);
  });

  it("is idempotent when called twice", () => {
    const dirty = "\x1b[31mred\x1b[0m\nplain";
    expect(stripAnsi(stripAnsi(dirty))).toBe(stripAnsi(dirty));
  });
});

// ---------------------------------------------------------------------------
// compactWhitespace
// ---------------------------------------------------------------------------

describe("compactWhitespace: blank line collapsing", () => {
  it("collapses two consecutive blank lines into one", () => {
    const input = "a\n\n\nb";
    expect(compactWhitespace(input)).toBe("a\n\nb");
  });

  it("collapses many consecutive blank lines into one", () => {
    const input = "a\n\n\n\n\n\nb";
    expect(compactWhitespace(input)).toBe("a\n\nb");
  });

  it("does not remove a single blank line between content", () => {
    expect(compactWhitespace("a\n\nb")).toBe("a\n\nb");
  });

  it("trims trailing whitespace from each line", () => {
    expect(compactWhitespace("hello   \nworld  ")).toBe("hello\nworld");
  });

  it("strips leading and trailing blank lines", () => {
    expect(compactWhitespace("\n\nhello\n\n")).toBe("hello");
  });

  it("handles lines with only spaces as blank", () => {
    expect(compactWhitespace("a\n   \n   \nb")).toBe("a\n\nb");
  });
});

describe("compactWhitespace: edge cases", () => {
  it("returns empty string for empty input", () => {
    expect(compactWhitespace("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(compactWhitespace("   \n\n   ")).toBe("");
  });

  it("returns single line unchanged (after trim)", () => {
    expect(compactWhitespace("  hello  ")).toBe("hello");
  });

  it("is idempotent", () => {
    const input = "a\n\n\nb\n\nc";
    const once = compactWhitespace(input);
    expect(compactWhitespace(once)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// stripBlockChars
// ---------------------------------------------------------------------------

describe("stripBlockChars", () => {
  it("removes full block (█)", () => {
    expect(stripBlockChars("██████")).toBe("");
  });

  it("removes mixed block characters", () => {
    expect(stripBlockChars("█▉▊▋▌▍▎▏▓▒░")).toBe("");
  });

  it("preserves surrounding text", () => {
    expect(stripBlockChars("48%░░█████used")).toBe("48%used");
  });

  it("returns empty string for empty input", () => {
    expect(stripBlockChars("")).toBe("");
  });

  it("leaves box-drawing characters (╭╮╰╯│─) intact", () => {
    const boxChars = "╭──╮\n│  │\n╰──╯";
    expect(stripBlockChars(boxChars)).toBe(boxChars);
  });

  it("is idempotent", () => {
    const input = "██ 70% ██";
    expect(stripBlockChars(stripBlockChars(input))).toBe(stripBlockChars(input));
  });
});

// ---------------------------------------------------------------------------
// normalizeProbeOutput — pipeline
// ---------------------------------------------------------------------------

describe("normalizeProbeOutput: pipeline", () => {
  it("strips ANSI then compacts whitespace", () => {
    const raw = "\x1b[31mhello\x1b[0m\n\n\nworld";
    expect(normalizeProbeOutput(raw)).toBe("hello\n\nworld");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeProbeOutput("")).toBe("");
  });

  it("returns empty string for ANSI-only input", () => {
    expect(normalizeProbeOutput("\x1b[0m\x1b[1m")).toBe("");
  });

  it("handles real-world \\r\\n line endings", () => {
    const raw = "line1\r\nline2\r\nline3";
    // \r is stripped by CTRL_RE (same as Python); \n is preserved.
    // Result after stripAnsi: "line1\nline2\nline3"
    const result = normalizeProbeOutput(raw);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
  });
});

// ---------------------------------------------------------------------------
// Golden fixture tests — real PTY captures
// ---------------------------------------------------------------------------

describe("golden fixture: fixtures/claude/usage-probe-live-style.txt", () => {
  // This fixture contains block characters (████) from the progress bar.
  const raw = readFixture("claude", "usage-probe-live-style.txt");

  it("fixture is non-empty", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("fixture contains block characters before stripping", () => {
    expect(raw).toMatch(/[█▉▊▋▌▍▎▏▓▒░]/);
  });

  it("stripAnsi leaves block chars intact (they are not ANSI)", () => {
    const stripped = stripAnsi(raw);
    expect(stripped).toMatch(/[█▉▊▋▌▍▎▏▓▒░]/);
  });

  it("stripBlockChars removes all block characters", () => {
    const noBlocks = stripBlockChars(raw);
    expect(noBlocks).not.toMatch(/[█▉▊▋▌▍▎▏▓▒░]/);
  });

  it("normalizeProbeOutput produces parseable text with percent values", () => {
    const normalized = normalizeProbeOutput(raw);
    // Should still contain usage percentages after normalization
    expect(normalized).toMatch(/\d+%/);
  });

  it("normalizeProbeOutput has no leading or trailing whitespace", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toBe(normalized.trim());
  });

  it("normalizeProbeOutput contains no consecutive blank lines", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).not.toMatch(/\n\n\n/);
  });
});

describe("golden fixture: fixtures/codex/status-probe-live-style.txt", () => {
  // This fixture contains box-drawing chars (│─) and progress bar blocks (███).
  const raw = readFixture("codex", "status-probe-live-style.txt");

  it("fixture is non-empty", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("fixture contains box-drawing characters (│)", () => {
    expect(raw).toContain("│");
  });

  it("stripAnsi does not remove box-drawing characters", () => {
    const stripped = stripAnsi(raw);
    expect(stripped).toContain("│");
  });

  it("normalizeProbeOutput preserves box-drawing characters", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toContain("│");
  });

  it("normalizeProbeOutput has no consecutive blank lines", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).not.toMatch(/\n\n\n/);
  });

  it("normalizeProbeOutput retains percent values", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toMatch(/\d+%/);
  });
});

describe("golden fixture: fixtures/gemini/stats-probe-clean.txt", () => {
  // This fixture uses box-drawing characters (╭╮╰╯│─) for its table borders.
  const raw = readFixture("gemini", "stats-probe-clean.txt");

  it("fixture is non-empty", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("fixture contains Unicode box-drawing characters", () => {
    // Gemini uses rounded-corner box chars
    expect(raw).toMatch(/[╭╮╰╯│─]/);
  });

  it("stripAnsi preserves Unicode box-drawing characters", () => {
    const stripped = stripAnsi(raw);
    expect(stripped).toMatch(/[╭╮╰╯│─]/);
  });

  it("normalizeProbeOutput preserves Unicode box-drawing characters", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toMatch(/[╭╮╰╯│─]/);
  });

  it("normalizeProbeOutput has no leading or trailing whitespace", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toBe(normalized.trim());
  });

  it("normalizeProbeOutput has no consecutive blank lines", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).not.toMatch(/\n\n\n/);
  });
});
