import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AffinityRankings, DEFAULT_AFFINITY_RANKINGS } from "./provider-router.js";

/**
 * Configuration options for the Relay project.
 */
export interface RelayConfig {
  probeInterval: number;
  maxConcurrentRuns: number;
  defaultPort: number;
  envAllowlist: string[];
  affinityRankings: AffinityRankings;
  classificationConfidenceThreshold: number;
  debugMode: boolean;
}

/**
 * Default configuration values for Relay.
 */
export const DEFAULT_CONFIG: RelayConfig = {
  probeInterval: 120,
  maxConcurrentRuns: 3,
  defaultPort: 3000,
  envAllowlist: [],
  affinityRankings: DEFAULT_AFFINITY_RANKINGS,
  classificationConfidenceThreshold: 0.6,
  debugMode: false,
};

/**
 * Initializes the project-level .relay/ storage directory.
 * Creates the directory tree and a default config.json if they do not exist.
 * Merges missing keys from defaults if a partial config exists.
 *
 * @param projectRoot The absolute path to the project root directory.
 * @returns A promise resolving to the config path and the loaded config.
 */
export async function initProjectStorage(
  projectRoot: string,
): Promise<{ configPath: string; config: RelayConfig }> {
  const relayDir = path.join(projectRoot, ".relay");
  const dirs = ["runs", "handoffs", "exports", "debug"];

  await fs.mkdir(relayDir, { recursive: true });
  for (const dir of dirs) {
    await fs.mkdir(path.join(relayDir, dir), { recursive: true });
  }

  const actionsPath = path.join(relayDir, "actions.jsonl");
  try {
    await fs.access(actionsPath);
  } catch {
    await fs.writeFile(actionsPath, "");
  }

  const configPath = path.join(relayDir, "config.json");
  let config: RelayConfig = { ...DEFAULT_CONFIG };

  try {
    const existingConfigData = await fs.readFile(configPath, "utf-8");
    const existingConfig = JSON.parse(existingConfigData) as Partial<RelayConfig>;
    config = { ...DEFAULT_CONFIG, ...existingConfig };

    // Write back merged config to ensure all default keys are present
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    } else if (err instanceof Error) {
      throw new Error(`Failed to initialize config: ${err.message}`);
    } else {
      throw new Error("Failed to initialize config: unknown error");
    }
  }

  return { configPath, config };
}

/**
 * Initializes the global ~/.relay/usage/ directory for usage tracking.
 * Creates the directory and an empty history.jsonl if they do not exist.
 *
 * @param homeOverride Optional home directory override (for testing).
 */
export async function initGlobalStorage(homeOverride?: string): Promise<void> {
  const homeDir = homeOverride ?? os.homedir();
  const globalRelayDir = path.join(homeDir, ".relay");
  const usageDir = path.join(globalRelayDir, "usage");

  await fs.mkdir(usageDir, { recursive: true });

  const historyPath = path.join(usageDir, "history.jsonl");
  try {
    await fs.access(historyPath);
  } catch {
    await fs.writeFile(historyPath, "");
  }
}

/**
 * Loads and validates the Relay configuration from the project's .relay/config.json.
 *
 * @param projectRoot The absolute path to the project root directory.
 * @returns A promise resolving to the validated RelayConfig.
 * @throws If the config file does not exist or contains invalid types.
 */
export async function loadConfig(projectRoot: string): Promise<RelayConfig> {
  const configPath = path.join(projectRoot, ".relay", "config.json");
  try {
    const data = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(data) as Record<string, unknown>;
    const merged = { ...DEFAULT_CONFIG, ...config };

    if (typeof merged.probeInterval !== "number") {
      throw new Error("Invalid config: probeInterval must be a number");
    }
    if (typeof merged.maxConcurrentRuns !== "number") {
      throw new Error("Invalid config: maxConcurrentRuns must be a number");
    }
    if (typeof merged.defaultPort !== "number") {
      throw new Error("Invalid config: defaultPort must be a number");
    }
    if (typeof merged.classificationConfidenceThreshold !== "number") {
      throw new Error("Invalid config: classificationConfidenceThreshold must be a number");
    }
    if (typeof merged.debugMode !== "boolean") {
      throw new Error("Invalid config: debugMode must be a boolean");
    }
    if (!Array.isArray(merged.envAllowlist)) {
      throw new Error("Invalid config: envAllowlist must be an array");
    }
    if (typeof merged.affinityRankings !== "object") {
      throw new Error("Invalid config: affinityRankings must be an object");
    }

    return merged as RelayConfig;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Invalid config:")) {
      throw err;
    }
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(`Config file not found at ${configPath}`);
    }
    if (err instanceof Error) {
      throw new Error(`Failed to load config: ${err.message}`);
    }
    throw new Error("Failed to load config: unknown error");
  }
}
