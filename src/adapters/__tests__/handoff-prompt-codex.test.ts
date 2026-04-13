import { describe, it, expect } from "vitest";
import { codexAdapter } from "../codex-adapter.js";
import type { HandoffPacket } from "../adapter-types.js";

describe("codexAdapter.buildHandoffPrompt", () => {
  it("formats a basic handoff packet using Markdown headers", () => {
    const handoff: HandoffPacket = {
      title: "Test Task",
      objective: "Do the thing.",
      contextItems: [],
    };
    const result = codexAdapter.buildHandoffPrompt(handoff);
    expect(result).toBe("# Test Task\n\n## Objective\n\nDo the thing.");
  });

  it("includes context items wrapped in code blocks", () => {
    const handoff: HandoffPacket = {
      title: "Test Task",
      objective: "Do the thing.",
      contextItems: [{ title: "File: src/index.ts", body: "console.log('hi');" }],
    };
    const result = codexAdapter.buildHandoffPrompt(handoff);
    expect(result).toBe(
      "# Test Task\n\n## Objective\n\nDo the thing.\n\n## Context\n\n### File: src/index.ts\n\n```\nconsole.log('hi');\n```",
    );
  });
});
