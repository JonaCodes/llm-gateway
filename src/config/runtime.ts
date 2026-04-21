import { ADAPTER_SKIP_FLAGS, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, RUNTIME_ENV_KEYS } from "./constants.js";

export interface StartupOptions {
  readonly skipAliases: string[];
}

export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly requestTimeoutMs: number;
  readonly skipAliases: string[];
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseStartupOptions(argv: readonly string[]): StartupOptions {
  const skipAliases = Object.entries(ADAPTER_SKIP_FLAGS)
    .filter(([, flag]) => argv.includes(flag))
    .map(([alias]) => alias);

  return { skipAliases };
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv, startupOptions: StartupOptions): RuntimeConfig {
  return {
    host: env[RUNTIME_ENV_KEYS.host] ?? DEFAULT_SERVER_HOST,
    port: parseInteger(env[RUNTIME_ENV_KEYS.port], DEFAULT_SERVER_PORT),
    requestTimeoutMs: parseInteger(env[RUNTIME_ENV_KEYS.timeoutMs], DEFAULT_REQUEST_TIMEOUT_MS),
    skipAliases: startupOptions.skipAliases
  };
}
