import type { RelayErrorCode } from "../../shared/protocol.js";

export class RelayHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: RelayErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function toRelayHttpError(error: unknown): RelayHttpError {
  if (error instanceof RelayHttpError) {
    return error;
  }

  return new RelayHttpError(500, "worker_error", error instanceof Error ? error.message : "Unexpected relay error");
}
