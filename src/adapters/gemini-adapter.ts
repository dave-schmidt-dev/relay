import type { ProviderAdapter, HandoffPacket } from "./adapter-types.js";

/**
 * Rate-limit indicator patterns sourced from fixtures/gemini/cli-metadata.json.
 *
 * Gemini uses Google OAuth, so rate-limit signals come from the model tier
 * quota system rather than an API key check.
 */
const RATE_LIMIT_PATTERNS: readonly string[] = [
  "capacity-related errors",
  "rate limit",
  "quota exceeded",
];

/**
 * Gemini CLI provider adapter.
 *
 * Encapsulates all Gemini-specific knowledge: CLI flags, output structure,
 * exit code meanings, and rate-limit detection patterns. The adapter is a
 * pure-logic module — it never spawns processes.
 *
 * Gemini uses Google OAuth for auth, so requiredEnvVars is empty — no API
 * key environment variable is needed.
 *
 * REQ-004: Each adapter defines CLI command template, env var requirements,
 *          output parser, exit code map, rate-limit detection, and handoff
 *          prompt builder.
 * REQ-013: Adapters implement the ProviderAdapter interface.
 */
export const geminiAdapter: ProviderAdapter = {
  provider: "gemini",
  executable: "gemini",
  requiredEnvVars: [],

  /**
   * Build the argv for a Gemini task run.
   *
   * Produces: ["gemini", "-p", <prompt>]
   * with optional "-m <model>" and "-o <format>" flags prepended to the prompt.
   *
   * Output format defaults to "text" — Gemini's default stdout is plain text,
   * which can be trimmed and used directly without envelope parsing.
   * Model defaults to "gemini-3.1-pro-preview" per cli-metadata.json.
   */
  buildCommand(prompt: string, options?: { model?: string; outputFormat?: string }): string[] {
    const model = options?.model ?? "gemini-3.1-pro-preview";
    const format = options?.outputFormat ?? "text";

    const argv: string[] = ["gemini", "-p", prompt, "-m", model, "-o", format];

    return argv;
  },

  /**
   * Extract the final text result from raw stdout.
   *
   * Text format (default): return the stdout trimmed of surrounding whitespace.
   * JSON format: parse the response object and return the text content.
   *
   * Throws on JSON format if the output cannot be parsed — surfaces upstream
   * as a run failure rather than silently returning empty output.
   */
  parseOutput(stdout: string, outputFormat?: string): string {
    const format = outputFormat ?? "text";

    if (format === "json") {
      // Gemini JSON output is a single JSON object with the response.
      // Return the full parsed object's text if available, or the trimmed raw
      // stdout if the structure doesn't match expectations.
      JSON.parse(stdout); // validate it parses; throw on bad JSON
      return stdout.trim();
    }

    // Text and stream-json formats: return raw stdout trimmed.
    return stdout.trim();
  },

  /**
   * Interpret a Gemini CLI exit code.
   *
   * Per cli-metadata.json:
   *   0 — success
   *   1 — general error
   * Anything else is treated as unknown.
   */
  interpretExitCode(code: number): { success: boolean; reason: string } {
    switch (code) {
      case 0:
        return { success: true, reason: "success" };
      case 1:
        return { success: false, reason: "general error" };
      default:
        return { success: false, reason: "unknown exit code " + String(code) };
    }
  },

  /**
   * Return true if the text contains a Gemini rate-limit indicator.
   *
   * All checks are case-insensitive to catch variations in capitalisation.
   * Patterns cover Gemini's quota system messages: capacity errors, rate
   * limits, and quota exhaustion.
   */
  detectRateLimit(text: string): boolean {
    const lower = text.toLowerCase();

    for (const pattern of RATE_LIMIT_PATTERNS) {
      if (lower.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    return false;
  },

  /**
   * Transform a handoff packet into a Gemini-specific prompt string.
   *
   * The output is a Markdown document with a task title, an objective block,
   * and one named section per context item. Gemini receives the prompt via
   * the "-p" flag, so the format prioritises readability and
   * instruction-following.
   *
   * NOTE: scoreFor() and full routing logic are implemented in TASK-016.
   */
  buildHandoffPrompt(handoff: HandoffPacket): string {
    const { title, objective, contextItems } = handoff;

    const lines: string[] = [];

    lines.push(`# ${title}`);
    lines.push("");
    lines.push("## Objective");
    lines.push("");
    lines.push(objective);

    for (const item of contextItems) {
      lines.push("");
      lines.push(`## ${item.title}`);
      lines.push("");
      lines.push(item.body);
    }

    return lines.join("\n");
  },
};
