export type WorkerState = "connected" | "loading" | "ready" | "busy" | "error";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ChatJobRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly stream?: boolean;
}

export interface WorkerStatusEvent {
  readonly type: "worker.loading" | "worker.ready" | "worker.error";
  readonly model?: string;
  readonly message?: string;
}

export interface JobRequestEvent {
  readonly type: "job.request";
  readonly jobId: string;
  readonly request: ChatJobRequest;
}

export interface JobTokenEvent {
  readonly type: "job.token";
  readonly jobId: string;
  readonly token: string;
}

export interface JobResultEvent {
  readonly type: "job.result";
  readonly jobId: string;
  readonly outputText: string;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

export interface JobErrorEvent {
  readonly type: "job.error";
  readonly jobId: string;
  readonly code: RelayErrorCode;
  readonly message: string;
}

export type WorkerToRelayEvent = WorkerStatusEvent | JobTokenEvent | JobResultEvent | JobErrorEvent;
export type RelayToWorkerEvent = JobRequestEvent;

export type RelayErrorCode =
  | "worker_offline"
  | "worker_busy"
  | "model_loading"
  | "job_timeout"
  | "invalid_session"
  | "invalid_request"
  | "worker_error";
