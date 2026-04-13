import { describe, it, expect } from "vitest";
import { geminiAdapter } from "../gemini-adapter.js";
import type { HandoffPacket } from "../adapter-types.js";

describe("geminiAdapter.buildHandoffPrompt", () => {
  it("formats a basic handoff packet using Markdown headers", () => {
    const handoff: HandoffPacket = {
      title: "Test Task",
      objective: "Do the thing.",
      contextItems: [],
    };
    const result = geminiAdapter.buildHandoffPrompt(handoff);
    expect(result).toBe("# Test Task\n\n## Objective\n\nDo the thing.");
  });

  it("includes context items as structured Markdown text", () => {
    const handoff: HandoffPacket = {
      title: "Test Task",
      objective: "Do the thing.",
      contextItems: [{ title: "File: src/index.ts", body: "console.log('hi');" }],
    };
    const result = geminiAdapter.buildHandoffPrompt(handoff);
    expect(result).toBe(
      "# Test Task\n\n## Objective\n\nDo the thing.\n\n## Context\n\n### File: src/index.ts\n\nconsole.log('hi');",
    );
  });
});
