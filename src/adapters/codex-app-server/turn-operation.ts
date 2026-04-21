import type { AdapterGenerateResult } from "../../core/types.js";
import {
  extractAssistantTextFromRawResponseItem,
  isRecord,
  toAppError,
  toNullableNumber,
  type JsonRpcNotification
} from "./protocol.js";

export interface TurnOperation {
  readonly threadId: string;
  turnId: string | null;
  streamedText: string;
  latestAssistantText: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  completed: boolean;
  resolve?: (result: AdapterGenerateResult) => void;
  reject?: (error: Error) => void;
}

export function createTurnOperation(threadId: string): TurnOperation {
  return {
    threadId,
    turnId: null,
    streamedText: "",
    latestAssistantText: null,
    inputTokens: null,
    outputTokens: null,
    completed: false
  };
}

export function handleTurnOperationNotification(
  operation: TurnOperation,
  notification: JsonRpcNotification,
  stderr: string | null
): void {
  if (!isRecord(notification.params)) {
    return;
  }

  switch (notification.method) {
    case "item/agentMessage/delta": {
      const turnId = typeof notification.params.turnId === "string" ? notification.params.turnId : null;

      if (matchesTurn(operation, turnId) && typeof notification.params.delta === "string") {
        operation.streamedText += notification.params.delta;
      }
      return;
    }
    case "rawResponseItem/completed": {
      const turnId = typeof notification.params.turnId === "string" ? notification.params.turnId : null;

      if (!matchesTurn(operation, turnId)) {
        return;
      }

      const text = extractAssistantTextFromRawResponseItem(notification.params.item);
      if (text && text.trim() !== "") {
        operation.latestAssistantText = text;
      }
      return;
    }
    case "thread/tokenUsage/updated": {
      const turnId = typeof notification.params.turnId === "string" ? notification.params.turnId : null;

      if (!matchesTurn(operation, turnId) || !isRecord(notification.params.tokenUsage) || !isRecord(notification.params.tokenUsage.last)) {
        return;
      }

      operation.inputTokens = toNullableNumber(notification.params.tokenUsage.last.inputTokens);
      operation.outputTokens = toNullableNumber(notification.params.tokenUsage.last.outputTokens);
      return;
    }
    case "turn/completed": {
      const turn = isRecord(notification.params.turn) ? notification.params.turn : null;
      const turnId = turn && typeof turn.id === "string" ? turn.id : null;
      const status = turn && typeof turn.status === "string" ? turn.status : null;

      if (!matchesTurn(operation, turnId) || operation.completed) {
        return;
      }

      if (status === "failed" || status === "interrupted") {
        operation.reject?.(
          toAppError("Codex app-server turn did not complete successfully", {
            threadId: operation.threadId,
            turnId,
            status,
            error: turn && "error" in turn ? turn.error : null,
            stderr
          })
        );
        return;
      }

      operation.resolve?.({
        inputTokens: operation.inputTokens,
        outputText: operation.latestAssistantText ?? operation.streamedText,
        outputTokens: operation.outputTokens
      });
      return;
    }
    case "error": {
      operation.reject?.(
        toAppError("Codex app-server reported a turn error", {
          notification: notification.params,
          stderr
        })
      );
      return;
    }
    default:
      return;
  }
}

function matchesTurn(operation: TurnOperation, turnId: string | null): boolean {
  return operation.turnId === null || turnId === null || operation.turnId === turnId;
}
