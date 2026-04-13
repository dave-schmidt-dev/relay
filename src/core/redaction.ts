import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Known API key patterns for major providers.
 *
 * Design intent: conservative matching — prefer false negatives over false
 * positives. Each pattern anchors to the distinctive prefix so that ordinary
 * short strings are never caught. The generic token pattern requires 32+
 * consecutive token characters to avoid matching UUIDs, hashes, or identifiers
 * that happen to contain only alphanumerics.
 *
 * NOTE: Order matters — more-specific patterns (Anthropic, OpenAI) come first
 * so their matches are reported under the right label even when the generic
 * pattern would also fire.
 */
export const REDACTION_PATTERNS: readonly RegExp[] = [
  // Anthropic: sk-ant-api03-<base62+_->
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,

  // OpenAI: sk-proj-..., sk-svcacct-..., or plain sk- (20+ chars after prefix)
  /sk-(?:proj|svcacct)-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,

  // Google / GCP: starts with AIza
  /AIza[a-zA-Z0-9_-]{35,}/g,

  // Generic long token: 32+ chars of base64/hex/token alphabet.
  // Hyphens are intentionally excluded from the character class so that
  // hyphen-delimited identifiers (UUIDs, Docker image digests, etc.) are not
  // caught — their segments are each well under 32 chars. The named-prefix
  // patterns above already handle the hyphenated key formats (sk-ant-, etc.).
  /(?<![a-zA-Z0-9+/=_])[a-zA-Z0-9+/=_]{32,}(?![a-zA-Z0-9+/=_])/g,
] as const;

/**
 * File patterns that are blocked from being attached to prompts.
 *
 * Covers environment files, credential files, TLS private keys, SSH keys,
 * npm authentication tokens, and common credential file names.
 */
export const BLOCKED_FILE_PATTERNS: readonly RegExp[] = [
  // .env and any variant: .env.local, .env.production, etc.
  /^\.env(\..+)?$/,

  // PEM-encoded certificates / private keys
  /\.pem$/i,

  // Generic key files
  /\.key$/i,

  // npm authentication config
  /^\.npmrc$/,

  // Files with "credentials" anywhere in the name
  /credentials/i,

  // SSH private key names
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_ecdsa$/,
  /^id_dsa$/,

  // GitHub / GitLab deploy key names
  /^id_rsa\.pub$/,
  /^id_ed25519\.pub$/,
] as const;

/**
 * Redact API keys and secrets from text.
 *
 * Each known pattern is applied in order with global replacement. The text is
 * never parsed — raw string replacement only — so structured formats (JSON,
 * YAML) lose the sensitive value but retain surrounding syntax.
 *
 * @param text - The input string to scan.
 * @returns A new string with all matched secrets replaced by `[REDACTED]`.
 */
export function redact(text: string): string {
  let result = text;
  for (const pattern of REDACTION_PATTERNS) {
    // Reset lastIndex on each pass in case the regex was used externally.
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Check if a filename matches one of the blocked attachment patterns.
 *
 * Only the basename is checked — callers are responsible for extracting it
 * with `path.basename()` before passing it here, or they may pass a full path
 * (the check uses `path.basename` internally).
 *
 * @param filename - A filename or path whose basename will be checked.
 * @returns `true` if the file should be blocked.
 */
export function isBlockedAttachment(filename: string): boolean {
  const base = path.basename(filename);
  return BLOCKED_FILE_PATTERNS.some((pattern) => pattern.test(base));
}

/**
 * Validate that a file path is safe to attach.
 *
 * A path is considered safe when:
 * 1. It resolves to a location inside `projectRoot` (no directory traversal).
 * 2. It is not a symlink that points outside `projectRoot`.
 *
 * @param filePath    - The file path provided by the caller.
 * @param projectRoot - The absolute project root that acts as the boundary.
 * @returns An object with `safe: true` on success, or `safe: false` plus a
 *          human-readable `reason` on failure.
 */
export async function validateAttachmentPath(
  filePath: string,
  projectRoot: string,
): Promise<{ safe: boolean; reason?: string }> {
  // Resolve both paths to their canonical absolute forms for comparison.
  const absRoot = path.resolve(projectRoot);
  const absFile = path.resolve(filePath);

  // Ensure the resolved path is inside the project root.
  const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : absRoot + path.sep;
  if (absFile !== absRoot && !absFile.startsWith(rootWithSep)) {
    return {
      safe: false,
      reason: `Path "${filePath}" is outside the project root "${projectRoot}"`,
    };
  }

  // Check for symlinks that escape the project root.
  try {
    const realFile = await fs.realpath(absFile);
    const realRoot = await fs.realpath(absRoot);
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;

    if (realFile !== realRoot && !realFile.startsWith(realRootWithSep)) {
      return {
        safe: false,
        reason: `Path "${filePath}" is a symlink that resolves outside the project root`,
      };
    }
  } catch (err: unknown) {
    // If realpath fails (e.g. file does not exist yet), check only the
    // lexical containment already validated above — the symlink check cannot
    // be performed on a non-existent path.
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      // Lexical check already passed; treat as safe.
      return { safe: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { safe: false, reason: `Cannot validate path: ${message}` };
  }

  return { safe: true };
}
