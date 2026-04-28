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
  const parsedRequestModel = parseRequestModel(request.model);
  const aliasSelection = parsedRequestModel.alias
    ? resolveAliasSelection(parsedRequestModel.alias, parsedRequestModel.providerModel, options.adapterConfigs)
    : null;

  if (aliasSelection) {
    return aliasSelection;
  }

  const inferredSelection = resolveInferredSelection(parsedRequestModel.rawModel, options.adapterConfigs);
  if (inferredSelection) {
    return inferredSelection;
  }

  throw new AppError(`Model '${request.model}' is not available`, {
    statusCode: 404,
    code: ERROR_CODE_NOT_FOUND
  });
}

function resolveAliasSelection(
  alias: string,
  providerModelOverride: string | null,
  adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>
): EffectiveModelSelection | null {
  const adapterConfig = adapterConfigs[alias as AdapterAlias];

  if (!adapterConfig || !adapterConfig.enabled) {
    return null;
  }

  return {
    alias: adapterConfig.alias,
    adapterId: adapterConfig.adapter,
    providerModel: providerModelOverride ?? adapterConfig.defaultProviderModel,
    fallbackProviderModels: providerModelOverride ? [] : adapterConfig.fallbackProviderModels,
    adapterConfig
  };
}

function resolveInferredSelection(
  model: string,
  adapterConfigs: Record<AdapterAlias, ResolvedAdapterConfig>
): EffectiveModelSelection | null {
  if (looksLikeCodexProviderModel(model)) {
    return resolveAliasSelection("codex", model, adapterConfigs);
  }

  if (looksLikeGeminiProviderModel(model)) {
    return resolveAliasSelection("gemini", model, adapterConfigs);
  }

  if (looksLikeOllamaProviderModel(model)) {
    return resolveAliasSelection("ollama", model, adapterConfigs);
  }

  return null;
}

function parseRequestModel(value: string): {
  readonly rawModel: string;
  readonly alias: string | null;
  readonly providerModel: string | null;
} {
  const normalized = value.trim();
  const separatorIndex = normalized.indexOf("/");

  if (separatorIndex === -1) {
    return {
      rawModel: normalized,
      alias: normalized,
      providerModel: null
    };
  }

  const alias = normalized.slice(0, separatorIndex).trim();
  const providerModel = normalized.slice(separatorIndex + 1).trim();

  return {
    rawModel: normalized,
    alias: alias === "" ? null : alias,
    providerModel: providerModel === "" ? null : providerModel
  };
}

function looksLikeCodexProviderModel(model: string): boolean {
  return model.startsWith("gpt-") || /^o\d(?:$|[-:])/.test(model);
}

function looksLikeGeminiProviderModel(model: string): boolean {
  return model.startsWith("gemini-");
}

function looksLikeOllamaProviderModel(model: string): boolean {
  return model.includes(":");
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
