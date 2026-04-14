import { EventEmitter } from "node:events";
import { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Event bus for bridging task execution events to WebSocket clients.
 */
export class RunEventBus extends EventEmitter {
  emitStdout(runId: string, chunk: string) {
    this.emit("stdout", { runId, chunk });
  }

  emitStderr(runId: string, chunk: string) {
    this.emit("stderr", { runId, chunk });
  }

  emitStatusChange(runId: string, status: string) {
    this.emit("status_change", { runId, status });
  }
}

export const runEventBus = new RunEventBus();

interface ClientSubscription {
  ws: WebSocket;
  runIds: Set<string>;
}

interface WsMessage {
  type: "subscribe" | "unsubscribe";
  runId: string;
}

/**
 * Initializes the WebSocket server and attaches it to the provided HTTP server.
 */
export function initWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server });
  const clients = new Map<WebSocket, ClientSubscription>();

  wss.on("connection", (ws: WebSocket) => {
    console.log("WebSocket client connected");
    clients.set(ws, { ws, runIds: new Set() });

    ws.on("message", (data: Buffer | string | ArrayBuffer | Buffer[]) => {
      try {
        let payload: string;
        if (typeof data === "string") {
          payload = data;
        } else if (Buffer.isBuffer(data)) {
          payload = data.toString();
        } else if (Array.isArray(data)) {
          payload = Buffer.concat(data).toString();
        } else {
          // ArrayBuffer
          payload = Buffer.from(data).toString();
        }

        const message = JSON.parse(payload) as WsMessage;
        const client = clients.get(ws);
        if (!client) return;

        switch (message.type) {
          case "subscribe":
            if (message.runId) {
              client.runIds.add(message.runId);
              console.log(`Client subscribed to run: ${message.runId}`);
            }
            break;
          case "unsubscribe":
            if (message.runId) {
              client.runIds.delete(message.runId);
              console.log(`Client unsubscribed from run: ${message.runId}`);
            }
            break;
          default:
            console.warn(`Unknown message type: ${String((message as { type: unknown }).type)}`);
        }
      } catch (err: unknown) {
        console.error("Failed to parse WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket client disconnected");
      clients.delete(ws);
    });

    ws.on("error", (err: unknown) => {
      console.error("WebSocket error:", err);
      clients.delete(ws);
    });
  });

  // Forward events from the bus to subscribed clients
  const forwardEvent = (
    type: "stdout" | "stderr" | "status_change",
    event: { runId: string; chunk?: string; status?: string },
  ) => {
    const message = JSON.stringify({
      type,
      runId: event.runId,
      chunk: event.chunk,
      status: event.status,
    });

    for (const client of clients.values()) {
      if (client.runIds.has(event.runId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  };

  runEventBus.on("stdout", (event: { runId: string; chunk: string }) => {
    forwardEvent("stdout", event);
  });
  runEventBus.on("stderr", (event: { runId: string; chunk: string }) => {
    forwardEvent("stderr", event);
  });
  runEventBus.on("status_change", (event: { runId: string; status: string }) => {
    forwardEvent("status_change", event);
  });

  return wss;
}
