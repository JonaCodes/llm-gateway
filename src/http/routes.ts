import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { isCodexAppServerSeedCapable, type CodexAppServerSeedCapable } from "../adapters/codex-app-server/index.js";
import {
  CODEX_APP_SERVER_SEEDS_ROUTE,
  CONTENT_TYPE_JSON,
  ERROR_CODE_ADAPTER_UNAVAILABLE,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_SEED_NOT_FOUND,
  ERROR_CODE_VALIDATION,
  GENERATE_ROUTE,
  HEALTH_ROUTE
} from "../config/constants.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { buildPrompt } from "../core/prompt.js";
import { AppError } from "../core/errors.js";
import { requireAdapter, resolveEffectiveModelSelection } from "../core/router.js";
import type { AdapterRegistry } from "../core/adapters.js";
import type { AdapterAlias, CodexAppServerSeedRequest, GenerateRequest } from "../core/types.js";
import type { ResolvedAdapterConfig } from "../config/adapters.js";
import { createRequestId, sendAppError, toUnexpectedAppError } from "./route-helpers.js";
import { codexAppServerSeedRequestSchema, generateRequestSchema } from "./schemas.js";

interface RegisterRoutesOptions {
  readonly adapterRegistry: AdapterRegistry;
  readonly adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>;
  readonly runtimeConfig: RuntimeConfig;
}

function getCodexAppServerSeedAdapter(options: RegisterRoutesOptions): CodexAppServerSeedCapable {
  const adapter = options.adapterRegistry.adapters.get("codex-app-server");

  if (!adapter || !isCodexAppServerSeedCapable(adapter)) {
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

  server.post(CODEX_APP_SERVER_SEEDS_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = codexAppServerSeedRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).type(CONTENT_TYPE_JSON).send({
        error: {
          code: ERROR_CODE_VALIDATION,
          message: "Invalid request body",
          details: parsed.error.flatten()
        }
      });
    }

    const body: CodexAppServerSeedRequest = parsed.data;
    const requestId = createRequestId();
    const requestLogger = request.log.child({
      requestId,
      route: CODEX_APP_SERVER_SEEDS_ROUTE,
      model: "codex-app-server",
      seedKey: body.seedKey
    });

    try {
      const adapter = getCodexAppServerSeedAdapter(options);
      const adapterConfig = options.adapterConfigs["codex-app-server"];
      const providerModel = body.providerModel?.trim() || adapterConfig.defaultProviderModel;

      if (!providerModel) {
        throw new AppError("Codex app-server requires an explicit provider model", {
          statusCode: 500,
          code: ERROR_CODE_INTERNAL,
          details: { adapter: "codex-app-server" }
        });
      }

      const result = await adapter.warmSeed({
        seedKey: body.seedKey,
        systemPrompt: body.systemPrompt,
        providerModel,
        timeoutMs: options.runtimeConfig.requestTimeoutMs,
        logger: requestLogger.child({
          adapter: "codex-app-server",
          providerModel
        })
      });

      requestLogger.info(
        {
          providerModel: result.providerModel,
          status: result.status
        },
        "Codex app-server seed request completed"
      );

      return reply.type(CONTENT_TYPE_JSON).send(result);
    } catch (error) {
      if (error instanceof AppError) {
        requestLogger.error(
          {
            code: error.code,
            statusCode: error.statusCode,
            details: error.details
          },
          "Codex app-server seed request failed"
        );
        return sendAppError(reply, error);
      }

      requestLogger.error(
        {
          error: error instanceof Error ? error.message : error
        },
        "Codex app-server seed request failed unexpectedly"
      );
      return sendAppError(reply, toUnexpectedAppError(error));
    }
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
      if (body.seedKey && body.model !== "codex-app-server") {
        throw new AppError("seedKey is only supported for model 'codex-app-server'", {
          statusCode: 400,
          code: ERROR_CODE_VALIDATION,
          details: { model: body.model }
        });
      }

      if (body.seedKey && body.systemPrompt && body.systemPrompt.trim() !== "") {
        throw new AppError("systemPrompt must be omitted when seedKey is provided", {
          statusCode: 400,
          code: ERROR_CODE_VALIDATION,
          details: { seedKey: body.seedKey }
        });
      }

      requestLogger.info(
        {
          hasSystemPrompt: Boolean(body.systemPrompt && body.systemPrompt.trim() !== ""),
          hasProviderModelOverride: Boolean(body.providerModel && body.providerModel.trim() !== ""),
          hasSeedKey: Boolean(body.seedKey && body.seedKey.trim() !== "")
        },
        "Received generation request"
      );

      if (body.seedKey) {
        const adapter = getCodexAppServerSeedAdapter(options);
        const seed = adapter.getSeed(body.seedKey);

        if (!seed) {
          throw new AppError(`Seed '${body.seedKey}' was not found`, {
            statusCode: 404,
            code: ERROR_CODE_SEED_NOT_FOUND,
            details: { seedKey: body.seedKey }
          });
        }

        if (body.providerModel?.trim() && body.providerModel.trim() !== seed.providerModel) {
          throw new AppError("providerModel override must match the warmed seed provider model", {
            statusCode: 400,
            code: ERROR_CODE_VALIDATION,
            details: {
              seedKey: body.seedKey,
              providerModel: body.providerModel.trim(),
              seedProviderModel: seed.providerModel
            }
          });
        }

        const startedAt = performance.now();
        const result = await adapter.generateFromSeed({
          seedKey: body.seedKey,
          prompt: body.userPrompt,
          timeoutMs: options.runtimeConfig.requestTimeoutMs,
          logger: requestLogger.child({
            adapter: "codex-app-server",
            providerModel: seed.providerModel,
            seedKey: body.seedKey
          })
        });
        const durationMs = Math.round(performance.now() - startedAt);

        requestLogger.info(
          {
            adapter: "codex-app-server",
            providerModel: seed.providerModel,
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
          providerModel: seed.providerModel,
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
