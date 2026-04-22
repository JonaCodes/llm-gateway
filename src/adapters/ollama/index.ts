import { ERROR_CODE_ADAPTER_EXECUTION } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";
import type { Adapter, AdapterAvailability, AdapterGenerateInput, AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import { OllamaClient } from "./client.js";

export class OllamaAdapter implements Adapter {
  readonly id = "ollama";

  private readonly client: OllamaClient;

  constructor(private readonly config: ResolvedAdapterConfig) {
    this.client = new OllamaClient(config);
  }

  async checkAvailability(): Promise<AdapterAvailability> {
    const configuredModel = this.config.defaultProviderModel;

    if (!configuredModel) {
      return {
        alias: this.config.alias,
        adapter: this.id,
        enabled: this.config.enabled,
        available: false,
        reason: "Ollama aliases require a default provider model"
      };
    }

    try {
      const models = await this.client.listModels();
      const isAvailable = models.some((entry) => entry.model === configuredModel || entry.name === configuredModel);

      return {
        alias: this.config.alias,
        adapter: this.id,
        enabled: this.config.enabled,
        available: isAvailable,
        reason: isAvailable ? null : `Model '${configuredModel}' is not installed in Ollama`
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
      throw new AppError("Ollama requires an explicit provider model", {
        statusCode: 500,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: { adapter: this.id }
      });
    }

    return this.client.chat({
      model: input.providerModel,
      userPrompt: input.userPrompt,
      systemPrompt: input.systemPrompt,
      thinking: input.options.thinking,
      timeoutMs: input.timeoutMs,
      logger: input.logger
    });
  }
}
