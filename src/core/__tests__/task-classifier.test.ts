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
  it("exports DEFAULT_RULES as a non-empty readonly array and classifyTask as a function", () => {
    expect(Array.isArray(DEFAULT_RULES)).toBe(true);
    expect(DEFAULT_RULES.length).toBeGreaterThan(0);
    expect(typeof classifyTask).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Obvious single-role prompts
// ---------------------------------------------------------------------------

describe("classifyTask — plan prompts", () => {
  it("classifies all plan prompts as 'plan' with high confidence for obvious ones", () => {
    expect(classifyTask("Create a plan for migrating our database to Postgres.").role).toBe("plan");
    expect(classifyTask("Design the architecture for the new payments service.").role).toBe("plan");

    const obvious = classifyTask("What's the best approach to architect the new API?");
    expect(obvious.role).toBe("plan");
    expect(obvious.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyTask — implement prompts", () => {
  it("classifies all implement prompts as 'implement' with high confidence for obvious ones", () => {
    expect(classifyTask("Write a function that parses ISO 8601 timestamps.").role).toBe(
      "implement",
    );
    expect(
      classifyTask("Fix the bug in the payment handler that causes double charges.").role,
    ).toBe("implement");
    expect(classifyTask("Implement the retry logic for failed API calls.").role).toBe("implement");

    const obvious = classifyTask("Write a function to validate email addresses.");
    expect(obvious.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyTask — review prompts", () => {
  it("classifies all review prompts as 'review' with high confidence for obvious ones", () => {
    expect(classifyTask("Review this code and tell me if there are any issues.").role).toBe(
      "review",
    );
    expect(classifyTask("Please do a code review of the authentication module.").role).toBe(
      "review",
    );
    expect(classifyTask("What do you think about this implementation?").role).toBe("review");

    // "review this" pattern matches → 2 pts; "audit" + "evaluate" keywords → 2 pts more.
    const obvious = classifyTask("Review this PR and evaluate and audit the changes carefully.");
    expect(obvious.role).toBe("review");
    expect(obvious.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyTask — research prompts", () => {
  it("classifies all research prompts as 'research' with high confidence for obvious ones", () => {
    expect(classifyTask("What is the difference between TCP and UDP?").role).toBe("research");
    expect(classifyTask("How does connection pooling work in PostgreSQL?").role).toBe("research");
    expect(classifyTask("Compare React and Vue and help me choose one.").role).toBe("research");
    expect(classifyTask("Explain how TLS handshakes work.").role).toBe("research");

    // Multiple research signals: pattern "compare .+ and", keywords "summarize", "compare".
    const obvious = classifyTask(
      "Summarize and compare REST and GraphQL so I can explain the trade-offs.",
    );
    expect(obvious.role).toBe("research");
    expect(obvious.confidence).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Custom / unrecognizable prompts
// ---------------------------------------------------------------------------

describe("classifyTask — custom / unrecognizable prompts", () => {
  it("returns 'custom' with confidence 0.0 for unrecognizable prompts and empty string", () => {
    const gibberish = classifyTask("Zorbax flibbertigibbet wumple.");
    expect(gibberish.role).toBe("custom");
    expect(gibberish.confidence).toBe(0.0);

    const empty = classifyTask("");
    expect(empty.role).toBe("custom");
    expect(empty.confidence).toBe(0.0);
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

  it("respects role weight when custom weight is higher", () => {
    const implementOnlyRules: readonly ClassificationRule[] = [
      {
        role: "implement",
        keywords: ["build"],
        patterns: [],
        weight: 1.0,
      },
    ];
    // "plan" keywords are not in the custom ruleset — only "build" is.
    const noDefaultPlan = classifyTask("Design a plan and build the feature.", implementOnlyRules);
    // Only 'implement' rule exists; "build" matches → implement wins.
    expect(noDefaultPlan.role).toBe("implement");

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
    const weighted = classifyTask("design the feature", weightedRules);
    expect(weighted.role).toBe("implement");
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
  it("classifies both a normal and very long prompt in under 10ms each", () => {
    const normalPrompt =
      "Please create a detailed plan for implementing the new authentication service " +
      "using OAuth2 and review the existing code before we start writing anything.";
    const start1 = performance.now();
    classifyTask(normalPrompt);
    expect(performance.now() - start1).toBeLessThan(10);

    // ~5 000-character prompt to stress-test the keyword loop.
    const longPrompt = (
      "Plan, design, architect, implement, build, create, write, add, code, " +
      "develop, fix, bug, review, audit, check, inspect, evaluate, assess, " +
      "research, find, search, investigate, compare, explore, summarize, explain. "
    ).repeat(40);
    const start2 = performance.now();
    classifyTask(longPrompt);
    expect(performance.now() - start2).toBeLessThan(10);
  });
});
