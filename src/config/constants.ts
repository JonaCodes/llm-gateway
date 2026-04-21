export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 4317;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
export const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 5000;
export const DEFAULT_PROCESS_KILL_GRACE_MS = 2000;

export const GENERATE_ROUTE = "/v1/generate";
export const HEALTH_ROUTE = "/health";

export const REQUEST_ID_PREFIX = "req";
export const CONTENT_TYPE_JSON = "application/json; charset=utf-8";

export const SYSTEM_PROMPT_LABEL = "System";
export const USER_PROMPT_LABEL = "User";
export const PROMPT_SECTION_SEPARATOR = "\n\n";
export const PROMPT_VALUE_SEPARATOR = ":\n";

export const HEALTHCHECK_ARGUMENT = "--healthcheck";
export const PROVIDER_MODEL_ARGUMENT = "--model";
export const GEMINI_PROMPT_ARGUMENT = "--prompt";
export const CODEX_JSON_ARGUMENT = "--json";

export const ERROR_CODE_VALIDATION = "validation_error";
export const ERROR_CODE_NOT_FOUND = "not_found";
export const ERROR_CODE_ADAPTER_UNAVAILABLE = "adapter_unavailable";
export const ERROR_CODE_ADAPTER_EXECUTION = "adapter_execution_failed";
export const ERROR_CODE_STARTUP = "startup_error";
export const ERROR_CODE_INTERNAL = "internal_error";

export const ADAPTER_SKIP_FLAGS = {
  codex: "--skip-codex",
  "codex-app-server": "--skip-codex-app-server",
  gemini: "--skip-gemini"
} as const;

export const RUNTIME_ENV_KEYS = {
  host: "LOCAL_LLMS_HOST",
  port: "LOCAL_LLMS_PORT",
  timeoutMs: "LOCAL_LLMS_REQUEST_TIMEOUT_MS"
} as const;

export const GEMINI_RETRYABLE_ERROR_PATTERNS = [
  "exhausted your capacity",
  "rate limit",
  "limit reached",
  "quota",
  "resource exhausted",
  "too many requests",
  "429"
] as const;
