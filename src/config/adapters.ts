import { resolve } from "node:path";
import { z } from "zod";

import adaptersJson from "../../config/adapters.json" with { type: "json" };

const adapterAliasSchema = z.enum(["codex", "codex-app-server", "gemini", "gemma4-e2b", "gemma4-e4b"]);
const adapterIdSchema = z.enum(["codex", "codex-app-server", "gemini", "ollama"]);

const commandTransportSchema = z.object({
  kind: z.literal("command"),
  program: z.string().min(1),
  args: z.array(z.string())
});

const httpTransportSchema = z.object({
  kind: z.literal("http"),
  baseUrl: z.string().url(),
  defaultKeepAlive: z.string().min(1).optional()
});

const adapterEntrySchema = z.object({
  alias: adapterAliasSchema,
  adapter: adapterIdSchema,
  enabled: z.boolean(),
  defaultProviderModel: z.string().min(1).nullable(),
  fallbackProviderModels: z.array(z.string().min(1)).default([]),
  transport: z.discriminatedUnion("kind", [commandTransportSchema, httpTransportSchema])
});

const adaptersConfigSchema = z.object({
  adapters: z.record(adapterEntrySchema)
});

export type AdapterAlias = z.infer<typeof adapterAliasSchema>;
export type AdapterId = z.infer<typeof adapterIdSchema>;

export interface AdapterCommandTransportConfig {
  readonly kind: "command";
  readonly program: string;
  readonly args: readonly string[];
}

export interface AdapterHttpTransportConfig {
  readonly kind: "http";
  readonly baseUrl: string;
  readonly defaultKeepAlive?: string;
}

export type AdapterTransportConfig = AdapterCommandTransportConfig | AdapterHttpTransportConfig;

export interface AdapterConfig {
  readonly alias: AdapterAlias;
  readonly adapter: AdapterId;
  readonly enabled: boolean;
  readonly defaultProviderModel: string | null;
  readonly fallbackProviderModels: readonly string[];
  readonly transport: AdapterTransportConfig;
}

export interface ResolvedAdapterConfig extends AdapterConfig {
  readonly transport: AdapterTransportConfig;
}

function parseAdaptersConfig(): Record<string, AdapterConfig> {
  const parsed = adaptersConfigSchema.parse(adaptersJson);
  return parsed.adapters;
}

export function loadAdapterConfigs(projectRoot: string): Record<AdapterAlias, ResolvedAdapterConfig> {
  const parsed = parseAdaptersConfig();
  const resolved = Object.values(parsed).reduce<Record<string, ResolvedAdapterConfig>>((accumulator, entry) => {
    accumulator[entry.alias] = {
      ...entry,
      transport:
        entry.transport.kind === "command"
          ? {
              kind: "command",
              program: resolve(projectRoot, entry.transport.program),
              args: [...entry.transport.args]
            }
          : {
              kind: "http",
              baseUrl: entry.transport.baseUrl,
              defaultKeepAlive: entry.transport.defaultKeepAlive
            }
    };
    return accumulator;
  }, {});

  return resolved as Record<AdapterAlias, ResolvedAdapterConfig>;
}

export function isCommandTransport(
  transport: AdapterTransportConfig
): transport is AdapterCommandTransportConfig {
  return transport.kind === "command";
}

export function isHttpTransport(
  transport: AdapterTransportConfig
): transport is AdapterHttpTransportConfig {
  return transport.kind === "http";
}

export function requireCommandTransport(
  config: ResolvedAdapterConfig
): AdapterCommandTransportConfig {
  if (!isCommandTransport(config.transport)) {
    throw new Error(`Adapter '${config.alias}' requires command transport`);
  }

  return config.transport;
}

export function requireHttpTransport(
  config: ResolvedAdapterConfig
): AdapterHttpTransportConfig {
  if (!isHttpTransport(config.transport)) {
    throw new Error(`Adapter '${config.alias}' requires http transport`);
  }

  return config.transport;
}
