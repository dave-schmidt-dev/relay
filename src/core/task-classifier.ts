/**
 * Local heuristic task classifier.
 *
 * Classifies a free-text prompt into one of the five task roles without any
 * API calls. Rules live in a single exported constant so operators can swap
 * them out or extend them at runtime.
 *
 * Scoring algorithm:
 *   score(role) = (keyword_matches * 1.0 + pattern_matches * 2.0) * role.weight
 *   confidence  = top_score / (top_score + second_score + 1)
 *
 * If no role accumulates any score the result is { role: "custom", confidence: 0.0 }.
 */

import type { TaskRole } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  role: TaskRole;
  /** Normalised confidence in [0.0, 1.0]. */
  confidence: number;
}

export interface ClassificationRule {
  role: TaskRole;
  /** Individual words (lowercased comparison) that suggest this role. */
  keywords: string[];
  /** Regex patterns that suggest this role (applied to the lowercased prompt). */
  patterns: RegExp[];
  /** Base weight — multiply raw score by this value before ranking. */
  weight: number;
}

// ---------------------------------------------------------------------------
// Default rules (operator-editable)
// ---------------------------------------------------------------------------

export const DEFAULT_RULES: readonly ClassificationRule[] = [
  {
    role: "plan",
    keywords: ["plan", "design", "architect", "strategy", "outline", "propose", "approach"],
    patterns: [/create a plan/i, /how should we/i, /what's the best approach/i],
    weight: 1.0,
  },
  {
    role: "implement",
    keywords: ["implement", "build", "create", "write", "add", "code", "develop", "fix", "bug"],
    patterns: [/write a function/i, /add a feature/i, /implement the/i, /fix the/i],
    weight: 1.0,
  },
  {
    role: "review",
    keywords: ["review", "audit", "check", "inspect", "evaluate", "assess", "analyze code"],
    patterns: [/review this/i, /code review/i, /look at this/i, /what do you think/i],
    weight: 1.0,
  },
  {
    role: "research",
    keywords: [
      "research",
      "find",
      "search",
      "look up",
      "investigate",
      "compare",
      "explore",
      "summarize",
      "explain",
    ],
    patterns: [/what is/i, /how does/i, /compare .+ and/i, /explain .+/i],
    weight: 1.0,
  },
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a prompt into a task role with a confidence score.
 *
 * @param prompt - The raw operator prompt string to classify.
 * @param rules  - Optional override for the default rule set.
 * @returns A {@link ClassificationResult} with the best-matching role and
 *          a normalised confidence value between 0.0 and 1.0.
 */
export function classifyTask(
  prompt: string,
  rules: readonly ClassificationRule[] = DEFAULT_RULES,
): ClassificationResult {
  if (prompt.length === 0) {
    return { role: "custom", confidence: 0.0 };
  }

  const lower = prompt.toLowerCase();

  // Compute a raw score for each rule.
  const scores: { role: TaskRole; score: number }[] = rules.map((rule) => {
    let keywordMatches = 0;
    const wordChar = /[a-z0-9_]/;
    for (const kw of rule.keywords) {
      // Count non-overlapping occurrences of each keyword as a whole token.
      // charAt() returns "" (empty string) when the index is out of bounds,
      // which is treated as a non-word character — safe without null assertions.
      let idx = lower.indexOf(kw, 0);
      while (idx !== -1) {
        // Verify word-boundary-like context: the character before and after the
        // match must not be a word character [a-z0-9_].
        // NOTE: multi-word keywords (e.g. "analyze code", "look up") are matched
        // as substrings — the boundary check only applies at the outer edges.
        const before = lower.charAt(idx - 1);
        const after = lower.charAt(idx + kw.length);
        if (!wordChar.test(before) && !wordChar.test(after)) {
          keywordMatches++;
        }
        idx = lower.indexOf(kw, idx + kw.length);
      }
    }

    let patternMatches = 0;
    for (const re of rule.patterns) {
      if (re.test(lower)) {
        patternMatches++;
      }
    }

    const raw = keywordMatches * 1.0 + patternMatches * 2.0;
    return { role: rule.role, score: raw * rule.weight };
  });

  // Sort descending by score.
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];

  // No role matched at all.
  if (top === undefined || top.score === 0) {
    return { role: "custom", confidence: 0.0 };
  }

  const topScore = top.score;
  const secondScore = second?.score ?? 0;

  // Normalise: dividing by (top + second + 1) keeps confidence < 1.0 and
  // avoids division-by-zero when both scores are 0 (handled above).
  const confidence = topScore / (topScore + secondScore + 1);

  return { role: top.role, confidence };
}
