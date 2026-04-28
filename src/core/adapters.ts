import type { Adapter, AdapterAlias, AdapterAvailability, ResolvedAdapterConfig } from "./types.js";
import { CodexAdapter } from "../adapters/codex/index.js";
import { CodexAppServerAdapter } from "../adapters/codex-app-server/index.js";
import { GeminiAdapter } from "../adapters/gemini/index.js";
import { OllamaAdapter } from "../adapters/ollama/index.js";
import { ADAPTER_SKIP_FLAGS } from "../config/constants.js";

export interface AdapterRegistry {
  readonly adapters: ReadonlyMap<AdapterAlias, Adapter>;
  readonly health: () => Promise<AdapterAvailability[]>;
  readonly close: () => Promise<void>;
}

export function buildAdapterRegistry(
  adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>,
  skipAliases: readonly string[]
): AdapterRegistry {
  const adapters = new Map<AdapterAlias, Adapter>();

  for (const config of Object.values(adapterConfigs)) {
    if (!config.enabled || skipAliases.includes(config.alias)) {
      continue;
    }

    adapters.set(config.alias, createAdapter(config));
  }

  return {
    adapters,
    health: async () => {
      const results: AdapterAvailability[] = [];

      for (const config of Object.values(adapterConfigs)) {
        if (skipAliases.includes(config.alias)) {
          results.push({
            alias: config.alias,
            adapter: config.adapter,
            enabled: false,
            available: false,
            reason: `Skipped at startup with ${ADAPTER_SKIP_FLAGS[config.alias]}`
          });
          continue;
        }

        const adapter = adapters.get(config.alias);

        if (!adapter) {
          results.push({
            alias: config.alias,
            adapter: config.adapter,
            enabled: false,
            available: false,
            reason: "Adapter disabled in config"
          });
          continue;
        }

        results.push(await adapter.checkAvailability());
      }

      return results;
    },
    close: async () => {
      for (const adapter of adapters.values()) {
        await adapter.close?.();
      }
    }
  };
}

function createAdapter(config: ResolvedAdapterConfig): Adapter {
  switch (config.adapter) {
    case "codex":
      return new CodexAdapter(config);
    case "codex-app-server":
      return new CodexAppServerAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "ollama":
      return new OllamaAdapter(config);
  }
}
