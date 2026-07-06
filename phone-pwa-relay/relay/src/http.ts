import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { RelayHttpError, toRelayHttpError } from "./errors.js";
import { sendJob } from "./jobs.js";
import type { Session, SessionStore } from "./sessions.js";
import { parseJobRequest, readJson } from "./validation.js";

export interface HttpRouterOptions {
  readonly sessions: SessionStore;
  readonly jobTimeoutMs: number;
}

export async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpRouterOptions,
): Promise<void> {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  try {
    await routeHttp(request, response, options);
  } catch (error) {
    sendError(response, toRelayHttpError(error));
  }
}

async function routeHttp(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpRouterOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  const statusMatch = url.pathname.match(/^\/sessions\/([^/]+)\/status$/);
  if (request.method === "GET" && statusMatch) {
    const session = options.sessions.get(decodeURIComponent(statusMatch[1]));
    sendJson(response, 200, {
      worker: {
        state: session?.worker ? session.state : "offline",
        model: session?.model ?? null,
        error: session?.error ?? null,
        activeJobId: session?.activeJobId ?? null
      }
    });
    return;
  }

  const jobsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/jobs$/);
  if (request.method === "POST" && jobsMatch) {
    const session = requireSession(options.sessions, decodeURIComponent(jobsMatch[1]));
    assertAuthorized(request, session);
    assertReadyForJob(session);

    const body = await readJson(request);
    const jobRequest = parseJobRequest(body);
    const result = await sendJob(session, jobRequest, options.jobTimeoutMs);
    sendJson(response, 200, result);
    return;
  }

  throw new RelayHttpError(404, "invalid_request", "Route not found");
}

function requireSession(sessions: SessionStore, sessionId: string): Session {
  const session = sessions.get(sessionId);

  if (!session || !session.worker) {
    throw new RelayHttpError(503, "worker_offline", "Phone worker is offline");
  }

  return session;
}

function assertReadyForJob(session: Session): void {
  if (session.state === "loading") {
    throw new RelayHttpError(409, "model_loading", "Phone worker is still loading its model");
  }

  if (session.state !== "ready") {
    throw new RelayHttpError(409, "worker_busy", `Phone worker is ${session.state}`);
  }
}

function assertAuthorized(request: IncomingMessage, session: Session): void {
  if (!session.token) {
    return;
  }

  const expected = `Bearer ${session.token}`;
  if (request.headers.authorization !== expected) {
    throw new RelayHttpError(403, "invalid_session", "Invalid phone worker session token");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: RelayHttpError): void {
  sendJson(response, error.statusCode, {
    error: {
      code: error.code,
      message: error.message
    }
  });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization");
}
