import type WebSocket from "ws";

import type { WorkerState } from "../../shared/protocol.js";
import type { RelayHttpError } from "./errors.js";

export interface PendingJob {
  readonly id: string;
  readonly startedAt: number;
  readonly timeout: NodeJS.Timeout;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: RelayHttpError) => void;
}

export interface Session {
  readonly id: string;
  token: string | null;
  worker: WebSocket | null;
  state: WorkerState;
  model: string | null;
  error: string | null;
  activeJobId: string | null;
  pendingJobs: Map<string, PendingJob>;
}

export type SessionStore = Map<string, Session>;

export function getOrCreateSession(sessions: SessionStore, id: string): Session {
  const existing = sessions.get(id);
  if (existing) {
    return existing;
  }

  const session: Session = {
    id,
    token: null,
    worker: null,
    state: "connected",
    model: null,
    error: null,
    activeJobId: null,
    pendingJobs: new Map()
  };
  sessions.set(id, session);
  return session;
}
