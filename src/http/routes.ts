import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  CONTENT_TYPE_JSON,
  ERROR_CODE_VALIDATION,
  GENERATE_ROUTE,
  HEALTH_ROUTE
} from "../config/constants.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { AppError } from "../core/errors.js";
import { requireAdapter, resolveEffectiveModelSelection } from "../core/router.js";
import type { AdapterRegistry } from "../core/adapters.js";
import type { AdapterAlias, GenerateRequest, GenerateRequestMessage } from "../core/types.js";
import type { ResolvedAdapterConfig } from "../config/adapters.js";
import { createPromptPreview, createRequestId, sendAppError, toUnexpectedAppError } from "./route-helpers.js";
import { generateRequestSchema } from "./schemas.js";

interface RegisterRoutesOptions {
  readonly adapterRegistry: AdapterRegistry;
  readonly adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>;
  readonly runtimeConfig: RuntimeConfig;
}

export async function registerRoutes(server: FastifyInstance, options: RegisterRoutesOptions): Promise<void> {
  server.get(HEALTH_ROUTE, async (_, reply) => {
    const adapters = await options.adapterRegistry.health();

    return reply.type(CONTENT_TYPE_JSON).send({
      status: "ok",
      adapters
    });
  });

  server.post(GENERATE_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = generateRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).type(CONTENT_TYPE_JSON).send({
        error: {
          code: ERROR_CODE_VALIDATION,
          message: "Invalid request body",
          details: parsed.error.flatten()
        }
      });
    }

    const body: GenerateRequest = parsed.data;
    const promptInput = toPromptInput(body.messages);
    const requestId = createRequestId();

    if ("error" in promptInput) {
      return reply.status(400).type(CONTENT_TYPE_JSON).send({
        error: {
          code: ERROR_CODE_VALIDATION,
          message: promptInput.error,
          details: {
            fieldErrors: {
              messages: [promptInput.error]
            }
          }
        }
      });
    }

    const promptPreview = createPromptPreview(promptInput.userPrompt);
    const systemPromptChars = promptInput.systemPrompt?.length ?? 0;
    const userPromptChars = promptInput.userPrompt.length;

    try {
      const selection = resolveEffectiveModelSelection(body, {
        adapterConfigs: options.adapterConfigs
      });
      const requestLogger = request.log.child({
        route: GENERATE_ROUTE,
        model: selection.alias,
        adapter: selection.adapterId,
        providerModel: selection.providerModel
      });
      const adapter = requireAdapter(options.adapterRegistry.adapters, selection);
      requestLogger.info(
        {
          thinking: body.options?.thinking ?? false,
          promptPreview,
          userPromptChars,
          systemPromptChars
        },
        "Generate start"
      );
      const startedAt = performance.now();
      const result = await adapter.generate({
        userPrompt: promptInput.userPrompt,
        systemPrompt: promptInput.systemPrompt,
        providerModel: selection.providerModel,
        fallbackProviderModels: selection.fallbackProviderModels,
        timeoutMs: options.runtimeConfig.requestTimeoutMs,
        options: {
          thinking: body.options?.thinking ?? false
        },
        logger: requestLogger
      });
      const durationMs = Math.round(performance.now() - startedAt);

      requestLogger.info(
        {
          durationMs,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputTokens: result.outputTokens,
          outputChars: result.outputText.length,
          thinkingChars: result.thinkingText?.length ?? 0,
          promptPreview
        },
        "Generate complete"
      );

      return reply.type(CONTENT_TYPE_JSON).send({
        id: requestId,
        model: selection.alias,
        providerModel: selection.providerModel,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputText: result.outputText,
        thinkingText: result.thinkingText,
        outputTokens: result.outputTokens,
        durationMs,
        adapter: selection.adapterId
      });
    } catch (error) {
      const requestLogger = request.log.child({
        route: GENERATE_ROUTE,
        model: body.model
      });
      if (error instanceof AppError) {
        requestLogger.error(
          {
            code: error.code,
            statusCode: error.statusCode,
            promptPreview,
            userPromptChars,
            systemPromptChars,
            details: error.details
          },
          "Generate failed"
        );
        return sendAppError(reply, error);
      }

      requestLogger.error(
        {
          promptPreview,
          userPromptChars,
          systemPromptChars,
          error: error instanceof Error ? error.message : error
        },
        "Generate failed unexpectedly"
      );
      return sendAppError(reply, toUnexpectedAppError(error));
    }
  });
}

function toPromptInput(messages: readonly GenerateRequestMessage[]): {
  readonly systemPrompt?: string;
  readonly userPrompt: string;
} | {
  readonly error: string;
} {
  const systemParts: string[] = [];
  const userParts: string[] = [];
  let seenUserMessage = false;

  for (const message of messages) {
    if (message.role === "system") {
      if (seenUserMessage) {
        return {
          error: "System messages must come before user messages"
        };
      }
      systemParts.push(message.content);
      continue;
    }

    seenUserMessage = true;
    userParts.push(message.content);
  }

  if (userParts.length === 0) {
    return {
      error: "At least one user message is required"
    };
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    userPrompt: userParts.join("\n\n")
  };
}
