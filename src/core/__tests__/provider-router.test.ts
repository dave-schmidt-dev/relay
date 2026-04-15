/**
 * Unit tests for the usage-aware provider router.
 *
 * All snapshots are synthetic — no real probes are spawned.
 */

import { describe, it, expect } from "vitest";

import {
  routeTask,
  getEffectiveRemaining,
  DEFAULT_AFFINITY_RANKINGS,
  type AffinityRankings,
  type ProviderScore,
  type RoutingSuggestion,
} from "../provider-router.js";
import type { UsageSnapshot } from "../../prober/probe-orchestrator.js";
import type { ClaudeUsageSnapshot } from "../../prober/claude-probe.js";
import type { CodexUsageSnapshot } from "../../prober/codex-probe.js";
import type { GeminiUsageSnapshot } from "../../prober/gemini-probe.js";
import type { Provider } from "../types.js";

// ---------------------------------------------------------------------------
// Snapshot factories
// ---------------------------------------------------------------------------

function makeClaudeSnapshot(
  overrides: Partial<UsageSnapshot> & {
    sessionPercentLeft?: number | null;
    weeklyPercentLeft?: number | null;
    opusPercentLeft?: number | null;
  } = {},
): UsageSnapshot {
  const {
    sessionPercentLeft = 80,
    weeklyPercentLeft = 90,
    opusPercentLeft = null,
    ...snapshotOverrides
  } = overrides;

  const data: ClaudeUsageSnapshot = {
    sessionPercentLeft,
    weeklyPercentLeft,
    opusPercentLeft,
    primaryReset: null,
    secondaryReset: null,
    opusReset: null,
    accountEmail: null,
    accountOrganization: null,
    loginMethod: null,
    rawText: "",
  };

  return {
    provider: "claude",
    probedAt: new Date().toISOString(),
    source: "probe",
    exhausted: false,
    error: null,
    stale: false,
    staleSince: null,
    data,
    ...snapshotOverrides,
  };
}

function makeCodexSnapshot(
  overrides: Partial<UsageSnapshot> & {
    fiveHourPercentLeft?: number | null;
    weeklyPercentLeft?: number | null;
  } = {},
): UsageSnapshot {
  const { fiveHourPercentLeft = 96, weeklyPercentLeft = 85, ...snapshotOverrides } = overrides;

  const data: CodexUsageSnapshot = {
    credits: null,
    fiveHourPercentLeft,
    weeklyPercentLeft,
    fiveHourReset: null,
    weeklyReset: null,
    rawText: "",
  };

  return {
    provider: "codex",
    probedAt: new Date().toISOString(),
    source: "probe",
    exhausted: false,
    error: null,
    stale: false,
    staleSince: null,
    data,
    ...snapshotOverrides,
  };
}

function makeGeminiSnapshot(
  overrides: Partial<UsageSnapshot> & {
    flashPercentLeft?: number | null;
    proPercentLeft?: number | null;
  } = {},
): UsageSnapshot {
  const { flashPercentLeft = 70, proPercentLeft = 75, ...snapshotOverrides } = overrides;

  const data: GeminiUsageSnapshot = {
    flashPercentLeft,
    proPercentLeft,
    flashReset: null,
    proReset: null,
    accountEmail: null,
    accountTier: null,
    rawText: "",
  };

  return {
    provider: "gemini",
    probedAt: new Date().toISOString(),
    source: "probe",
    exhausted: false,
    error: null,
    stale: false,
    staleSince: null,
    data,
    ...snapshotOverrides,
  };
}

/** Build a snapshot map from a partial set of providers. */
function makeSnapshots(
  map: Partial<Record<Provider, UsageSnapshot>>,
): Map<Provider, UsageSnapshot> {
  return new Map(Object.entries(map) as [Provider, UsageSnapshot][]);
}

/**
 * Assert that a routing result is non-null and return it as a narrowed type.
 * Throws a descriptive error if null so tests fail clearly.
 */
function assertSuggestion(result: RoutingSuggestion | null): RoutingSuggestion {
  if (result === null) throw new Error("Expected a RoutingSuggestion but got null");
  return result;
}

// ---------------------------------------------------------------------------
// getEffectiveRemaining
// ---------------------------------------------------------------------------

describe("getEffectiveRemaining", () => {
  it("returns minimum of Claude quotas (session vs weekly)", () => {
    expect(
      getEffectiveRemaining(makeClaudeSnapshot({ sessionPercentLeft: 40, weeklyPercentLeft: 90 })),
    ).toBe(40);
    expect(
      getEffectiveRemaining(makeClaudeSnapshot({ sessionPercentLeft: 90, weeklyPercentLeft: 30 })),
    ).toBe(30);
  });

  it("returns minimum of Codex quotas (fiveHour vs weekly)", () => {
    expect(
      getEffectiveRemaining(makeCodexSnapshot({ fiveHourPercentLeft: 20, weeklyPercentLeft: 85 })),
    ).toBe(20);
    expect(
      getEffectiveRemaining(makeCodexSnapshot({ fiveHourPercentLeft: 90, weeklyPercentLeft: 5 })),
    ).toBe(5);
  });

  it("returns minimum of Gemini quotas (flash vs pro)", () => {
    expect(
      getEffectiveRemaining(makeGeminiSnapshot({ flashPercentLeft: 30, proPercentLeft: 75 })),
    ).toBe(30);
    expect(
      getEffectiveRemaining(makeGeminiSnapshot({ flashPercentLeft: 90, proPercentLeft: 15 })),
    ).toBe(15);
  });

  it("includes opusPercentLeft in Claude minimum calculation", () => {
    expect(
      getEffectiveRemaining(
        makeClaudeSnapshot({ sessionPercentLeft: 80, weeklyPercentLeft: 90, opusPercentLeft: 10 }),
      ),
    ).toBe(10);
  });

  it("skips null Claude quotas and uses remaining values", () => {
    expect(
      getEffectiveRemaining(
        makeClaudeSnapshot({
          sessionPercentLeft: 60,
          weeklyPercentLeft: null,
          opusPercentLeft: null,
        }),
      ),
    ).toBe(60);
  });

  it("returns 0 for exhausted, null data, and all-null quota values", () => {
    expect(
      getEffectiveRemaining(makeClaudeSnapshot({ exhausted: true, sessionPercentLeft: 80 })),
    ).toBe(0);

    const nullData: UsageSnapshot = {
      provider: "claude",
      probedAt: new Date().toISOString(),
      source: "cached",
      exhausted: false,
      error: "probe failed",
      stale: true,
      staleSince: new Date().toISOString(),
      data: null,
    };
    // Null data + error should return 0
    expect(getEffectiveRemaining(nullData)).toBe(0);

    const nullDataNoError: UsageSnapshot = {
      ...nullData,
      error: null,
    };
    // Null data + NO error should return 100 (permissive)
    expect(getEffectiveRemaining(nullDataNoError)).toBe(100);

    expect(
      getEffectiveRemaining(
        makeClaudeSnapshot({
          sessionPercentLeft: null,
          weeklyPercentLeft: null,
          opusPercentLeft: null,
        }),
      ),
    ).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_AFFINITY_RANKINGS
// ---------------------------------------------------------------------------

describe("DEFAULT_AFFINITY_RANKINGS", () => {
  it("has the correct first provider for each role", () => {
    expect(DEFAULT_AFFINITY_RANKINGS.plan[0]).toBe("claude");
    expect(DEFAULT_AFFINITY_RANKINGS.implement[0]).toBe("codex");
    expect(DEFAULT_AFFINITY_RANKINGS.review[0]).toBe("codex");
    expect(DEFAULT_AFFINITY_RANKINGS.research[0]).toBe("gemini");
    expect(DEFAULT_AFFINITY_RANKINGS.custom[0]).toBe("claude");
  });

  it("covers all three providers for every role", () => {
    const roles = Object.keys(
      DEFAULT_AFFINITY_RANKINGS,
    ) as (keyof typeof DEFAULT_AFFINITY_RANKINGS)[];
    for (const role of roles) {
      const providers = DEFAULT_AFFINITY_RANKINGS[role];
      expect(providers).toContain("claude");
      expect(providers).toContain("codex");
      expect(providers).toContain("gemini");
      expect(providers).toHaveLength(4);
    }
  });
});

// ---------------------------------------------------------------------------
// routeTask — basic routing
// ---------------------------------------------------------------------------

describe("routeTask — basic routing", () => {
  it("suggests the affinity winner for each role when all have equal usage", () => {
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ sessionPercentLeft: 80, weeklyPercentLeft: 80 }),
      codex: makeCodexSnapshot({ fiveHourPercentLeft: 80, weeklyPercentLeft: 80 }),
      gemini: makeGeminiSnapshot({ flashPercentLeft: 80, proPercentLeft: 80 }),
    });
    expect(assertSuggestion(routeTask("plan", snapshots)).suggested).toBe("claude");
    expect(assertSuggestion(routeTask("implement", snapshots)).suggested).toBe("codex");
    expect(assertSuggestion(routeTask("research", snapshots)).suggested).toBe("gemini");
  });

  it("returns a RoutingSuggestion with scores for all three providers", () => {
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot(),
      codex: makeCodexSnapshot(),
      gemini: makeGeminiSnapshot(),
    });
    const result = assertSuggestion(routeTask("plan", snapshots));
    expect(result.scores).toHaveLength(4);
    const providers = result.scores.map((s: ProviderScore) => s.provider);
    expect(providers).toContain("claude");
    expect(providers).toContain("codex");
    expect(providers).toContain("gemini");
  });

  it("includes a non-empty reason string in the suggestion", () => {
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot(),
      codex: makeCodexSnapshot(),
      gemini: makeGeminiSnapshot(),
    });
    expect(assertSuggestion(routeTask("implement", snapshots)).reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// routeTask — exhausted / excluded providers
// ---------------------------------------------------------------------------

describe("routeTask — exhausted providers", () => {
  it("switches to second choice when top choice is exhausted, and excludes 0% remaining providers", () => {
    // For 'plan': claude > codex > gemini. Claude is exhausted → codex.
    const exhaustedClaude = makeSnapshots({
      claude: makeClaudeSnapshot({ exhausted: true }),
      codex: makeCodexSnapshot({ fiveHourPercentLeft: 80, weeklyPercentLeft: 80 }),
      gemini: makeGeminiSnapshot(),
    });
    expect(assertSuggestion(routeTask("plan", exhaustedClaude)).suggested).toBe("codex");

    // Claude has 0% session remaining — should be excluded even without exhausted flag.
    const zeroClaude = makeSnapshots({
      claude: makeClaudeSnapshot({ sessionPercentLeft: 0, weeklyPercentLeft: 90 }),
      codex: makeCodexSnapshot(),
      gemini: makeGeminiSnapshot(),
    });
    expect(assertSuggestion(routeTask("plan", zeroClaude)).suggested).toBe("codex");
  });

  it("returns null when all providers are exhausted", () => {
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ exhausted: true }),
      codex: makeCodexSnapshot({ exhausted: true }),
      gemini: makeGeminiSnapshot({ exhausted: true }),
    });
    expect(routeTask("plan", snapshots)).toBeNull();
  });

  it("marks exhausted providers as ineligible in scores", () => {
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ exhausted: true }),
      codex: makeCodexSnapshot(),
      gemini: makeGeminiSnapshot(),
    });
    const result = assertSuggestion(routeTask("plan", snapshots));
    const claudeScore = result.scores.find((s: ProviderScore) => s.provider === "claude");
    expect(claudeScore?.eligible).toBe(false);
    expect(claudeScore?.combinedScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// routeTask — stale snapshots
// ---------------------------------------------------------------------------

describe("routeTask — stale snapshots", () => {
  it("excludes stale-expired providers (staleSince > 30 min ago)", () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1_000).toISOString(); // 31 minutes ago
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ stale: true, staleSince: staleTime }),
      codex: makeCodexSnapshot(),
      gemini: makeGeminiSnapshot(),
    });
    const result = assertSuggestion(routeTask("plan", snapshots));
    expect(result.suggested).not.toBe("claude");
    expect(result.suggested).toBe("codex");
  });

  it("allows stale providers within the 30-min window", () => {
    const staleTime = new Date(Date.now() - 10 * 60 * 1_000).toISOString(); // 10 minutes ago
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ stale: true, staleSince: staleTime }),
      codex: makeCodexSnapshot({ exhausted: true }),
      gemini: makeGeminiSnapshot({ exhausted: true }),
    });
    // Claude is stale but within window — should still be eligible.
    expect(assertSuggestion(routeTask("plan", snapshots)).suggested).toBe("claude");
  });

  it("returns null when all providers are stale-expired, and respects a custom staleExpirationMs threshold", () => {
    const staleTime45 = new Date(Date.now() - 45 * 60 * 1_000).toISOString(); // 45 minutes ago
    const allStale = makeSnapshots({
      claude: makeClaudeSnapshot({ stale: true, staleSince: staleTime45 }),
      codex: makeCodexSnapshot({ stale: true, staleSince: staleTime45 }),
      gemini: makeGeminiSnapshot({ stale: true, staleSince: staleTime45 }),
    });
    expect(routeTask("plan", allStale)).toBeNull();

    // Stale for 20 minutes — expired under 15-min custom threshold, OK under 30-min default.
    const staleTime20 = new Date(Date.now() - 20 * 60 * 1_000).toISOString();
    const customThresholdSnapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ stale: true, staleSince: staleTime20 }),
      codex: makeCodexSnapshot({ exhausted: true }),
      gemini: makeGeminiSnapshot({ exhausted: true }),
    });
    const tightThresholdMs = 15 * 60 * 1_000; // 15 minutes
    // Claude is expired under 15-min threshold; all others exhausted → null.
    expect(
      routeTask("plan", customThresholdSnapshots, DEFAULT_AFFINITY_RANKINGS, tightThresholdMs),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// routeTask — capacity weighting
// ---------------------------------------------------------------------------

describe("routeTask — capacity weighting", () => {
  it("ranks a low-usage top-affinity provider lower when its capacity is very small", () => {
    // For 'implement': codex(rank=1) > claude(rank=2) > gemini(rank=3).
    // combinedScore = (1/rank) * (pct/100)
    //   codex: (1/1) * 0.05 = 0.05
    //   claude: (1/2) * 0.95 = 0.475
    // → claude wins on combined score even though codex has higher affinity.
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ sessionPercentLeft: 95, weeklyPercentLeft: 95 }),
      codex: makeCodexSnapshot({ fiveHourPercentLeft: 5, weeklyPercentLeft: 5 }),
      gemini: makeGeminiSnapshot({ exhausted: true }),
    });
    expect(assertSuggestion(routeTask("implement", snapshots)).suggested).toBe("claude");
  });

  it("prefers the higher-affinity provider when both have ample capacity", () => {
    // codex rank=1 with 80%; claude rank=2 with 90%.
    // codex: (1/1) * 0.80 = 0.80
    // claude: (1/2) * 0.90 = 0.45
    // → codex wins because its affinity advantage outweighs claude's capacity edge.
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ sessionPercentLeft: 90, weeklyPercentLeft: 90 }),
      codex: makeCodexSnapshot({ fiveHourPercentLeft: 80, weeklyPercentLeft: 80 }),
      gemini: makeGeminiSnapshot({ exhausted: true }),
    });
    expect(assertSuggestion(routeTask("implement", snapshots)).suggested).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// routeTask — custom affinity rankings
// ---------------------------------------------------------------------------

describe("routeTask — custom affinity rankings", () => {
  it("uses custom rankings when supplied, overriding the defaults", () => {
    // Flip the default: for 'plan', put gemini first.
    const customRankings: AffinityRankings = {
      ...DEFAULT_AFFINITY_RANKINGS,
      plan: ["gemini", "claude", "codex"],
    };
    const snapshots = makeSnapshots({
      claude: makeClaudeSnapshot({ sessionPercentLeft: 80, weeklyPercentLeft: 80 }),
      codex: makeCodexSnapshot({ fiveHourPercentLeft: 80, weeklyPercentLeft: 80 }),
      gemini: makeGeminiSnapshot({ flashPercentLeft: 80, proPercentLeft: 80 }),
    });
    expect(assertSuggestion(routeTask("plan", snapshots, customRankings)).suggested).toBe("gemini");
  });
});

// ---------------------------------------------------------------------------
// routeTask — missing snapshots
// ---------------------------------------------------------------------------

describe("routeTask — missing snapshots", () => {
  it("returns null when no snapshots are provided, and routes to an available provider when some are missing", () => {
    expect(routeTask("plan", new Map())).toBeNull();

    // Only codex snapshot provided; for 'plan' affinity is claude(1) > codex(2).
    // claude snapshot is missing, so codex should win.
    const codexOnly = makeSnapshots({
      codex: makeCodexSnapshot({ fiveHourPercentLeft: 75, weeklyPercentLeft: 75 }),
    });
    expect(assertSuggestion(routeTask("plan", codexOnly)).suggested).toBe("codex");
  });

  it("marks providers with missing snapshots as ineligible in scores", () => {
    const snapshots = makeSnapshots({
      codex: makeCodexSnapshot(),
    });
    const result = assertSuggestion(routeTask("plan", snapshots));
    const claudeScore = result.scores.find((s: ProviderScore) => s.provider === "claude");
    const geminiScore = result.scores.find((s: ProviderScore) => s.provider === "gemini");
    expect(claudeScore?.eligible).toBe(false);
    expect(geminiScore?.eligible).toBe(false);
  });
});
