import type { ProviderAdapter, HandoffPacket } from "./adapter-types.js";

/**
 * GitHub (Copilot) CLI provider adapter.
 */
export const githubAdapter: ProviderAdapter = {
  provider: "github",
  executable: "copilot",
  requiredEnvVars: ["GITHUB_TOKEN"],

  /**
   * Build the argv for a GitHub Copilot task run.
   *
   * Produces: ["copilot", "explain", <prompt>] or similar.
   * Note: Copilot CLI is often used for explanation or suggestions.
   * For general task execution, we'll use a generic pattern.
   */
  buildCommand(prompt: string, _options?: { model?: string; outputFormat?: string }): string[] {
    // Basic pattern for now, as Copilot CLI is conversational
    return ["copilot", prompt];
  },

  /**
   * Extract the final text result from raw stdout.
   */
  parseOutput(stdout: string, _outputFormat?: string): string {
    return stdout.trim();
  },

  /**
   * Interpret an exit code.
   */
  interpretExitCode(code: number): { success: boolean; reason: string } {
    if (code === 0) return { success: true, reason: "success" };
    return { success: false, reason: `failed with exit code ${String(code)}` };
  },

  /**
   * Detect rate limits.
   */
  detectRateLimit(text: string): boolean {
    const lower = text.toLowerCase();
    return lower.includes("rate limit") || lower.includes("too many requests");
  },

  /**
   * Transform a handoff packet into a Github-specific prompt string.
   */
  buildHandoffPrompt(handoff: HandoffPacket): string {
    const { title, objective, contextItems } = handoff;

    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    lines.push("## Objective");
    lines.push(objective);

    if (contextItems.length > 0) {
      lines.push("");
      lines.push("## Context");
      for (const item of contextItems) {
        lines.push(`### ${item.title}`);
        lines.push(item.body);
        lines.push("");
      }
    }

    return lines.join("\n");
  },
};
