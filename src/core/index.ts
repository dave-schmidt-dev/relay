export { initProjectStorage, initGlobalStorage, loadConfig, DEFAULT_CONFIG } from "./storage.js";
export type { RelayConfig } from "./storage.js";

export {
  persistNewRun,
  updateRunMetadata,
  appendEvent,
  appendStdout,
  appendStderr,
  writeFinalOutput,
  loadRun,
  listRunIds,
} from "./run-persistence.js";

export { createRun, transitionRun, createEventFactory, createAction } from "./run-lifecycle.js";
export type { CreateRunParams, TransitionDetails } from "./run-lifecycle.js";

export {
  redact,
  isBlockedAttachment,
  validateAttachmentPath,
  REDACTION_PATTERNS,
  BLOCKED_FILE_PATTERNS,
} from "./redaction.js";

export type {
  Provider,
  TaskRole,
  RunStatus,
  EventKind,
  ActionKind,
  Run,
  Event,
  OperatorAction,
} from "./types.js";

export { classifyTask, DEFAULT_RULES } from "./task-classifier.js";
export type { ClassificationResult, ClassificationRule } from "./task-classifier.js";

export { cancelProcess } from "./cancellation.js";
export type { CancelOptions } from "./cancellation.js";

export { cleanupOrphans } from "./orphan-cleanup.js";

export { routeTask, getEffectiveRemaining, DEFAULT_AFFINITY_RANKINGS } from "./provider-router.js";
export type { ProviderScore, RoutingSuggestion, AffinityRankings } from "./provider-router.js";
