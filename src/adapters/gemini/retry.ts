import { GEMINI_RETRYABLE_ERROR_PATTERNS } from "../../config/constants.js";

export interface GeminiRetryContext {
  readonly message?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

export function shouldRetryGeminiWithFallback(context: GeminiRetryContext): boolean {
  const combined = [context.message, context.stdout, context.stderr]
    .filter((value): value is string => Boolean(value && value.trim() !== ""))
    .join("\n")
    .toLowerCase();

  return GEMINI_RETRYABLE_ERROR_PATTERNS.some((pattern) => combined.includes(pattern));
}
