import * as childProcess from "node:child_process";
import * as util from "node:util";

import type { Provider } from "../core/types.js";

const execFile = util.promisify(childProcess.execFile);

/** All known provider CLI names, in declaration order. */
const PROVIDER_NAMES: readonly Provider[] = ["claude", "codex", "gemini"];

export interface DiscoveredProvider {
  provider: Provider;
  executablePath: string;
}

/**
 * Check if an executable exists on PATH using `which`.
 *
 * Returns the resolved path (trimmed) on success, or null if the executable
 * is not found or `which` fails for any reason.
 *
 * NOTE: We intentionally avoid running the CLI itself (no --help, --version,
 * etc.) because those flags may have side effects or slow startup.
 */
export async function findExecutable(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFile("which", [name]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    // Non-zero exit (executable not found) or any other error.
    return null;
  }
}

/**
 * Discover which provider CLIs are available on the system.
 *
 * Runs `which` for each known provider in parallel and returns only those
 * that resolve to a real executable path.
 */
export async function discoverProviders(): Promise<DiscoveredProvider[]> {
  const results = await Promise.all(
    PROVIDER_NAMES.map(async (provider) => {
      const executablePath = await findExecutable(provider);
      return executablePath !== null ? { provider, executablePath } : null;
    }),
  );

  return results.filter((r): r is DiscoveredProvider => r !== null);
}
