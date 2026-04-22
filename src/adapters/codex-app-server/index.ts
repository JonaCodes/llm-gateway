import { ERROR_CODE_ADAPTER_EXECUTION } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";
import type {
  Adapter,
  AdapterAvailability,
  AdapterGenerateInput,
  AdapterGenerateResult,
  ResolvedAdapterConfig
} from "../../core/types.js";
import { CodexAppServerClient } from "./client.js";
import { createSeedId, createSeedMetadata, updateSeedMetadata, type SeedMetadata } from "./seeds.js";

export interface CodexAppServerPromptCachingCapable {
  generateWithSystemPrompt(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly providerModel: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<AdapterGenerateResult>;
}

export function isCodexAppServerPromptCachingCapable(adapter: Adapter): adapter is Adapter & CodexAppServerPromptCachingCapable {
  return (
    "generateWithSystemPrompt" in adapter &&
    typeof adapter.generateWithSystemPrompt === "function"
  );
}

export class CodexAppServerAdapter implements Adapter, CodexAppServerPromptCachingCapable {
  readonly id = "codex-app-server";

  private readonly client: CodexAppServerClient;
  private operationQueue: Promise<unknown> = Promise.resolve();
  private readonly seeds = new Map<string, SeedMetadata>();

  constructor(private readonly config: ResolvedAdapterConfig) {
    this.client = new CodexAppServerClient(config, {
      onProcessExit: () => {
        this.clearSeeds();
      }
    });
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

    return this.enqueue(() =>
      this.client.generate(input.prompt, input.providerModel as string, input.timeoutMs, input.logger)
    );
  }

  async generateWithSystemPrompt(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly providerModel: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<AdapterGenerateResult> {
    return this.enqueue(async () => {
      const seedId = createSeedId(input.systemPrompt, input.providerModel);
      let seed = this.seeds.get(seedId) ?? null;

      if (!seed) {
        seed = await this.ensureSeedMetadata(seedId, input.systemPrompt, input.providerModel, input.timeoutMs, input.logger);
      }

      try {
        return await this.client.generateFromSeed(
          seed.threadId,
          input.prompt,
          seed.providerModel,
          input.timeoutMs,
          input.logger
        );
      } catch (error) {
        if (!isStaleSeedError(error)) {
          throw error;
        }

        this.seeds.delete(seedId);
        const recreatedSeed = await this.ensureSeedMetadata(
          seedId,
          input.systemPrompt,
          input.providerModel,
          input.timeoutMs,
          input.logger
        );

        return this.client.generateFromSeed(
          recreatedSeed.threadId,
          input.prompt,
          recreatedSeed.providerModel,
          input.timeoutMs,
          input.logger
        );
      }
    });
  }

  clearSeeds(): void {
    this.seeds.clear();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const nextRun = this.operationQueue.then(operation);

    this.operationQueue = nextRun.then(
      () => undefined,
      () => undefined
    );

    return nextRun;
  }

  private async ensureSeedMetadata(
    seedId: string,
    systemPrompt: string,
    providerModel: string,
    timeoutMs: number,
    logger: AdapterGenerateInput["logger"]
  ): Promise<SeedMetadata> {
    const threadId = await this.client.createSeed(systemPrompt, providerModel, timeoutMs, logger);
    const timestamp = new Date().toISOString();
    const existing = this.seeds.get(seedId) ?? null;
    const metadata = existing
      ? updateSeedMetadata(existing, threadId, providerModel, timestamp)
      : createSeedMetadata(seedId, threadId, providerModel, timestamp);

    this.seeds.set(seedId, metadata);
    return metadata;
  }
}

function isStaleSeedError(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }

  const providerMessage = getProviderErrorMessage(error);
  if (!providerMessage) {
    return false;
  }

  const normalizedMessage = providerMessage.toLowerCase();
  return (
    normalizedMessage.includes("no rollout found") ||
    normalizedMessage.includes("thread not found") ||
    normalizedMessage.includes("no thread found") ||
    normalizedMessage.includes("missing thread")
  );
}

function getProviderErrorMessage(error: AppError): string | null {
  if (!isRecord(error.details) || !("error" in error.details) || !isRecord(error.details.error)) {
    return null;
  }

  return typeof error.details.error.message === "string" ? error.details.error.message : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
