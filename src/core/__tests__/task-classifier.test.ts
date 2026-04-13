import { describe, it, expect } from "vitest";
import {
  classifyTask,
  DEFAULT_RULES,
  type ClassificationResult,
  type ClassificationRule,
} from "../task-classifier.js";

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe("module exports", () => {
  it("exports DEFAULT_RULES as a non-empty readonly array", () => {
    expect(Array.isArray(DEFAULT_RULES)).toBe(true);
    expect(DEFAULT_RULES.length).toBeGreaterThan(0);
  });

  it("exports classifyTask as a function", () => {
    expect(typeof classifyTask).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Obvious single-role prompts
// ---------------------------------------------------------------------------

describe("classifyTask — plan prompts", () => {
  it("classifies a clear planning prompt as 'plan'", () => {
    const result = classifyTask("Create a plan for migrating our database to Postgres.");
    expect(result.role).toBe("plan");
  });

  it("classifies 'design the architecture' as 'plan'", () => {
    const result = classifyTask("Design the architecture for the new payments service.");
    expect(result.role).toBe("plan");
  });

  it("returns high confidence for an obvious plan prompt", () => {
    const result = classifyTask("What's the best approach to architect the new API?");
    expect(result.role).toBe("plan");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyTask — implement prompts", () => {
  it("classifies 'write a function' prompt as 'implement'", () => {
    const result = classifyTask("Write a function that parses ISO 8601 timestamps.");
    expect(result.role).toBe("implement");
  });

  it("classifies 'fix the bug' prompt as 'implement'", () => {
    const result = classifyTask("Fix the bug in the payment handler that causes double charges.");
    expect(result.role).toBe("implement");
  });

  it("classifies 'implement the retry logic' as 'implement'", () => {
    const result = classifyTask("Implement the retry logic for failed API calls.");
    expect(result.role).toBe("implement");
  });

  it("returns high confidence for an obvious implement prompt", () => {
    const result = classifyTask("Write a function to validate email addresses.");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyTask — review prompts", () => {
  it("classifies 'review this code' as 'review'", () => {
    const result = classifyTask("Review this code and tell me if there are any issues.");
    expect(result.role).toBe("review");
  });

  it("classifies 'code review' prompt as 'review'", () => {
    const result = classifyTask("Please do a code review of the authentication module.");
    expect(result.role).toBe("review");
  });

  it("classifies 'what do you think' prompt as 'review'", () => {
    const result = classifyTask("What do you think about this implementation?");
    expect(result.role).toBe("review");
  });

  it("returns high confidence for an obvious review prompt", () => {
    // "review this" pattern matches → 2 pts; "audit" + "evaluate" keywords → 2 pts more.
    const result = classifyTask("Review this PR and evaluate and audit the changes carefully.");
    expect(result.role).toBe("review");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyTask — research prompts", () => {
  it("classifies 'what is X' as 'research'", () => {
    const result = classifyTask("What is the difference between TCP and UDP?");
    expect(result.role).toBe("research");
  });

  it("classifies 'how does X work' as 'research'", () => {
    const result = classifyTask("How does connection pooling work in PostgreSQL?");
    expect(result.role).toBe("research");
  });

  it("classifies 'compare X and Y' as 'research'", () => {
    const result = classifyTask("Compare React and Vue and help me choose one.");
    expect(result.role).toBe("research");
  });

  it("classifies 'explain X' as 'research'", () => {
    const result = classifyTask("Explain how TLS handshakes work.");
    expect(result.role).toBe("research");
  });

  it("returns high confidence for an obvious research prompt", () => {
    // Multiple research signals: pattern "compare .+ and", keywords "summarize", "compare".
    const result = classifyTask(
      "Summarize and compare REST and GraphQL so I can explain the trade-offs.",
    );
    expect(result.role).toBe("research");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Custom / unrecognizable prompts
// ---------------------------------------------------------------------------

describe("classifyTask — custom / unrecognizable prompts", () => {
  it("returns 'custom' with confidence 0.0 for an unrecognizable prompt", () => {
    const result = classifyTask("Zorbax flibbertigibbet wumple.");
    expect(result.role).toBe("custom");
    expect(result.confidence).toBe(0.0);
  });

  it("handles empty string", () => {
    const result = classifyTask("");
    expect(result.role).toBe("custom");
    expect(result.confidence).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// Custom rules override defaults
// ---------------------------------------------------------------------------

describe("classifyTask — custom rules override defaults", () => {
  it("uses custom rules when supplied", () => {
    const customRules: readonly ClassificationRule[] = [
      {
        role: "custom",
        keywords: ["zorbax", "flibbertigibbet"],
        patterns: [],
        weight: 1.0,
      },
    ];
    const result = classifyTask("Zorbax flibbertigibbet wumple.", customRules);
    expect(result.role).toBe("custom");
    expect(result.confidence).toBeGreaterThan(0.0);
  });

  it("ignores default rules entirely when custom rules are supplied", () => {
    const implementOnlyRules: readonly ClassificationRule[] = [
      {
        role: "implement",
        keywords: ["build"],
        patterns: [],
        weight: 1.0,
      },
    ];
    // "plan" keywords are not in the custom ruleset — only "build" is.
    const result = classifyTask("Design a plan and build the feature.", implementOnlyRules);
    // Only 'implement' rule exists; "build" matches → implement wins.
    expect(result.role).toBe("implement");
  });

  it("respects role weight when custom weight is higher", () => {
    const weightedRules: readonly ClassificationRule[] = [
      {
        role: "plan",
        keywords: ["design"],
        patterns: [],
        weight: 1.0,
      },
      {
        role: "implement",
        keywords: ["design"],
        patterns: [],
        weight: 5.0,
      },
    ];
    // Both rules match on "design" but 'implement' has 5× weight.
    const result = classifyTask("design the feature", weightedRules);
    expect(result.role).toBe("implement");
  });
});

// ---------------------------------------------------------------------------
// Ambiguous prompts — confidence should be lower
// ---------------------------------------------------------------------------

describe("classifyTask — ambiguous prompts", () => {
  it("has lower confidence when the prompt mixes keywords from multiple roles", () => {
    // "plan" + "implement" keywords together.
    const mixed = classifyTask("Design the plan and then implement it by writing the code.");
    const pure = classifyTask("Write a function that parses timestamps.");
    // Mixed prompt confidence should be lower than a pure implement prompt.
    expect(mixed.confidence).toBeLessThan(pure.confidence);
  });
});

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe("classifyTask — return shape", () => {
  it("always returns a role and a numeric confidence in [0, 1]", () => {
    const prompts = [
      "Plan the migration",
      "Write a function",
      "Review this PR",
      "What is Redis?",
      "",
      "Something completely unrelated and weird",
    ];
    for (const p of prompts) {
      const result: ClassificationResult = classifyTask(p);
      expect(typeof result.role).toBe("string");
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Latency gate
// ---------------------------------------------------------------------------

describe("classifyTask — performance", () => {
  it("classifies a prompt in under 10ms", () => {
    const prompt =
      "Please create a detailed plan for implementing the new authentication service " +
      "using OAuth2 and review the existing code before we start writing anything.";
    const start = performance.now();
    classifyTask(prompt);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it("handles a very long prompt under 10ms", () => {
    // ~5 000-character prompt to stress-test the keyword loop.
    const prompt = (
      "Plan, design, architect, implement, build, create, write, add, code, " +
      "develop, fix, bug, review, audit, check, inspect, evaluate, assess, " +
      "research, find, search, investigate, compare, explore, summarize, explain. "
    ).repeat(40);
    const start = performance.now();
    classifyTask(prompt);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });
});
