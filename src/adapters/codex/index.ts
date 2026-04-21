import { CODEX_JSON_ARGUMENT, DEFAULT_HEALTHCHECK_TIMEOUT_MS, ERROR_CODE_ADAPTER_EXECUTION, HEALTHCHECK_ARGUMENT, PROVIDER_MODEL_ARGUMENT } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";
import type { Adapter, AdapterAvailability, AdapterGenerateInput, AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import type { ExecuteCommandResult } from "../../utils/process.js";
import { executeCommand } from "../../utils/process.js";
import { parseCodexResult } from "./parser.js";

async function runHealthcheck(
  config: ResolvedAdapterConfig
): Promise<ExecuteCommandResult | Error> {
  try {
    return await executeCommand({
      program: config.command.program,
      args: [...config.command.args, HEALTHCHECK_ARGUMENT],
      timeoutMs: DEFAULT_HEALTHCHECK_TIMEOUT_MS,
      logName: "codex-healthcheck"
    });
  } catch (error) {
    return error instanceof Error ? error : new Error("Healthcheck failed");
  }
}

export class CodexAdapter implements Adapter {
  readonly id = "codex";

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
    if (!input.providerModel) {
      throw new AppError("Codex requires an explicit provider model", {
        statusCode: 500,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { adapter: this.id }
      });
    }

    const result = await executeCommand({
      program: this.config.command.program,
      args: [
        ...this.config.command.args,
        CODEX_JSON_ARGUMENT,
        PROVIDER_MODEL_ARGUMENT,
        input.providerModel,
        input.prompt
      ],
      timeoutMs: input.timeoutMs,
      logger: input.logger,
      logName: "codex-generate"
    });

    if (result.exitCode !== 0) {
      throw new AppError("Codex execution failed", {
        statusCode: 502,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { stderr: result.stderr, stdout: result.stdout }
      });
    }

    return parseCodexResult(result.stdout);
  }
}
