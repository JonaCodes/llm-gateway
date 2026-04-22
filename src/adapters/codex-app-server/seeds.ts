import { createHash } from "node:crypto";

export interface SeedMetadata {
  readonly seedId: string;
  readonly threadId: string;
  readonly providerModel: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function normalizeSystemPrompt(value: string): string {
  return value.trim();
}

export function createSeedId(systemPrompt: string, providerModel: string): string {
  return createHash("sha256")
    .update(`${providerModel}\0${normalizeSystemPrompt(systemPrompt)}`)
    .digest("hex");
}

export function createSeedMetadata(
  seedId: string,
  threadId: string,
  providerModel: string,
  timestamp: string
): SeedMetadata {
  return {
    seedId,
    threadId,
    providerModel,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function updateSeedMetadata(
  previous: SeedMetadata,
  threadId: string,
  providerModel: string,
  timestamp: string
): SeedMetadata {
  return {
    ...previous,
    threadId,
    providerModel,
    updatedAt: timestamp
  };
}
