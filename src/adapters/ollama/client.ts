import { DEFAULT_HEALTHCHECK_TIMEOUT_MS, ERROR_CODE_ADAPTER_EXECUTION } from "../../config/constants.js";
import { requireHttpTransport } from "../../config/adapters.js";
import { AppError } from "../../core/errors.js";
import type { AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import { isRecord, toNullableNumber, tryParseJson } from "../../utils/json.js";
import type { AppLogger } from "../../utils/logger.js";

interface OllamaModelEntry {
  readonly name: string | null;
  readonly model: string | null;
}

interface OllamaChatInput {
  readonly model: string;
  readonly userPrompt: string;
  readonly systemPrompt?: string;
  readonly thinking: boolean;
  readonly timeoutMs: number;
  readonly logger: AppLogger;
}

export class OllamaClient {
  constructor(private readonly config: ResolvedAdapterConfig) {
    requireHttpTransport(config);
  }

  async listModels(logger?: AppLogger): Promise<readonly OllamaModelEntry[]> {
    const response = await this.requestJson<unknown>({
      path: "/api/tags",
      method: "GET",
      timeoutMs: DEFAULT_HEALTHCHECK_TIMEOUT_MS,
      logger,
      operation: "ollama-list-models"
    });

    if (!isRecord(response) || !Array.isArray(response.models)) {
      throw new AppError("Ollama returned an invalid model list", {
        statusCode: 502,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { response }
      });
    }

    return response.models.map((entry) => {
      if (!isRecord(entry)) {
        return { name: null, model: null };
      }

      return {
        name: typeof entry.name === "string" ? entry.name : null,
        model: typeof entry.model === "string" ? entry.model : null
      };
    });
  }

  async chat(input: OllamaChatInput): Promise<AdapterGenerateResult> {
    const response = await this.requestJson<unknown>({
      path: "/api/chat",
      method: "POST",
      timeoutMs: input.timeoutMs,
      logger: input.logger,
      operation: "ollama-chat",
      model: input.model,
      body: {
        model: input.model,
        messages: buildMessages(input.userPrompt, input.systemPrompt),
        think: input.thinking,
        keep_alive: requireHttpTransport(this.config).defaultKeepAlive,
        stream: false
      }
    });

    if (!isRecord(response)) {
      throw new AppError("Ollama returned an invalid chat response", {
        statusCode: 502,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { response }
      });
    }

    const message = isRecord(response.message) ? response.message : null;
    const outputText = message && typeof message.content === "string" ? message.content : "";
    const thinkingText = extractNullableText(message?.thinking) ?? extractNullableText(response.thinking);

    return {
      inputTokens: toNullableNumber(response.prompt_eval_count),
      cachedInputTokens: null,
      outputText,
      thinkingText,
      outputTokens: toNullableNumber(response.eval_count)
    };
  }

  private async requestJson<T>(input: {
    readonly path: string;
    readonly method: string;
    readonly timeoutMs: number;
    readonly logger?: AppLogger;
    readonly operation: string;
    readonly model?: string;
    readonly body?: unknown;
  }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    const transport = requireHttpTransport(this.config);
    const url = `${transport.baseUrl}${input.path}`;

    try {
      const response = await fetch(url, {
        method: input.method,
        headers: {
          "content-type": "application/json"
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal
      });
      const text = await response.text();
      const parsed = text.trim() === "" ? null : tryParseJson<unknown>(text);

      if (!response.ok) {
        throw new AppError(`Ollama request failed with HTTP ${response.status}`, {
          statusCode: 502,
          code: ERROR_CODE_ADAPTER_EXECUTION,
          details: {
            url,
            status: response.status,
            body: parsed ?? text
          }
        });
      }

      if (parsed === null) {
        throw new AppError("Ollama returned invalid JSON", {
          statusCode: 502,
          code: ERROR_CODE_ADAPTER_EXECUTION,
          details: { url, body: text }
        });
      }

      if (input.operation === "ollama-chat" && isRecord(parsed)) {
        input.logger?.info(
          {
            model: input.model ?? null,
            totalDurationMs: toMilliseconds(parsed.total_duration),
            loadDurationMs: toMilliseconds(parsed.load_duration),
            promptEvalDurationMs: toMilliseconds(parsed.prompt_eval_duration),
            evalDurationMs: toMilliseconds(parsed.eval_duration),
            inputTokens: toNullableNumber(parsed.prompt_eval_count),
            outputTokens: toNullableNumber(parsed.eval_count)
          },
          "Ollama timings"
        );
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("Ollama request timed out", {
          statusCode: 504,
          code: ERROR_CODE_ADAPTER_EXECUTION,
          details: { url, timeoutMs: input.timeoutMs }
        });
      }

      throw new AppError("Failed to reach Ollama", {
        statusCode: 503,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: {
          url,
          error: error instanceof Error ? error.message : error
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildMessages(userPrompt: string, systemPrompt?: string) {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  if (systemPrompt && systemPrompt.trim() !== "") {
    messages.push({
      role: "system",
      content: systemPrompt
    });
  }

  messages.push({
    role: "user",
    content: userPrompt
  });

  return messages;
}

function extractNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function toMilliseconds(value: unknown): number | null {
  const duration = toNullableNumber(value);

  if (duration === null) {
    return null;
  }

  return Math.round(duration / 1_000_000);
}
