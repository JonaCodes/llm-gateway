import type { Adapter, AdapterAlias, AdapterAvailability, ResolvedAdapterConfig } from "./types.js";
import { CodexAdapter } from "../adapters/codex/index.js";
import { CodexAppServerAdapter } from "../adapters/codex-app-server/index.js";
import { GeminiAdapter } from "../adapters/gemini/index.js";
import { ADAPTER_SKIP_FLAGS, ERROR_CODE_STARTUP } from "../config/constants.js";
import { AppError } from "./errors.js";

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

  if (adapterConfigs.codex.enabled && !skipAliases.includes(adapterConfigs.codex.alias)) {
    adapters.set("codex", new CodexAdapter(adapterConfigs.codex));
  }

  if (adapterConfigs["codex-app-server"].enabled && !skipAliases.includes(adapterConfigs["codex-app-server"].alias)) {
    adapters.set("codex-app-server", new CodexAppServerAdapter(adapterConfigs["codex-app-server"]));
  }

  if (adapterConfigs.gemini.enabled && !skipAliases.includes(adapterConfigs.gemini.alias)) {
    adapters.set("gemini", new GeminiAdapter(adapterConfigs.gemini));
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

export async function assertStartupHealth(registry: AdapterRegistry): Promise<void> {
  const health = await registry.health();
  const unavailable = health.filter((entry) => entry.enabled && !entry.available);

  if (unavailable.length > 0) {
    throw new AppError("One or more adapters failed startup health checks", {
      statusCode: 503,
      code: ERROR_CODE_STARTUP,
      details: unavailable
    });
  }
}
