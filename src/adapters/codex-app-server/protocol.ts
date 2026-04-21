import { ERROR_CODE_ADAPTER_EXECUTION } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";

export const DEFAULT_CODEX_APP_SERVER_CWD = "/tmp";
export const DEFAULT_CODEX_APP_SERVER_SANDBOX = "read-only";
export const DEFAULT_CODEX_APP_SERVER_APPROVAL_POLICY = "never";
export const INITIALIZE_METHOD = "initialize";
export const THREAD_START_METHOD = "thread/start";
export const THREAD_UNSUBSCRIBE_METHOD = "thread/unsubscribe";
export const TURN_START_METHOD = "turn/start";
export const MAX_STDERR_BUFFER_LENGTH = 16_000;

export interface InitializeResponse {
  readonly userAgent: string;
}

export interface ThreadStartResponse {
  readonly thread: {
    readonly id: string;
  };
}

export interface TurnStartResponse {
  readonly turn: {
    readonly id: string;
  };
}

export interface ThreadUnsubscribeResponse {
  readonly status: "notLoaded" | "notSubscribed" | "unsubscribed";
}

export interface JsonRpcNotification {
  readonly method: string;
  readonly params?: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractAssistantTextFromRawResponseItem(value: unknown): string | null {
  if (!isRecord(value) || value.type !== "message" || value.role !== "assistant" || !Array.isArray(value.content)) {
    return null;
  }

  const parts = value.content
    .map((item) => {
      if (!isRecord(item) || item.type !== "output_text" || typeof item.text !== "string") {
        return null;
      }

      return item.text;
    })
    .filter((item): item is string => item !== null && item.trim() !== "");

  return parts.length > 0 ? parts.join("") : null;
}

export function toAppError(message: string, details: unknown, statusCode = 502): AppError {
  return new AppError(message, {
    statusCode,
    code: ERROR_CODE_ADAPTER_EXECUTION,
    details
  });
}
