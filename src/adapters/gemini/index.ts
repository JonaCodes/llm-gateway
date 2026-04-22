import { DEFAULT_HEALTHCHECK_TIMEOUT_MS, ERROR_CODE_ADAPTER_EXECUTION, GEMINI_PROMPT_ARGUMENT, HEALTHCHECK_ARGUMENT, PROVIDER_MODEL_ARGUMENT } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";
import type { Adapter, AdapterAvailability, AdapterGenerateInput, AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import type { ExecuteCommandResult } from "../../utils/process.js";
import { executeCommand } from "../../utils/process.js";
import { shouldRetryGeminiWithFallback } from "./retry.js";

async function runHealthcheck(
  config: ResolvedAdapterConfig
): Promise<ExecuteCommandResult | Error> {
  try {
    return await executeCommand({
      program: config.command.program,
      args: [...config.command.args, HEALTHCHECK_ARGUMENT],
      timeoutMs: DEFAULT_HEALTHCHECK_TIMEOUT_MS,
      logName: "gemini-healthcheck"
    });
  } catch (error) {
    return error instanceof Error ? error : new Error("Healthcheck failed");
  }
}

function buildTextArgs(
  config: ResolvedAdapterConfig,
  prompt: string,
  providerModel: string | null
): string[] {
  const args = [...config.command.args];

  if (providerModel) {
    args.push(PROVIDER_MODEL_ARGUMENT, providerModel);
  }

  args.push(GEMINI_PROMPT_ARGUMENT, prompt);

  return args;
}

async function executeGeminiAttempt(
  config: ResolvedAdapterConfig,
  input: AdapterGenerateInput,
  providerModel: string | null,
  attemptLabel: string,
  timeoutMs: number
): Promise<ExecuteCommandResult> {
  return executeCommand({
    program: config.command.program,
    args: buildTextArgs(config, input.prompt, providerModel),
    timeoutMs,
    logger: input.logger.child({
      phase: attemptLabel,
      attemptedProviderModel: providerModel
    }),
    logName: "gemini-generate"
  });
}

export class GeminiAdapter implements Adapter {
  readonly id = "gemini";

  constructor(private readonly config: ResolvedAdapterConfig) {}

  async checkAvailability(): Promise<AdapterAvailability> {
    const result = await runHealthcheck(this.config);

    if (result instanceof Error) {
      return {
        alias: this.config.alias,
        adapter: this.id,
        enabled: this.config.enabled,
        available: false,
        reason: result.message
      };
    }

    if (result.exitCode !== 0) {
      return {
        alias: this.config.alias,
        adapter: this.id,
        enabled: this.config.enabled,
        available: false,
        reason: result.stderr || result.stdout || "Healthcheck failed"
      };
    }

    return {
      alias: this.config.alias,
      adapter: this.id,
      enabled: this.config.enabled,
      available: true,
      reason: null
    };
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateResult> {
    const attemptModels = [input.providerModel, ...input.fallbackProviderModels]
      .filter((model, index, values): model is string | null => values.indexOf(model) === index);
    const startedAt = Date.now();

    let lastError: AppError | null = null;

    for (let index = 0; index < attemptModels.length; index += 1) {
      const providerModel = attemptModels[index];
      const isLastAttempt = index === attemptModels.length - 1;
      const elapsedMs = Date.now() - startedAt;
      const remainingTimeoutMs = Math.max(1, input.timeoutMs - elapsedMs);

      try {
        const result = await executeGeminiAttempt(
          this.config,
          input,
          providerModel,
          isLastAttempt ? "final-attempt" : "primary-attempt",
          remainingTimeoutMs
        );

        if (result.exitCode !== 0) {
          throw new AppError("Gemini execution failed", {
            statusCode: 502,
            code: ERROR_CODE_ADAPTER_EXECUTION,
            details: { stderr: result.stderr, stdout: result.stdout, providerModel }
          });
        }

        return {
          inputTokens: null,
          cachedInputTokens: null,
          outputText: result.stdout,
          outputTokens: null
        };
      } catch (error) {
        if (!(error instanceof AppError)) {
          throw error;
        }

        lastError = error;

        const shouldRetry =
          !isLastAttempt &&
          shouldRetryGeminiWithFallback({
            message: error.message,
            stdout: typeof error.details === "object" && error.details !== null && "stdout" in error.details ? String((error.details as Record<string, unknown>).stdout ?? "") : undefined,
            stderr: typeof error.details === "object" && error.details !== null && "stderr" in error.details ? String((error.details as Record<string, unknown>).stderr ?? "") : undefined
          });

        if (!shouldRetry) {
          throw error;
        }

        input.logger.warn(
          {
            failedProviderModel: providerModel,
            nextProviderModel: attemptModels[index + 1] ?? null,
            details: error.details
          },
          "Gemini request hit retryable model failure; retrying with fallback model"
        );
      }
    }

    throw (
      lastError ??
      new AppError("Gemini execution failed without a result", {
        statusCode: 502,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { adapter: this.id }
      })
    );
  }
}
