// Provider adapters: Claude, Codex, Gemini.
// Each adapter defines CLI command template, output parsing, usage probe config,
// capability flags, exit code interpretation, and buildHandoffPrompt().

export type { DiscoveredProvider } from "./discovery.js";
export { discoverProviders, findExecutable } from "./discovery.js";

export type { ProviderAdapter, HandoffPacket, HandoffContextItem } from "./adapter-types.js";
export { claudeAdapter } from "./claude-adapter.js";
export { codexAdapter } from "./codex-adapter.js";
export { geminiAdapter } from "./gemini-adapter.js";
export { githubAdapter } from "./github-adapter.js";
