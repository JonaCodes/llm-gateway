import { toAppError, isRecord, type JsonRpcNotification } from "./protocol.js";

interface JsonRpcSuccess<T> {
  readonly id: number;
  readonly result: T;
}

interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

interface JsonRpcErrorResponse {
  readonly id: number | null;
  readonly error: JsonRpcErrorPayload;
}

interface PendingRequest<T> {
  readonly method: string;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export class JsonRpcConnection {
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest<unknown>>();

  constructor(
    private readonly writeLine: (line: string, callback: (error?: Error | null) => void) => void,
    private readonly getErrorDetails: () => Record<string, unknown>
  ) {}

  async request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(toAppError(`Codex app-server request '${method}' timed out`, this.getErrorDetails(), 504));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });

      this.writeLine(payload, (error) => {
        if (!error) {
          return;
        }

        const pending = this.pendingRequests.get(id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);
        reject(
          toAppError(`Failed to write Codex app-server request '${method}'`, {
            error: error.message,
            ...this.getErrorDetails()
          })
        );
      });
    });
  }

  handleStdoutLine(line: string, onNotification: (notification: JsonRpcNotification) => void): void {
    const trimmed = line.trim();

    if (trimmed === "") {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (isRecord(parsed) && typeof parsed.method === "string" && "params" in parsed) {
      onNotification(parsed as unknown as JsonRpcNotification);
      return;
    }

    if (isRecord(parsed) && "id" in parsed && "result" in parsed) {
      this.handleSuccessResponse(parsed as unknown as JsonRpcSuccess<unknown>);
      return;
    }

    if (isRecord(parsed) && "error" in parsed && "id" in parsed) {
      this.handleErrorResponse(parsed as unknown as JsonRpcErrorResponse);
    }
  }

  rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private handleSuccessResponse(message: JsonRpcSuccess<unknown>): void {
    const pending = this.pendingRequests.get(message.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);
    pending.resolve(message.result);
  }

  private handleErrorResponse(message: JsonRpcErrorResponse): void {
    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.pendingRequests.get(message.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id);
    pending.reject(
      toAppError(`Codex app-server request '${pending.method}' failed`, {
        error: message.error,
        ...this.getErrorDetails()
      })
    );
  }
}
