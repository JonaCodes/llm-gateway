import type { AdapterAlias, AdapterId, ResolvedAdapterConfig } from "../config/adapters.js";
import type { AppLogger } from "../utils/logger.js";

export type { AdapterAlias, AdapterId, ResolvedAdapterConfig };

export interface GenerateRequestOptions {
  readonly thinking?: boolean;
}

export interface GenerateRequestMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface GenerateRequest {
  readonly model: string;
  readonly messages: readonly GenerateRequestMessage[];
  readonly options?: GenerateRequestOptions;
}

export interface AdapterGenerateOptions {
  readonly thinking: boolean;
}

export interface AdapterGenerateInput {
  readonly userPrompt: string;
  readonly systemPrompt?: string;
  readonly providerModel: string | null;
  readonly fallbackProviderModels: readonly string[];
  readonly timeoutMs: number;
  readonly logger: AppLogger;
  readonly options: AdapterGenerateOptions;
}

export interface AdapterGenerateResult {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputText: string;
  readonly thinkingText: string | null;
  readonly outputTokens: number | null;
}

export interface AdapterAvailability {
  readonly alias: AdapterAlias;
  readonly adapter: AdapterId;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface Adapter {
  readonly id: AdapterId;
  checkAvailability(): Promise<AdapterAvailability>;
  generate(input: AdapterGenerateInput): Promise<AdapterGenerateResult>;
  close?(): Promise<void>;
}

export interface EffectiveModelSelection {
  readonly alias: AdapterAlias;
  readonly adapterId: AdapterId;
  readonly providerModel: string | null;
  readonly fallbackProviderModels: readonly string[];
  readonly adapterConfig: ResolvedAdapterConfig;
}
