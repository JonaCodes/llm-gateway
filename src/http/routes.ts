import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { isCodexAppServerPromptCachingCapable, type CodexAppServerPromptCachingCapable } from "../adapters/codex-app-server/index.js";
import {
  CONTENT_TYPE_JSON,
  ERROR_CODE_ADAPTER_UNAVAILABLE,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION,
  GENERATE_ROUTE,
  HEALTH_ROUTE
} from "../config/constants.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { buildPrompt } from "../core/prompt.js";
import { AppError } from "../core/errors.js";
import { requireAdapter, resolveEffectiveModelSelection } from "../core/router.js";
import type { AdapterRegistry } from "../core/adapters.js";
import type { AdapterAlias, GenerateRequest } from "../core/types.js";
import type { ResolvedAdapterConfig } from "../config/adapters.js";
import { createRequestId, sendAppError, toUnexpectedAppError } from "./route-helpers.js";
import { generateRequestSchema } from "./schemas.js";

interface RegisterRoutesOptions {
  readonly adapterRegistry: AdapterRegistry;
  readonly adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>;
  readonly runtimeConfig: RuntimeConfig;
}

function getCodexAppServerPromptCachingAdapter(options: RegisterRoutesOptions): CodexAppServerPromptCachingCapable {
  const adapter = options.adapterRegistry.adapters.get("codex-app-server");

  if (!adapter || !isCodexAppServerPromptCachingCapable(adapter)) {
    throw new AppError("Adapter 'codex-app-server' is unavailable", {
      statusCode: 503,
      code: ERROR_CODE_ADAPTER_UNAVAILABLE
    });
  }

  return adapter;
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
    const requestId = createRequestId();
    const requestLogger = request.log.child({
      requestId,
      route: GENERATE_ROUTE,
      model: body.model
    });

    try {
      requestLogger.info(
        {
          hasSystemPrompt: Boolean(body.systemPrompt && body.systemPrompt.trim() !== ""),
          hasProviderModelOverride: Boolean(body.providerModel && body.providerModel.trim() !== "")
        },
        "Received generation request"
      );

      const hasSystemPrompt = Boolean(body.systemPrompt && body.systemPrompt.trim() !== "");
      if (body.model === "codex-app-server" && hasSystemPrompt) {
        const adapter = getCodexAppServerPromptCachingAdapter(options);
        const adapterConfig = options.adapterConfigs["codex-app-server"];
        const providerModel = body.providerModel?.trim() || adapterConfig.defaultProviderModel;

        if (!providerModel) {
          throw new AppError("Codex app-server requires an explicit provider model", {
            statusCode: 500,
            code: ERROR_CODE_INTERNAL,
            details: { adapter: "codex-app-server" }
          });
        }

        const startedAt = performance.now();
        const result = await adapter.generateWithSystemPrompt({
          systemPrompt: body.systemPrompt as string,
          prompt: body.userPrompt,
          providerModel,
          timeoutMs: options.runtimeConfig.requestTimeoutMs,
          logger: requestLogger.child({
            adapter: "codex-app-server",
            providerModel
          })
        });
        const durationMs = Math.round(performance.now() - startedAt);

        requestLogger.info(
          {
            adapter: "codex-app-server",
            providerModel,
            durationMs,
            inputTokens: result.inputTokens,
            cachedInputTokens: result.cachedInputTokens,
            outputTokens: result.outputTokens
          },
          "Generation request completed"
        );

        return reply.type(CONTENT_TYPE_JSON).send({
          id: requestId,
          model: "codex-app-server",
          providerModel,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputText: result.outputText,
          outputTokens: result.outputTokens,
          durationMs,
          adapter: "codex-app-server"
        });
      }

      const selection = resolveEffectiveModelSelection(body, {
        adapterConfigs: options.adapterConfigs
      });
      const adapter = requireAdapter(options.adapterRegistry.adapters, selection);
      const prompt = buildPrompt(body.userPrompt, body.systemPrompt);
      const startedAt = performance.now();
      const result = await adapter.generate({
        prompt,
        providerModel: selection.providerModel,
        fallbackProviderModels: selection.fallbackProviderModels,
        timeoutMs: options.runtimeConfig.requestTimeoutMs,
        logger: requestLogger.child({
          adapter: selection.adapterId,
          providerModel: selection.providerModel
        })
      });
      const durationMs = Math.round(performance.now() - startedAt);

      requestLogger.info(
        {
          adapter: selection.adapterId,
          providerModel: selection.providerModel,
          durationMs,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputTokens: result.outputTokens
        },
        "Generation request completed"
      );

      return reply.type(CONTENT_TYPE_JSON).send({
        id: requestId,
        model: selection.alias,
        providerModel: selection.providerModel,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputText: result.outputText,
        outputTokens: result.outputTokens,
        durationMs,
        adapter: selection.adapterId
      });
    } catch (error) {
      if (error instanceof AppError) {
        requestLogger.error(
          {
            code: error.code,
            statusCode: error.statusCode,
            details: error.details
          },
          "Generation request failed"
        );
        return sendAppError(reply, error);
      }

      requestLogger.error(
        {
          error: error instanceof Error ? error.message : error
        },
        "Generation request failed unexpectedly"
      );
      return sendAppError(reply, toUnexpectedAppError(error));
    }
  });
}
