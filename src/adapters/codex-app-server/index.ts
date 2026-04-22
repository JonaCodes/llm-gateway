import { ERROR_CODE_ADAPTER_EXECUTION, ERROR_CODE_SEED_NOT_FOUND } from "../../config/constants.js";
import { AppError } from "../../core/errors.js";
import type {
  Adapter,
  AdapterAvailability,
  AdapterGenerateInput,
  AdapterGenerateResult,
  CodexAppServerSeedResult,
  ResolvedAdapterConfig
} from "../../core/types.js";
import { CodexAppServerClient } from "./client.js";
import { createSeedMetadata, hashSystemPrompt, updateSeedMetadata, type SeedMetadata } from "./seeds.js";

export interface CodexAppServerSeedCapable {
  warmSeed(input: {
    readonly seedKey: string;
    readonly systemPrompt: string;
    readonly providerModel: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<CodexAppServerSeedResult>;
  generateFromSeed(input: {
    readonly seedKey: string;
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<AdapterGenerateResult>;
  getSeed(seedKey: string): SeedMetadata | null;
}

export function isCodexAppServerSeedCapable(adapter: Adapter): adapter is Adapter & CodexAppServerSeedCapable {
  return (
    "warmSeed" in adapter &&
    typeof adapter.warmSeed === "function" &&
    "generateFromSeed" in adapter &&
    typeof adapter.generateFromSeed === "function" &&
    "getSeed" in adapter &&
    typeof adapter.getSeed === "function"
  );
}

export class CodexAppServerAdapter implements Adapter, CodexAppServerSeedCapable {
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

  async warmSeed(input: {
    readonly seedKey: string;
    readonly systemPrompt: string;
    readonly providerModel: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<CodexAppServerSeedResult> {
    return this.enqueue(async () => {
      const existing = this.seeds.get(input.seedKey) ?? null;
      const promptHash = hashSystemPrompt(input.systemPrompt);

      if (existing && existing.providerModel === input.providerModel && existing.systemPromptHash === promptHash) {
        return {
          seedKey: input.seedKey,
          providerModel: existing.providerModel,
          status: "reused"
        };
      }

      const threadId = await this.client.createSeed(input.systemPrompt, input.providerModel, input.timeoutMs, input.logger);
      const timestamp = new Date().toISOString();
      const metadata = existing
        ? updateSeedMetadata(existing, threadId, input.providerModel, input.systemPrompt, timestamp)
        : createSeedMetadata(input.seedKey, threadId, input.providerModel, input.systemPrompt, timestamp);

      this.seeds.set(input.seedKey, metadata);

      if (existing) {
        try {
          await this.client.archiveThread(existing.threadId, input.logger);
        } catch (error) {
          input.logger.warn(
            {
              seedKey: input.seedKey,
              previousThreadId: existing.threadId,
              error: error instanceof Error ? error.message : error
            },
            "Failed to archive replaced Codex app-server seed thread"
          );
        }
      }

      return {
        seedKey: input.seedKey,
        providerModel: input.providerModel,
        status: existing ? "replaced" : "created"
      };
    });
  }

  async generateFromSeed(input: {
    readonly seedKey: string;
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<AdapterGenerateResult> {
    return this.enqueue(async () => {
      const seed = this.seeds.get(input.seedKey);

      if (!seed) {
        throw toSeedNotFoundError(input.seedKey);
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
        if (isStaleSeedError(error)) {
          this.seeds.delete(input.seedKey);

          throw toSeedNotFoundError(
            input.seedKey,
            "Seed is no longer available in the current Codex app-server process; warm it again."
          );
        }

        throw error;
      }
    });
  }

  getSeed(seedKey: string): SeedMetadata | null {
    return this.seeds.get(seedKey) ?? null;
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
}

function toSeedNotFoundError(seedKey: string, reason?: string): AppError {
  return new AppError(`Seed '${seedKey}' was not found`, {
    statusCode: 404,
    code: ERROR_CODE_SEED_NOT_FOUND,
    details: reason ? { seedKey, reason } : { seedKey }
  });
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
