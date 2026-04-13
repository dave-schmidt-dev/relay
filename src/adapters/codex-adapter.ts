import type { ProviderAdapter, HandoffPacket } from "./adapter-types.js";

/**
 * Shape of a single JSONL event line emitted by `codex exec --json`.
 *
 * Only fields relevant to output parsing are typed here; the rest are unknown.
 */
interface CodexJsonlEvent {
  type: string;
  role?: string;
  content?: string;
  exit_code?: number;
  [key: string]: unknown;
}

/**
 * Rate-limit indicator patterns sourced from fixtures/codex/cli-metadata.json.
 *
 * "data not available yet" is the exact phrase from the status-error-unavailable
 * fixture — it signals quota exhaustion, treated the same as a rate limit here.
 */
const RATE_LIMIT_PATTERNS: readonly string[] = [
  "rate limit",
  "too many requests",
  "data not available yet",
];

/**
 * Codex CLI provider adapter.
 *
 * Encapsulates all Codex-specific knowledge: CLI flags, output structure,
 * exit code meanings, and rate-limit detection patterns. The adapter is a
 * pure-logic module — it never spawns processes.
 *
 * REQ-004: Each adapter defines CLI command template, env var requirements,
 *          output parser, exit code map, rate-limit detection, and handoff
 *          prompt builder.
 * REQ-013: Adapters implement the ProviderAdapter interface.
 */
export const codexAdapter: ProviderAdapter = {
  provider: "codex",
  executable: "codex",
  requiredEnvVars: ["OPENAI_API_KEY"],

  /**
   * Build the argv for a Codex task run.
   *
   * Produces: ["codex", "exec", "--skip-git-repo-check", <prompt>]
   * with optional "-m <model>" and "--json" flags prepended to the prompt.
   *
   * --skip-git-repo-check is always included (default safe flag).
   * Output format defaults to "text"; pass "jsonl" to add --json.
   * Model defaults to "gpt-5.4" per cli-metadata.json.
   */
  buildCommand(prompt: string, options?: { model?: string; outputFormat?: string }): string[] {
    const model = options?.model ?? "gpt-5.4";
    const format = options?.outputFormat ?? "text";

    const argv: string[] = ["codex", "exec", "--skip-git-repo-check"];

    argv.push("-m", model);

    if (format === "jsonl") {
      argv.push("--json");
    }

    argv.push(prompt);

    return argv;
  },

  /**
   * Extract the final text result from raw stdout.
   *
   * Text format (default): return the stdout trimmed of surrounding whitespace.
   * JSONL format: parse one JSON object per line, find the last "assistant"
   *   message, and return its content. Throws if no assistant message is found.
   *
   * Throws on JSONL format if the output cannot be parsed or contains no
   * assistant message — surfaces upstream as a run failure rather than
   * silently returning empty output.
   */
  parseOutput(stdout: string, outputFormat?: string): string {
    const format = outputFormat ?? "text";

    if (format === "jsonl") {
      const lines = stdout.split("\n").filter((line) => line.trim().length > 0);

      const events: CodexJsonlEvent[] = lines.map((line) => JSON.parse(line) as CodexJsonlEvent);

      // Find the last assistant message (most recent wins).
      let lastAssistant: CodexJsonlEvent | undefined;
      for (const event of events) {
        if (event.type === "message" && event.role === "assistant") {
          lastAssistant = event;
        }
      }

      if (lastAssistant === undefined) {
        throw new Error("codex-adapter: JSONL output contains no assistant message");
      }

      if (typeof lastAssistant.content !== "string") {
        throw new Error("codex-adapter: assistant message has missing or non-string content");
      }

      return lastAssistant.content;
    }

    // Text format (default): return raw stdout trimmed.
    return stdout.trim();
  },

  /**
   * Interpret a Codex CLI exit code.
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
   * Return true if the text contains a Codex rate-limit indicator.
   *
   * All checks are case-insensitive to catch variations in capitalisation.
   * The "data not available yet" pattern covers the quota-exhaustion message
   * from the status-error-unavailable fixture.
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
   * Transform a handoff packet into a Codex-specific prompt string.
   *
   * The output is a Markdown document with a task title, an objective block,
   * and one named section per context item. Codex receives the prompt as a
   * positional argument, so the format prioritises readability and
   * instruction-following over provider-specific syntax.
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
