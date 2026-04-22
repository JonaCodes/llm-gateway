import { randomUUID } from "node:crypto";

import type { FastifyReply } from "fastify";

import {
  CONTENT_TYPE_JSON,
  ERROR_CODE_INTERNAL,
  REQUEST_ID_PREFIX
} from "../config/constants.js";
import { AppError } from "../core/errors.js";

export function createRequestId(): string {
  return `${REQUEST_ID_PREFIX}_${randomUUID()}`;
}

export function sendAppError(reply: FastifyReply, error: AppError): FastifyReply {
  return reply.status(error.statusCode).type(CONTENT_TYPE_JSON).send({
    error: {
      code: error.code,
      message: error.message,
      details: error.details
    }
  });
}

export function toUnexpectedAppError(error: unknown): AppError {
  return new AppError("Unexpected server error", {
    statusCode: 500,
    code: ERROR_CODE_INTERNAL,
    details: error instanceof Error ? error.message : error
  });
}
