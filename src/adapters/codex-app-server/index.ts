import { ERROR_CODE_ADAPTER_EXECUTION } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";
import type { Adapter, AdapterAvailability, AdapterGenerateInput, AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import { CodexAppServerClient } from "./client.js";

export class CodexAppServerAdapter implements Adapter {
  readonly id = "codex-app-server";

  private readonly client: CodexAppServerClient;
  private generationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ResolvedAdapterConfig) {
    this.client = new CodexAppServerClient(config);
  }

  async checkAvailability(): Promise<AdapterAvailability> {
    try {
      await this.client.ensureStarted();

      return {
        alias: this.config.alias,
        adapter: this.id,
        enabled: this.config.enabled,
        available: true,
        reason: null
      };
    } catch (error) {
      return {
        alias: this.config.alias,
        adapter: this.id,
        enabled: this.config.enabled,
        available: false,
        reason: error instanceof Error ? error.message : "Healthcheck failed"
      };
    }
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateResult> {
    if (!input.providerModel) {
      throw new AppError("Codex app-server requires an explicit provider model", {
        statusCode: 500,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { adapter: this.id }
      });
    }

    const providerModel = input.providerModel;
    const nextRun = this.generationQueue.then(() =>
      this.client.generate(input.prompt, providerModel, input.timeoutMs, input.logger)
    );

    this.generationQueue = nextRun.then(
      () => undefined,
      () => undefined
    );

    return nextRun;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
