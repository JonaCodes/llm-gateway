import { createHash } from "node:crypto";

export interface SeedMetadata {
  readonly seedKey: string;
  readonly threadId: string;
  readonly providerModel: string;
  readonly systemPromptHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function normalizeSystemPrompt(value: string): string {
  return value.trim();
}

export function hashSystemPrompt(value: string): string {
  return createHash("sha256").update(normalizeSystemPrompt(value)).digest("hex");
}

export function createSeedMetadata(
  seedKey: string,
  threadId: string,
  providerModel: string,
  systemPrompt: string,
  timestamp: string
): SeedMetadata {
  return {
    seedKey,
    threadId,
    providerModel,
    systemPromptHash: hashSystemPrompt(systemPrompt),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function updateSeedMetadata(
  previous: SeedMetadata,
  threadId: string,
  providerModel: string,
  systemPrompt: string,
  timestamp: string
): SeedMetadata {
  return {
    ...previous,
    threadId,
    providerModel,
    systemPromptHash: hashSystemPrompt(systemPrompt),
    updatedAt: timestamp
  };
}
