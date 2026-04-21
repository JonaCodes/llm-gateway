import type { Adapter } from "./types.js";
import type { AdapterAlias, EffectiveModelSelection, GenerateRequest, ResolvedAdapterConfig } from "./types.js";
import { ERROR_CODE_ADAPTER_UNAVAILABLE, ERROR_CODE_NOT_FOUND } from "../config/constants.js";
import { AppError } from "./errors.js";

export interface ResolveModelOptions {
  readonly adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>;
}

export function resolveEffectiveModelSelection(
  request: GenerateRequest,
  options: ResolveModelOptions
): EffectiveModelSelection {
  const adapterConfig = options.adapterConfigs[request.model];

  if (!adapterConfig || !adapterConfig.enabled) {
    throw new AppError(`Model '${request.model}' is not available`, {
      statusCode: 404,
      code: ERROR_CODE_NOT_FOUND
    });
  }

  return {
    alias: adapterConfig.alias,
    adapterId: adapterConfig.adapter,
    providerModel: request.providerModel?.trim() || adapterConfig.defaultProviderModel,
    fallbackProviderModels: request.providerModel?.trim() ? [] : adapterConfig.fallbackProviderModels,
    adapterConfig
  };
}

export function requireAdapter(
  adapters: ReadonlyMap<AdapterAlias, Adapter>,
  selection: EffectiveModelSelection
): Adapter {
  const adapter = adapters.get(selection.alias);

  if (!adapter) {
    throw new AppError(`Adapter '${selection.adapterId}' is unavailable`, {
      statusCode: 503,
      code: ERROR_CODE_ADAPTER_UNAVAILABLE
    });
  }

  return adapter;
}
