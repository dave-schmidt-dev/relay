/**
 * Usage-aware provider router.
 *
 * Scores and ranks providers for a given task role based on:
 *  - Affinity rankings per task type (configurable, with sane defaults)
 *  - Remaining quota extracted from the latest usage snapshots
 *  - Staleness: snapshots older than staleExpirationMs are excluded
 *  - Exhausted providers (0% remaining or flagged exhausted) are excluded
 *
 * REQ-002: Default affinity rankings, capacity weighting, stale expiration,
 *           suggested provider with one-line reason, operator override support.
 */

import type { Provider, TaskRole } from "./types.js";
import type { UsageSnapshot } from "../prober/probe-orchestrator.js";
import type { ClaudeUsageSnapshot } from "../prober/claude-probe.js";
import type { CodexUsageSnapshot } from "../prober/codex-probe.js";
import type { GeminiUsageSnapshot } from "../prober/gemini-probe.js";
import type { GithubUsageSnapshot } from "../prober/github-probe.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProviderScore {
  provider: Provider;
  eligible: boolean;
  effectiveRemaining: number; // 0–100
  affinityRank: number; // 1 = best affinity, 2 = second, 3 = third
  combinedScore: number; // (1 / affinityRank) * capacityWeight; higher is better
  reason: string;
}

export interface RoutingSuggestion {
  suggested: Provider;
  reason: string;
  scores: ProviderScore[];
}

/** Maps each task role to an ordered list of providers (most preferred first). */
export type AffinityRankings = Record<TaskRole, Provider[]>;

// ---------------------------------------------------------------------------
// Default affinity rankings (REQ-002)
// ---------------------------------------------------------------------------

export const DEFAULT_AFFINITY_RANKINGS: AffinityRankings = {
  plan: ["claude", "codex", "gemini", "github"],
  implement: ["codex", "claude", "gemini", "github"],
  review: ["codex", "claude", "gemini", "github"],
  research: ["gemini", "claude", "codex", "github"],
  custom: ["claude", "codex", "gemini", "github"],
};

/** Default stale expiration window: 30 minutes in milliseconds. */
const DEFAULT_STALE_EXPIRATION_MS = 30 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Effective remaining extraction
// ---------------------------------------------------------------------------

/**
 * Extract the effective remaining percentage from a usage snapshot.
 *
 * Uses the most constraining quota (minimum across all non-null values).
 * Returns 0 if no quota values are present, or if the snapshot is exhausted.
 *
 * Per-provider logic:
 *  - Claude: min(sessionPercentLeft, weeklyPercentLeft, opusPercentLeft) — skip nulls
 *  - Codex:  min(fiveHourPercentLeft, weeklyPercentLeft) — skip nulls
 *  - Gemini: min(flashPercentLeft, proPercentLeft) — skip nulls
 */
export function getEffectiveRemaining(snapshot: UsageSnapshot): number {
  // Exhausted flag takes priority.
  if (snapshot.exhausted) return 0;

  if (snapshot.data === null) {
    // If we have no data yet but the snapshot isn't an error, assume 100%
    return snapshot.error ? 0 : 100;
  }

  const values: number[] = [];

  switch (snapshot.provider) {
    case "claude": {
      const d = snapshot.data as ClaudeUsageSnapshot;
      if (d.sessionPercentLeft !== null) values.push(d.sessionPercentLeft);
      if (d.weeklyPercentLeft !== null) values.push(d.weeklyPercentLeft);
      if (d.opusPercentLeft !== null) values.push(d.opusPercentLeft);
      break;
    }
    case "codex": {
      const d = snapshot.data as CodexUsageSnapshot;
      if (d.fiveHourPercentLeft !== null) values.push(d.fiveHourPercentLeft);
      if (d.weeklyPercentLeft !== null) values.push(d.weeklyPercentLeft);
      break;
    }
    case "gemini": {
      const d = snapshot.data as GeminiUsageSnapshot;
      if (d.flashPercentLeft !== null) values.push(d.flashPercentLeft);
      if (d.proPercentLeft !== null) values.push(d.proPercentLeft);
      break;
    }
    case "github": {
      const d = snapshot.data as unknown as GithubUsageSnapshot;
      if (d.premiumPercentLeft !== null) values.push(d.premiumPercentLeft);
      break;
    }
  }

  if (values.length === 0) {
    // If we have a valid snapshot with data but no specific quota fields found,
    // assume 100% to allow launch attempts (especially useful in dev/mock envs).
    return 100;
  }

  // NOTE: Math.min spread is safe; the array is always small (≤3 elements).
  return Math.min(...values);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Score and rank all providers for the given task role, then return a routing
 * suggestion identifying the best available provider.
 *
 * Returns null when no provider is eligible (all exhausted, stale-expired, or
 * missing snapshots).
 *
 * @param taskRole          - Role the task is fulfilling.
 * @param snapshots         - Latest usage snapshots keyed by provider.
 * @param rankings          - Affinity rankings to use (defaults to DEFAULT_AFFINITY_RANKINGS).
 * @param staleExpirationMs - Window after which a stale snapshot disqualifies a provider
 *                            (defaults to 30 min).
 */
export function routeTask(
  taskRole: TaskRole,
  snapshots: Map<Provider, UsageSnapshot>,
  rankings: AffinityRankings = DEFAULT_AFFINITY_RANKINGS,
  staleExpirationMs: number = DEFAULT_STALE_EXPIRATION_MS,
): RoutingSuggestion | null {
  const orderedProviders = rankings[taskRole];
  const now = Date.now();

  const scores: ProviderScore[] = orderedProviders.map((provider, index) => {
    const affinityRank = index + 1; // 1-indexed
    const snapshot = snapshots.get(provider);

    // -----------------------------------------------------------------------
    // No snapshot available → ineligible
    // -----------------------------------------------------------------------
    if (snapshot === undefined) {
      return {
        provider,
        eligible: false,
        effectiveRemaining: 0,
        affinityRank,
        combinedScore: 0,
        reason: `${provider}: no usage data available`,
      };
    }

    // -----------------------------------------------------------------------
    // Stale expiration check
    // -----------------------------------------------------------------------
    if (snapshot.stale && snapshot.staleSince !== null) {
      const staleAgeMs = now - new Date(snapshot.staleSince).getTime();
      if (staleAgeMs >= staleExpirationMs) {
        return {
          provider,
          eligible: false,
          effectiveRemaining: 0,
          affinityRank,
          combinedScore: 0,
          reason: `${provider}: usage data is stale (expired after ${String(Math.round(staleAgeMs / 60_000))} min)`,
        };
      }
    }

    // -----------------------------------------------------------------------
    // Exhausted check
    // -----------------------------------------------------------------------
    if (snapshot.exhausted) {
      return {
        provider,
        eligible: false,
        effectiveRemaining: 0,
        affinityRank,
        combinedScore: 0,
        reason: `${provider}: quota exhausted`,
      };
    }

    // -----------------------------------------------------------------------
    // Compute effective remaining and combined score
    // -----------------------------------------------------------------------
    const effectiveRemaining = getEffectiveRemaining(snapshot);

    if (effectiveRemaining === 0) {
      return {
        provider,
        eligible: false,
        effectiveRemaining: 0,
        affinityRank,
        combinedScore: 0,
        reason: `${provider}: 0% remaining`,
      };
    }

    // capacityWeight: linear 0%→0, 100%→1
    const capacityWeight = effectiveRemaining / 100;
    // combinedScore: higher affinity rank (lower number) = higher weight
    const combinedScore = (1 / affinityRank) * capacityWeight;

    const roleLabel = roleDisplayName(taskRole);
    const reason = `${provider} suggested — ${String(effectiveRemaining)}% remaining, ${roleLabel}`;

    return {
      provider,
      eligible: true,
      effectiveRemaining,
      affinityRank,
      combinedScore,
      reason,
    };
  });

  // Sort eligible providers by combinedScore descending.
  const eligible = scores
    .filter((s) => s.eligible)
    .sort((a, b) => b.combinedScore - a.combinedScore);

  // Destructure to extract the top candidate without using a non-null assertion.
  // The rest spread satisfies the linter while keeping noUncheckedIndexedAccess happy.
  const [best, ...rest] = eligible;
  void rest;

  if (best === undefined) return null;

  return {
    suggested: best.provider,
    reason: best.reason,
    scores,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Human-readable label for a task role used in the routing reason string. */
function roleDisplayName(role: TaskRole): string {
  switch (role) {
    case "plan":
      return "best for planning tasks";
    case "implement":
      return "best for implementation tasks";
    case "review":
      return "best for review tasks";
    case "research":
      return "best for research tasks";
    case "custom":
      return "best for custom tasks";
  }
}
