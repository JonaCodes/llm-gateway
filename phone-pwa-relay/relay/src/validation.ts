import type { IncomingMessage } from "node:http";

import type { ChatJobRequest } from "../../shared/protocol.js";
import { RelayHttpError } from "./errors.js";

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RelayHttpError(400, "invalid_request", "Request body must be valid JSON");
  }
}

export function parseJobRequest(value: unknown): ChatJobRequest {
  if (!isRecord(value) || typeof value.model !== "string" || !Array.isArray(value.messages)) {
    throw new RelayHttpError(400, "invalid_request", "Invalid chat job request");
  }

  return {
    model: value.model,
    messages: value.messages.map((message) => {
      if (!isRecord(message) || typeof message.role !== "string" || typeof message.content !== "string") {
        throw new RelayHttpError(400, "invalid_request", "Invalid chat message");
      }

      if (!["system", "user", "assistant"].includes(message.role)) {
        throw new RelayHttpError(400, "invalid_request", "Invalid chat message role");
      }

      return {
        role: message.role as "system" | "user" | "assistant",
        content: message.content
      };
    }),
    temperature: typeof value.temperature === "number" ? value.temperature : undefined,
    max_tokens: typeof value.max_tokens === "number" ? value.max_tokens : undefined,
    stream: typeof value.stream === "boolean" ? value.stream : false
  };
}

export function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
