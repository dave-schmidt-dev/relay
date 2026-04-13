import { describe, it, expect } from "vitest";
import { claudeAdapter } from "../claude-adapter.js";
import type { HandoffPacket } from "../adapter-types.js";

describe("claudeAdapter.buildHandoffPrompt", () => {
  it("formats a basic handoff packet using XML-like tags", () => {
    const handoff: HandoffPacket = {
      title: "Test Task",
      objective: "Do the thing.",
      contextItems: [],
    };
    const result = claudeAdapter.buildHandoffPrompt(handoff);
    expect(result).toBe("<objective>\n# Test Task\n\nDo the thing.\n</objective>");
  });

  it("includes context items wrapped in XML tags", () => {
    const handoff: HandoffPacket = {
      title: "Test Task",
      objective: "Do the thing.",
      contextItems: [
        { title: "File: src/index.ts", body: "console.log('hi');" },
        { title: "Error Log", body: "Cannot read property of undefined" },
      ],
    };
    const result = claudeAdapter.buildHandoffPrompt(handoff);
    expect(result).toBe(
      '<objective>\n# Test Task\n\nDo the thing.\n</objective>\n\n<context>\n<context_item title="File: src/index.ts">\nconsole.log(\'hi\');\n</context_item>\n<context_item title="Error Log">\nCannot read property of undefined\n</context_item>\n</context>',
    );
  });
});
