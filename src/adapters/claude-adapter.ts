import type { ProviderAdapter, HandoffPacket } from "./adapter-types.js";

/**
 * Shape of the JSON object Claude emits when --output-format json is used.
 * Only fields relevant to output parsing are typed here; the rest are unknown.
 */
interface ClaudeJsonOutput {
  result: string;
  [key: string]: unknown;
}

/**
 * Rate-limit indicator patterns sourced from fixtures/claude/cli-metadata.json.
 *
 * The second pattern preserves the real-world typo ("vilable") exactly as it
 * appears in the actual Claude CLI output so detection matches correctly.
 */
const RATE_LIMIT_PATTERNS: readonly string[] = [
  "Failed to load usage data: rate limited",
  "/usage is only vilable for subscription plans",
  "rate limit",
  "rate_limit_error",
];

/**
 * Claude CLI provider adapter.
 *
 * Encapsulates all Claude-specific knowledge: CLI flags, output structure,
 * exit code meanings, and rate-limit detection patterns. The adapter is a
 * pure-logic module — it never spawns processes.
 *
 * REQ-004: Each adapter defines CLI command template, env var requirements,
 *          output parser, exit code map, rate-limit detection, and handoff
 *          prompt builder.
 * REQ-013: Adapters implement the ProviderAdapter interface.
 */
export const claudeAdapter: ProviderAdapter = {
  provider: "claude",
  executable: "claude",
  requiredEnvVars: ["ANTHROPIC_API_KEY"],

  /**
   * Build the argv for a Claude task run.
   *
   * Produces: ["claude", "-p", <prompt>, "--output-format", <format>]
   * with an optional "--model" flag appended when a model is specified.
   *
   * The prompt flag is "-p" per cli-metadata.json; output format defaults
   * to "json" so callers get structured output they can parse reliably.
   */
  buildCommand(prompt: string, options?: { model?: string; outputFormat?: string }): string[] {
    const format = options?.outputFormat ?? "json";

    const argv: string[] = ["claude", "-p", prompt, "--output-format", format];

    if (options?.model !== undefined) {
      argv.push("--model", options.model);
    }

    return argv;
  },

  /**
   * Extract the final text result from raw stdout.
   *
   * JSON format: parse the envelope, return the .result string.
   * Text format: return the stdout trimmed of surrounding whitespace.
   *
   * Throws if JSON format is requested but the output cannot be parsed or
   * lacks a .result field — this surfaces upstream as a run failure rather
   * than silently returning empty output.
   */
  parseOutput(stdout: string, outputFormat?: string): string {
    const format = outputFormat ?? "json";

    if (format === "json") {
      const parsed = JSON.parse(stdout) as ClaudeJsonOutput;
      if (typeof parsed.result !== "string") {
        throw new Error("claude-adapter: JSON output missing or non-string .result field");
      }
      return parsed.result;
    }

    // Text and stream-json formats: return raw stdout trimmed.
    return stdout.trim();
  },

  /**
   * Interpret a Claude CLI exit code.
   *
   * Per cli-metadata.json:
   *   0 — success
   *   1 — general failure (model error, tool non-zero exit, etc.)
   *   2 — usage error (bad flags or arguments)
   * Anything else is treated as unknown.
   */
  interpretExitCode(code: number): { success: boolean; reason: string } {
    switch (code) {
      case 0:
        return { success: true, reason: "success" };
      case 1:
        return {
          success: false,
          reason: "error (general failure, model error, or non-zero exit from tool)",
        };
      case 2:
        return {
          success: false,
          reason: "usage error (bad flags or arguments)",
        };
      default:
        return { success: false, reason: "unknown exit code " + String(code) };
    }
  },

  /**
   * Return true if the text contains a Claude rate-limit indicator.
   *
   * Checks are case-insensitive for "rate limit" / "rate_limit_error" to
   * catch variations; the two fixture-derived patterns are matched literally
   * since they include specific phrasing (including the real-world typo).
   */
  detectRateLimit(text: string): boolean {
    const lower = text.toLowerCase();

    for (const pattern of RATE_LIMIT_PATTERNS) {
      // Literal patterns from fixtures: match exactly as-is (case-insensitive
      // for the generic ones, but the typo fixture uses a unique enough string
      // that case sensitivity doesn't matter in practice).
      if (lower.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    return false;
  },

  /**
   * Transform a handoff packet into a Claude-specific prompt string.
   *
   * The output is a Markdown document with a task title, an objective block,
   * and one named section per context item. This format works well with
   * Claude's instruction-following and keeps the handoff self-contained.
   *
   * NOTE: scoreFor() and full routing logic are implemented in TASK-016.
   */
  buildHandoffPrompt(handoff: HandoffPacket): string {
    const { title, objective, contextItems } = handoff;

    const lines: string[] = [];

    lines.push(`<objective>`);
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(objective);
    lines.push(`</objective>`);

    if (contextItems.length > 0) {
      lines.push("");
      lines.push(`<context>`);
      for (const item of contextItems) {
        lines.push(`<context_item title="${item.title}">`);
        lines.push(item.body);
        lines.push(`</context_item>`);
      }
      lines.push(`</context>`);
    }

    return lines.join("\n");
  },
};
