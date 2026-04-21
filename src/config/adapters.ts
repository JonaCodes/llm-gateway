import { resolve } from "node:path";
import { z } from "zod";

import adaptersJson from "../../config/adapters.json" with { type: "json" };

const adapterAliasSchema = z.enum(["codex", "codex-app-server", "gemini"]);

const commandSchema = z.object({
  program: z.string().min(1),
  args: z.array(z.string())
});

const adapterEntrySchema = z.object({
  alias: adapterAliasSchema,
  adapter: adapterAliasSchema,
  enabled: z.boolean(),
  defaultProviderModel: z.string().min(1).nullable(),
  fallbackProviderModels: z.array(z.string().min(1)).default([]),
  command: commandSchema
});

const adaptersConfigSchema = z.object({
  adapters: z.record(adapterEntrySchema)
});

export type AdapterAlias = z.infer<typeof adapterAliasSchema>;
export type AdapterId = AdapterAlias;

export interface AdapterCommandConfig {
  readonly program: string;
  readonly args: readonly string[];
}

export interface AdapterConfig {
  readonly alias: AdapterAlias;
  readonly adapter: AdapterId;
  readonly enabled: boolean;
  readonly defaultProviderModel: string | null;
  readonly fallbackProviderModels: readonly string[];
  readonly command: AdapterCommandConfig;
}

export interface ResolvedAdapterConfig extends AdapterConfig {
  readonly command: {
    readonly program: string;
    readonly args: readonly string[];
  };
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
      command: {
        program: resolve(projectRoot, entry.command.program),
        args: [...entry.command.args]
      }
    };
    return accumulator;
  }, {});

  return resolved as Record<AdapterAlias, ResolvedAdapterConfig>;
}
