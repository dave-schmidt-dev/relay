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
  it("removes various color and formatting sequences", () => {
    // ESC[31m foreground red
    expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
    // ESC[0m reset alone
    expect(stripAnsi("\x1b[0m")).toBe("");
    // multi-parameter ESC[1;32m
    expect(stripAnsi("\x1b[1;32mgreen bold\x1b[0m")).toBe("green bold");
    // 256-color ESC[38;5;208m
    expect(stripAnsi("\x1b[38;5;208morange\x1b[0m")).toBe("orange");
    // adjacent sequences with no text between
    expect(stripAnsi("\x1b[1m\x1b[31m\x1b[0m")).toBe("");
  });

  it("preserves text between sequences", () => {
    expect(stripAnsi("before\x1b[31mred\x1b[0mafter")).toBe("beforeredafter");
  });
});

describe("stripAnsi: OSC sequences", () => {
  // NOTE: The ANSI_RE pattern matches ] as a single-char Fe escape (branch 1:
  // [@-Z\\-_]), stripping the ESC+] introducer but NOT the OSC payload or
  // terminator. This matches the Python source behavior exactly — the OSC
  // branch in the regex is effectively shadowed by the Fe branch for ].
  // BEL (\x07) is then removed by CTRL_RE; ESC\ ST is stripped on a second
  // pass as another Fe sequence.
  it("handles all OSC patterns", () => {
    // ESC] stripped by ANSI_RE branch 1; BEL stripped by CTRL_RE
    expect(stripAnsi("\x1b]0;My Terminal Title\x07text")).toBe("0;My Terminal Titletext");
    // ESC] stripped by branch 1; ESC\ also stripped by branch 1
    expect(stripAnsi("\x1b]0;My Terminal Title\x1b\\text")).toBe("0;My Terminal Titletext");
    // ESC] stripped by branch 1 mid-string; remaining payload + BEL stripped by CTRL_RE
    expect(stripAnsi("start\x1b]0;title\x07end")).toBe("start0;titleend");
  });
});

describe("stripAnsi: control characters", () => {
  it("removes control chars across all ranges (\\x00–\\x08, \\x0b–\\x1f, \\x7f)", () => {
    expect(stripAnsi("a\x00b")).toBe("ab");
    expect(stripAnsi("a\x08b")).toBe("ab");
    expect(stripAnsi("a\x0bb")).toBe("ab");
    expect(stripAnsi("a\x7fb")).toBe("ab");
    const lowControls = Array.from({ length: 9 }, (_, i) => String.fromCharCode(i)).join("");
    expect(stripAnsi(`a${lowControls}b`)).toBe("ab");
    const midControls = Array.from({ length: 21 }, (_, i) => String.fromCharCode(0x0b + i)).join(
      "",
    );
    expect(stripAnsi(`a${midControls}b`)).toBe("ab");
  });

  it("preserves tab (\\x09) and newline (\\x0a)", () => {
    expect(stripAnsi("a\tb")).toBe("a\tb");
    expect(stripAnsi("a\nb")).toBe("a\nb");
  });
});

describe("stripAnsi: \\r normalization", () => {
  // NOTE: \r (\x0d) falls within the CTRL_RE range \x0b-\x1f and is removed
  // by CTRL_RE before the \r→\n replacement runs. This matches the Python
  // behavior: CTRL_RE strips \r, then .replace("\r", "\n") is a no-op.
  // The net effect is that \r is stripped (not converted to \n).
  it("handles all \\r cases: bare \\r, \\r\\n sequences, and multiple \\r", () => {
    // bare \r — stripped by CTRL_RE before \r→\n replacement
    expect(stripAnsi("a\rb")).toBe("ab");
    // \r stripped by CTRL_RE; \n preserved
    expect(stripAnsi("a\r\nb")).toBe("a\nb");
    // multiple \r stripped
    expect(stripAnsi("a\r\r\rb")).toBe("ab");
  });
});

describe("stripAnsi: edge cases", () => {
  it("handles empty string and plain text unchanged", () => {
    expect(stripAnsi("")).toBe("");
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("is idempotent on already-clean text and when called twice on dirty text", () => {
    const clean = "hello\nworld\n";
    expect(stripAnsi(clean)).toBe(clean);
    const dirty = "\x1b[31mred\x1b[0m\nplain";
    expect(stripAnsi(stripAnsi(dirty))).toBe(stripAnsi(dirty));
  });
});

// ---------------------------------------------------------------------------
// compactWhitespace
// ---------------------------------------------------------------------------

describe("compactWhitespace: blank line collapsing", () => {
  it("collapses consecutive blank lines into one and treats space-only lines as blank", () => {
    expect(compactWhitespace("a\n\n\nb")).toBe("a\n\nb");
    expect(compactWhitespace("a\n\n\n\n\n\nb")).toBe("a\n\nb");
    // single blank line between content — must not be removed
    expect(compactWhitespace("a\n\nb")).toBe("a\n\nb");
    // lines with only spaces treated as blank
    expect(compactWhitespace("a\n   \n   \nb")).toBe("a\n\nb");
  });

  it("trims trailing whitespace per line, leading/trailing blank lines, and single lines", () => {
    expect(compactWhitespace("hello   \nworld  ")).toBe("hello\nworld");
    expect(compactWhitespace("\n\nhello\n\n")).toBe("hello");
    expect(compactWhitespace("  hello  ")).toBe("hello");
  });
});

describe("compactWhitespace: edge cases", () => {
  it("returns empty string for empty and whitespace-only input", () => {
    expect(compactWhitespace("")).toBe("");
    expect(compactWhitespace("   \n\n   ")).toBe("");
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
  it("removes block characters while preserving surrounding text", () => {
    expect(stripBlockChars("██████")).toBe("");
    expect(stripBlockChars("█▉▊▋▌▍▎▏▓▒░")).toBe("");
    expect(stripBlockChars("48%░░█████used")).toBe("48%used");
  });

  it("handles edge cases: empty string, box-drawing preservation, and idempotency", () => {
    expect(stripBlockChars("")).toBe("");
    // box-drawing characters (╭╮╰╯│─) must be left intact
    const boxChars = "╭──╮\n│  │\n╰──╯";
    expect(stripBlockChars(boxChars)).toBe(boxChars);
    const input = "██ 70% ██";
    expect(stripBlockChars(stripBlockChars(input))).toBe(stripBlockChars(input));
  });
});

// ---------------------------------------------------------------------------
// normalizeProbeOutput — pipeline
// ---------------------------------------------------------------------------

describe("normalizeProbeOutput: pipeline", () => {
  it("strips ANSI then compacts whitespace, and handles empty/ANSI-only input", () => {
    const raw = "\x1b[31mhello\x1b[0m\n\n\nworld";
    expect(normalizeProbeOutput(raw)).toBe("hello\n\nworld");
    expect(normalizeProbeOutput("")).toBe("");
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

  it("fixture properties and block char handling", () => {
    expect(raw.length).toBeGreaterThan(0);
    // fixture contains block chars before stripping
    expect(raw).toMatch(/[█▉▊▋▌▍▎▏▓▒░]/);
    // stripAnsi leaves block chars intact (they are not ANSI)
    expect(stripAnsi(raw)).toMatch(/[█▉▊▋▌▍▎▏▓▒░]/);
    // stripBlockChars removes all block characters
    expect(stripBlockChars(raw)).not.toMatch(/[█▉▊▋▌▍▎▏▓▒░]/);
  });

  it("normalizeProbeOutput produces clean output", () => {
    const normalized = normalizeProbeOutput(raw);
    // should still contain usage percentages after normalization
    expect(normalized).toMatch(/\d+%/);
    expect(normalized).toBe(normalized.trim());
    expect(normalized).not.toMatch(/\n\n\n/);
  });
});

describe("golden fixture: fixtures/codex/status-probe-live-style.txt", () => {
  // This fixture contains box-drawing chars (│─) and progress bar blocks (███).
  const raw = readFixture("codex", "status-probe-live-style.txt");

  it("fixture properties and box-drawing character preservation", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).toContain("│");
    // stripAnsi does not remove box-drawing characters
    expect(stripAnsi(raw)).toContain("│");
  });

  it("normalizeProbeOutput output is clean and preserves box-drawing chars", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toContain("│");
    expect(normalized).not.toMatch(/\n\n\n/);
    expect(normalized).toMatch(/\d+%/);
  });
});

describe("golden fixture: fixtures/gemini/stats-probe-clean.txt", () => {
  // This fixture uses box-drawing characters (╭╮╰╯│─) for its table borders.
  const raw = readFixture("gemini", "stats-probe-clean.txt");

  it("fixture properties and box-drawing character handling", () => {
    expect(raw.length).toBeGreaterThan(0);
    // Gemini uses rounded-corner box chars
    expect(raw).toMatch(/[╭╮╰╯│─]/);
    // stripAnsi preserves Unicode box-drawing characters
    expect(stripAnsi(raw)).toMatch(/[╭╮╰╯│─]/);
  });

  it("normalizeProbeOutput output is clean and preserves box-drawing chars", () => {
    const normalized = normalizeProbeOutput(raw);
    expect(normalized).toMatch(/[╭╮╰╯│─]/);
    expect(normalized).toBe(normalized.trim());
    expect(normalized).not.toMatch(/\n\n\n/);
  });
});
