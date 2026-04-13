import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  redact,
  isBlockedAttachment,
  validateAttachmentPath,
  REDACTION_PATTERNS,
  BLOCKED_FILE_PATTERNS,
} from "../redaction.js";

// ---------------------------------------------------------------------------
// Exports sanity check
// ---------------------------------------------------------------------------

describe("module exports", () => {
  it("exports REDACTION_PATTERNS as a non-empty readonly array", () => {
    expect(Array.isArray(REDACTION_PATTERNS)).toBe(true);
    expect(REDACTION_PATTERNS.length).toBeGreaterThan(0);
  });

  it("exports BLOCKED_FILE_PATTERNS as a non-empty readonly array", () => {
    expect(Array.isArray(BLOCKED_FILE_PATTERNS)).toBe(true);
    expect(BLOCKED_FILE_PATTERNS.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// redact()
// ---------------------------------------------------------------------------

describe("redact — Anthropic API keys", () => {
  it("redacts a sk-ant- key", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345";
    const result = redact(`My key is ${key}`);
    expect(result).toBe("My key is [REDACTED]");
    expect(result).not.toContain(key);
  });

  it("redacts multiple Anthropic keys in the same string", () => {
    const k1 = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAbbbbbbbb";
    const k2 = "sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZzzzzzzzz";
    const result = redact(`First: ${k1} second: ${k2}`);
    expect(result).toBe("First: [REDACTED] second: [REDACTED]");
  });
});

describe("redact — OpenAI API keys", () => {
  it("redacts a sk-proj- key", () => {
    const key = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop";
    const result = redact(`Authorization: Bearer ${key}`);
    expect(result).not.toContain(key);
    expect(result).toContain("[REDACTED]");
  });

  it("redacts a sk-svcacct- key", () => {
    const key = "sk-svcacct-ABCDEFGHIJKLMNOPQRSTUVWXabcdefg";
    expect(redact(key)).toBe("[REDACTED]");
  });

  it("redacts a plain sk- key (20+ chars)", () => {
    const key = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";
    expect(redact(key)).toBe("[REDACTED]");
  });
});

describe("redact — Google / GCP API keys", () => {
  it("redacts a key starting with AIza", () => {
    const key = "AIzaXXXX_FAKE_TEST_KEY_FOR_UNIT_TESTS_ONLY";
    const result = redact(`GOOGLE_API_KEY=${key}`);
    expect(result).not.toContain(key);
    expect(result).toContain("[REDACTED]");
  });
});

describe("redact — generic long tokens", () => {
  it("redacts a long hex string (32+ chars)", () => {
    const token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    expect(redact(token)).toBe("[REDACTED]");
  });

  it("redacts a long base64-like string (32+ chars)", () => {
    const token = "dGhpcyBpcyBhIHRlc3QgdG9rZW4gZm9y";
    expect(redact(token)).toBe("[REDACTED]");
  });
});

describe("redact — preserves normal text", () => {
  it("does not redact plain English sentences", () => {
    const text = "Hello, world! This is a normal message.";
    expect(redact(text)).toBe(text);
  });

  it("does not redact short strings", () => {
    const text = "sk-short";
    expect(redact(text)).toBe(text);
  });

  it("does not redact a standard UUID", () => {
    // UUIDs use hyphens as separators; the generic token pattern excludes hyphens
    // so the run is broken into segments of 8-12 chars — all well below 32.
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = redact(uuid);
    expect(result).toBe(uuid);
  });

  it("does not redact a normal URL", () => {
    const url = "https://example.com/api/v1/resource";
    expect(redact(url)).toBe(url);
  });

  it("preserves surrounding text when redacting an embedded key", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345";
    const result = redact(`Key: ${key}\nEnd of message.`);
    expect(result).toBe("Key: [REDACTED]\nEnd of message.");
  });
});

describe("redact — multiple keys in the same string", () => {
  it("redacts an Anthropic key and a Google key in the same string", () => {
    const ant = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345";
    const gcp = "AIzaXXXX_FAKE_TEST_KEY_FOR_UNIT_TESTS_ONLY";
    const result = redact(`ant=${ant} gcp=${gcp}`);
    expect(result).not.toContain(ant);
    expect(result).not.toContain(gcp);
    expect(result).toBe("ant=[REDACTED] gcp=[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// isBlockedAttachment()
// ---------------------------------------------------------------------------

describe("isBlockedAttachment — blocked files", () => {
  const blocked = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development.local",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
    "server.pem",
    "private.key",
    ".npmrc",
    "credentials.json",
    "aws_credentials",
    "gcp-credentials.json",
  ];

  for (const filename of blocked) {
    it(`blocks ${filename}`, () => {
      expect(isBlockedAttachment(filename)).toBe(true);
    });
  }

  it("blocks a path whose basename is .env", () => {
    expect(isBlockedAttachment("/home/user/project/.env")).toBe(true);
  });

  it("blocks a path whose basename is id_rsa", () => {
    expect(isBlockedAttachment("/home/user/.ssh/id_rsa")).toBe(true);
  });
});

describe("isBlockedAttachment — allowed files", () => {
  const allowed = [
    "index.ts",
    "README.md",
    "package.json",
    "tsconfig.json",
    "vitest.config.ts",
    "src/main.ts",
    "data.csv",
    "logo.png",
  ];

  for (const filename of allowed) {
    it(`allows ${filename}`, () => {
      expect(isBlockedAttachment(filename)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// validateAttachmentPath()
// ---------------------------------------------------------------------------

describe("validateAttachmentPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-redact-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts a file inside the project root", async () => {
    const filePath = path.join(tmpDir, "src", "main.ts");
    // File does not need to exist for the lexical containment check.
    const result = await validateAttachmentPath(filePath, tmpDir);
    expect(result.safe).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts a file at the project root itself", async () => {
    const filePath = path.join(tmpDir, "README.md");
    const result = await validateAttachmentPath(filePath, tmpDir);
    expect(result.safe).toBe(true);
  });

  it("rejects a path outside the project root (directory traversal)", async () => {
    const filePath = path.join(tmpDir, "..", "outside.txt");
    const result = await validateAttachmentPath(filePath, tmpDir);
    expect(result.safe).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects an absolute path to /etc/passwd", async () => {
    const result = await validateAttachmentPath("/etc/passwd", tmpDir);
    expect(result.safe).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects a symlink pointing outside the project root", async () => {
    // Create a real file outside the project root.
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-outside-"));
    const outsideFile = path.join(outsideDir, "secret.txt");
    await fs.writeFile(outsideFile, "secret");

    // Create a symlink inside the project root pointing to the outside file.
    const symlinkPath = path.join(tmpDir, "link.txt");
    await fs.symlink(outsideFile, symlinkPath);

    try {
      const result = await validateAttachmentPath(symlinkPath, tmpDir);
      expect(result.safe).toBe(false);
      expect(result.reason).toBeDefined();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("accepts a real file inside the project root (no symlink)", async () => {
    const filePath = path.join(tmpDir, "real.ts");
    await fs.writeFile(filePath, "// content");
    const result = await validateAttachmentPath(filePath, tmpDir);
    expect(result.safe).toBe(true);
  });
});
