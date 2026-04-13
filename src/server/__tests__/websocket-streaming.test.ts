import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { initWebSocketServer, runEventBus } from "../websocket.js";

describe("WebSocket Streaming", () => {
  let server: HttpServer;
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    wss = initWebSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        port = typeof address === "object" ? (address?.port ?? 0) : 0;
        resolve();
      });
    });
  });

  afterEach(() => {
    wss.close();
    server.close();
  });

  it("client can subscribe and receive stdout chunks", async () => {
    const ws = new WebSocket(`ws://localhost:${String(port)}`);
    const runId = "test-run-123";
    const chunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "subscribe", runId }));
        // Give it a moment to process subscription
        setTimeout(() => {
          runEventBus.emitStdout(runId, "hello");
          runEventBus.emitStdout(runId, " world");
        }, 50);
      });

      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as { type: string; runId: string; chunk: string };
        if (msg.type === "stdout" && msg.runId === runId) {
          chunks.push(msg.chunk);
          if (chunks.join("") === "hello world") {
            ws.close();
            resolve();
          }
        }
      });

      ws.on("error", reject);
      setTimeout(() => {
        reject(new Error("Timeout"));
      }, 1000);
    });

    expect(chunks.join("")).toBe("hello world");
  });

  it("client does not receive chunks for unsubscribed runs", async () => {
    const ws = new WebSocket(`ws://localhost:${String(port)}`);
    const runId1 = "run-1";
    const runId2 = "run-2";
    const chunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "subscribe", runId: runId1 }));
        setTimeout(() => {
          runEventBus.emitStdout(runId1, "match");
          runEventBus.emitStdout(runId2, "no-match");

          // Give it a bit more time to ensure no extra messages arrive
          setTimeout(() => {
            ws.close();
            resolve();
          }, 100);
        }, 50);
      });

      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as { chunk: string };
        chunks.push(msg.chunk);
      });

      ws.on("error", reject);
    });

    expect(chunks).toContain("match");
    expect(chunks).not.toContain("no-match");
  });
});
