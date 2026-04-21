import type { AdapterAlias, AdapterId, ResolvedAdapterConfig } from "../config/adapters.js";
import type { AppLogger } from "../utils/logger.js";

export type { AdapterAlias, AdapterId, ResolvedAdapterConfig };

export interface GenerateRequest {
  readonly model: AdapterAlias;
  readonly userPrompt: string;
  readonly systemPrompt?: string;
  readonly providerModel?: string;
}

export interface AdapterGenerateInput {
  readonly prompt: string;
  readonly providerModel: string | null;
  readonly fallbackProviderModels: readonly string[];
  readonly timeoutMs: number;
  readonly logger: AppLogger;
}

export interface AdapterGenerateResult {
  readonly inputTokens: number | null;
  readonly outputText: string;
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
}

export interface EffectiveModelSelection {
  readonly alias: AdapterAlias;
  readonly adapterId: AdapterId;
  readonly providerModel: string | null;
  readonly fallbackProviderModels: readonly string[];
  readonly adapterConfig: ResolvedAdapterConfig;
}
