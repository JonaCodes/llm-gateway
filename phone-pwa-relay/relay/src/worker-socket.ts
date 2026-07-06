import { URL } from "node:url";
import type WebSocket from "ws";

import type { WorkerToRelayEvent } from "../../shared/protocol.js";
import { RelayHttpError } from "./errors.js";
import { handleWorkerEvent } from "./jobs.js";
import { getOrCreateSession, type SessionStore } from "./sessions.js";
import { tryParseJson } from "./validation.js";

export function handleWorkerSocket(sessions: SessionStore, ws: WebSocket, url: URL): void {
  const sessionId = url.searchParams.get("session")?.trim() || "default";
  const token = url.searchParams.get("token")?.trim() || null;
  const session = getOrCreateSession(sessions, sessionId);

  session.worker?.close(4000, "replaced by a newer worker connection");
  session.worker = ws;
  session.token = token;
  session.state = "connected";
  session.error = null;

  ws.on("message", (raw) => {
    const event = tryParseJson<WorkerToRelayEvent>(raw.toString());
    if (!event) {
      return;
    }

    handleWorkerEvent(session, event);
  });

  ws.on("close", () => {
    if (session.worker !== ws) {
      return;
    }

    for (const pending of session.pendingJobs.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new RelayHttpError(503, "worker_offline", "Phone worker disconnected during the job"));
    }

    session.pendingJobs.clear();
    session.worker = null;
    session.state = "connected";
    session.activeJobId = null;
  });
}
