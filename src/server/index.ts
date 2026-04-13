import { initProjectStorage, initGlobalStorage } from "../core/storage.js";
import { createProbeOrchestrator } from "../prober/probe-orchestrator.js";
import { createApp } from "./app.js";
import { initWebSocketServer } from "./websocket.js";
import * as path from "node:path";
import * as os from "node:os";
import { Provider } from "../core/types.js";
import { fileURLToPath } from "node:url";

async function main() {
  // Simple argument parsing for now
  // Usage: node dist/server/index.js [projectRoot] [port]
  const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
  const port = parseInt(process.argv[3] ?? "3000", 10);

  console.log(`Initializing Relay for project: ${projectRoot}`);

  // Initialize global storage (~/.relay/usage/)
  await initGlobalStorage();

  // Initialize project storage (.relay/ in project root)
  const { config } = await initProjectStorage(projectRoot);

  // Initialize and start the usage prober
  const providers: Provider[] = ["claude", "codex", "gemini"];
  const orchestrator = createProbeOrchestrator({
    globalStoragePath: path.join(os.homedir(), ".relay", "usage"),
    providers,
    intervalMs: config.probeInterval * 1000,
  });

  orchestrator.start();

  // Create and start the Express server
  const app = createApp(config, orchestrator, projectRoot);

  const server = app.listen(port, () => {
    console.log(`Relay REST API listening at http://localhost:${String(port)}`);
    console.log(`Project root: ${projectRoot}`);
    console.log(`Probe interval: ${String(config.probeInterval)}s`);
  });

  // Initialize WebSocket server for live output streaming
  initWebSocketServer(server);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down Relay server...");
    server.close();
    await orchestrator.stop();
    console.log("Relay server stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only run if this file is the entry point
const isMain =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("server/index.js") ||
    process.argv[1].endsWith("server/index.ts"));

if (isMain) {
  main().catch((err: unknown) => {
    console.error("Failed to start Relay server:", err);
    process.exit(1);
  });
}

export { main };
