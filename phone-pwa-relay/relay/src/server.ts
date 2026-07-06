import { createServer } from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";

import { handleHttpRequest } from "./http.js";
import type { SessionStore } from "./sessions.js";
import { handleWorkerSocket } from "./worker-socket.js";

const PORT = Number.parseInt(process.env.PHONE_PWA_RELAY_PORT ?? "8787", 10);
const HOST = process.env.PHONE_PWA_RELAY_HOST ?? "127.0.0.1";
const JOB_TIMEOUT_MS = Number.parseInt(process.env.PHONE_PWA_JOB_TIMEOUT_MS ?? "120000", 10);

const sessions: SessionStore = new Map();

const server = createServer(async (request, response) => {
  await handleHttpRequest(request, response, {
    sessions,
    jobTimeoutMs: JOB_TIMEOUT_MS
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname !== "/worker") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleWorkerSocket(sessions, ws, url);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`phone-pwa relay listening on http://${HOST}:${PORT}`);
});
