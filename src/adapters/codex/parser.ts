import type { AdapterGenerateResult } from "../../core/types.js";
import { isRecord, toNullableNumber, tryParseJson } from "../../utils/json.js";

interface CodexUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
}

const assistantRoles = new Set(["assistant"]);
const assistantTypes = new Set(["agent_message", "assistant_message", "message"]);

function extractContentText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractContentText(item))
      .filter((item): item is string => Boolean(item && item.trim() !== ""));

    return parts.length > 0 ? parts.join("") : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  if ("content" in value) {
    return extractContentText(value.content);
  }

  return null;
}

function extractAssistantTextFromEvent(event: unknown): string | null {
  if (!isRecord(event)) {
    return null;
  }

  if (isRecord(event.item)) {
    return extractAssistantTextFromEvent(event.item);
  }

  const eventType = typeof event.type === "string" ? event.type : null;

  if (eventType === "agent_message" || eventType === "assistant_message") {
    return extractContentText(event.content) ?? extractContentText(event.text);
  }

  if (eventType === "message") {
    const role = typeof event.role === "string" ? event.role : null;

    if (role && assistantRoles.has(role)) {
      return extractContentText(event.content);
    }
  }

  if (typeof event.role === "string" && assistantRoles.has(event.role)) {
    return extractContentText(event.content);
  }

  if (typeof event.type === "string" && assistantTypes.has(event.type)) {
    return extractContentText(event.content);
  }

  if (isRecord(event.last_agent_message)) {
    return extractAssistantTextFromEvent(event.last_agent_message);
  }

  return null;
}

function extractUsageFromEvent(event: unknown): CodexUsage | null {
  if (!isRecord(event)) {
    return null;
  }

  if (event.type === "turn.completed" && isRecord(event.usage)) {
    return {
      inputTokens: toNullableNumber(event.usage.input_tokens),
      cachedInputTokens: toNullableNumber(event.usage.cached_input_tokens),
      outputTokens: toNullableNumber(event.usage.output_tokens)
    };
  }

  if (event.type === "event_msg" && isRecord(event.payload) && event.payload.type === "token_count" && isRecord(event.payload.info)) {
    const usageSource =
      isRecord(event.payload.info.last_token_usage) ? event.payload.info.last_token_usage :
      isRecord(event.payload.info.total_token_usage) ? event.payload.info.total_token_usage :
      null;

    if (usageSource) {
      return {
        inputTokens: toNullableNumber(usageSource.input_tokens),
        cachedInputTokens: toNullableNumber(usageSource.cached_input_tokens),
        outputTokens: toNullableNumber(usageSource.output_tokens)
      };
    }
  }

  return null;
}

export function parseCodexResult(stdout: string): AdapterGenerateResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  let parsedCount = 0;
  let latestText: string | null = null;
  let latestUsage: CodexUsage | null = null;

  for (const line of lines) {
    const event = tryParseJson<unknown>(line);

    if (event === null) {
      continue;
    }

    parsedCount += 1;

    const text = extractAssistantTextFromEvent(event);
    if (text && text.trim() !== "") {
      latestText = text;
    }

    const usage = extractUsageFromEvent(event);
    if (usage) {
      latestUsage = usage;
    }
  }

  if (parsedCount === 0) {
    return {
      inputTokens: null,
      cachedInputTokens: null,
      outputText: stdout,
      outputTokens: null
    };
  }

  return {
    inputTokens: latestUsage?.inputTokens ?? null,
    cachedInputTokens: latestUsage?.cachedInputTokens ?? null,
    outputText: latestText ?? stdout,
    outputTokens: latestUsage?.outputTokens ?? null
  };
}
