import type { Provider } from "../core/types.js";

/**
 * A context item included in a handoff prompt — title + body text.
 */
export interface HandoffContextItem {
  title: string;
  body: string;
}

/**
 * Structured input for buildHandoffPrompt.
 *
 * Carries enough information to produce a self-contained prompt for any
 * provider: the task title, the objective, and a list of named context blocks.
 */
export interface HandoffPacket {
  title: string;
  objective: string;
  contextItems: readonly HandoffContextItem[];
}

/**
 * Common interface implemented by every provider adapter.
 *
 * An adapter is a pure-logic module — it defines *how* to interact with a
 * specific AI CLI, but never spawns processes itself. Lifecycle management
 * (spawning, signaling, logging) is handled by the subprocess runner and run
 * manager; the adapter only supplies the configuration and parsing rules.
 */
export interface ProviderAdapter {
  /** Which provider this adapter represents. */
  readonly provider: Provider;

  /** Name of the CLI executable (e.g. "claude", "codex", "gemini"). */
  readonly executable: string;

  /**
   * Environment variable names the provider CLI requires to function.
   * The subprocess runner will include these in its env allowlist.
   */
  readonly requiredEnvVars: readonly string[];

  /**
   * Build the full argv for a task run.
   *
   * The returned array begins with the executable name so it can be passed
   * directly to SubprocessOptions.command.
   *
   * @param prompt - The prompt text to pass to the provider.
   * @param options - Optional overrides (model, output format).
   */
  buildCommand(prompt: string, options?: { model?: string; outputFormat?: string }): string[];

  /**
   * Extract the final text result from raw stdout.
   *
   * @param stdout - The full raw stdout string captured from the CLI.
   * @param outputFormat - The format requested when buildCommand was called.
   *   Defaults to the provider's standard format if omitted.
   */
  parseOutput(stdout: string, outputFormat?: string): string;

  /**
   * Interpret an OS exit code into a human-readable result.
   *
   * @param code - The exit code returned by the provider process.
   */
  interpretExitCode(code: number): { success: boolean; reason: string };

  /**
   * Return true if the given text contains a rate-limit indicator.
   *
   * Both stdout and stderr should be checked — call this once per stream
   * and OR the results.
   *
   * @param text - Raw stdout or stderr text to inspect.
   */
  detectRateLimit(text: string): boolean;

  /**
   * Transform a handoff packet into a provider-specific prompt string.
   *
   * The resulting string is written to a prompt file and passed to
   * buildCommand().
   *
   * @param handoff - Structured handoff information.
   */
  buildHandoffPrompt(handoff: HandoffPacket): string;
}
