import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import type { ChatJobRequest, RelayToWorkerEvent, WorkerToRelayEvent } from "../../shared/protocol.js";
import { RelayHttpError } from "./errors.js";
import type { Session } from "./sessions.js";

export function handleWorkerEvent(session: Session, event: WorkerToRelayEvent): void {
  switch (event.type) {
    case "worker.loading":
      session.state = "loading";
      session.model = event.model ?? session.model;
      session.error = null;
      return;
    case "worker.ready":
      session.state = "ready";
      session.model = event.model ?? session.model;
      session.error = null;
      return;
    case "worker.error":
      session.state = "error";
      session.error = event.message ?? "Phone worker error";
      return;
    case "job.token":
      return;
    case "job.result":
      resolvePendingJob(session, event.jobId, {
        id: event.jobId,
        object: "chat.completion",
        model: session.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: event.outputText
            },
            finish_reason: "stop"
          }
        ],
        outputText: event.outputText,
        usage: event.usage ?? null
      });
      return;
    case "job.error":
      rejectPendingJob(session, event.jobId, new RelayHttpError(502, event.code, event.message));
      return;
  }
}

export function sendJob(session: Session, request: ChatJobRequest, jobTimeoutMs: number): Promise<unknown> {
  const worker = session.worker;

  if (!worker || worker.readyState !== WebSocket.OPEN) {
    throw new RelayHttpError(503, "worker_offline", "Phone worker is offline");
  }

  const jobId = randomUUID();
  session.state = "busy";
  session.activeJobId = jobId;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectPendingJob(session, jobId, new RelayHttpError(504, "job_timeout", "Phone worker job timed out"));
    }, jobTimeoutMs);
    session.pendingJobs.set(jobId, {
      id: jobId,
      startedAt: Date.now(),
      timeout,
      resolve,
      reject
    });
    const event: RelayToWorkerEvent = {
      type: "job.request",
      jobId,
      request
    };
    worker.send(JSON.stringify(event));
  });
}

export function rejectPendingJob(session: Session, jobId: string, error: RelayHttpError): void {
  const pending = session.pendingJobs.get(jobId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  session.pendingJobs.delete(jobId);
  session.activeJobId = null;
  session.state = session.worker ? "ready" : "connected";
  pending.reject(error);
}

function resolvePendingJob(session: Session, jobId: string, value: unknown): void {
  const pending = session.pendingJobs.get(jobId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  session.pendingJobs.delete(jobId);
  session.activeJobId = null;
  session.state = "ready";
  pending.resolve(value);
}
