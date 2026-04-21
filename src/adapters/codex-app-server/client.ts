import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";

import { DEFAULT_HEALTHCHECK_TIMEOUT_MS } from "../../config/constants.js";
import type { AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import type { AppLogger } from "../../utils/logger.js";
import {
  DEFAULT_CODEX_APP_SERVER_APPROVAL_POLICY,
  DEFAULT_CODEX_APP_SERVER_CWD,
  DEFAULT_CODEX_APP_SERVER_SANDBOX,
  INITIALIZE_METHOD,
  MAX_STDERR_BUFFER_LENGTH,
  THREAD_START_METHOD,
  THREAD_UNSUBSCRIBE_METHOD,
  TURN_START_METHOD,
  toAppError,
  type InitializeResponse,
  type JsonRpcNotification,
  type ThreadStartResponse,
  type ThreadUnsubscribeResponse,
  type TurnStartResponse
} from "./protocol.js";
import { JsonRpcConnection } from "./rpc.js";
import { createTurnOperation, handleTurnOperationNotification, type TurnOperation } from "./turn-operation.js";

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadLineInterface | null = null;
  private stderrReader: ReadLineInterface | null = null;
  private rpc: JsonRpcConnection | null = null;
  private readonly turnOperations = new Map<string, TurnOperation>();
  private stderrBuffer = "";
  private startupPromise: Promise<void> | null = null;

  constructor(private readonly config: ResolvedAdapterConfig) {}

  async ensureStarted(logger?: AppLogger): Promise<void> {
    if (this.startupPromise) {
      return this.startupPromise;
    }

    if (this.child && this.child.exitCode === null) {
      return;
    }

    this.startupPromise = this.start(logger).finally(() => {
      this.startupPromise = null;
    });

    return this.startupPromise;
  }

  async close(): Promise<void> { await this.shutdown(); }

  async generate(prompt: string, providerModel: string, timeoutMs: number, logger: AppLogger): Promise<AdapterGenerateResult> {
    await this.ensureStarted(logger);

    const startedAt = Date.now();
    const threadId = await this.startThread(providerModel, timeoutMs, logger);
    const operation = createTurnOperation(threadId);
    this.turnOperations.set(threadId, operation);

    try {
      const elapsedMs = Date.now() - startedAt;
      const remainingTimeoutMs = Math.max(1, timeoutMs - elapsedMs);
      return await this.runTurn(threadId, prompt, remainingTimeoutMs, logger, operation);
    } finally {
      this.turnOperations.delete(threadId);
      await this.unsubscribeThread(threadId, logger);
    }
  }

  private async start(logger?: AppLogger): Promise<void> {
    const child = spawn(this.config.command.program, [...this.config.command.args], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child = child;
    this.stderrBuffer = "";
    this.rpc = new JsonRpcConnection(
      (line, callback) => child.stdin.write(`${line}\n`, callback),
      () => ({
        stderr: this.stderrBuffer || null
      })
    );

    this.stdoutReader = createInterface({ input: child.stdout });
    this.stderrReader = createInterface({ input: child.stderr });

    this.stdoutReader.on("line", (line) => {
      this.rpc?.handleStdoutLine(line, (notification) => {
        this.handleNotification(notification);
      });
    });

    this.stderrReader.on("line", (line) => {
      this.appendStderr(line);
      logger?.debug({ line }, "Codex app-server stderr");
    });

    child.on("error", (error) => {
      this.rpc?.rejectAllPending(toAppError("Failed to start Codex app-server", { error: error.message }));
      this.clearProcessState();
    });

    child.on("close", (exitCode, signal) => {
      const details = {
        exitCode: exitCode ?? null,
        signal: signal ?? null,
        stderr: this.stderrBuffer || null
      };

      this.rpc?.rejectAllPending(toAppError("Codex app-server exited unexpectedly", details));

      for (const operation of this.turnOperations.values()) {
        operation.reject?.(toAppError("Codex app-server exited during generation", details));
      }

      this.turnOperations.clear();
      this.clearProcessState();

      // TODO: If mid-run app-server exits become common in practice, add targeted restart/supervision
      // instead of just failing the in-flight request and relying on a later request to recreate it.
    });

    logger?.info({ program: this.config.command.program }, "Starting Codex app-server");

    try {
      await this.request<InitializeResponse>(
        INITIALIZE_METHOD,
        {
          clientInfo: {
            name: "local-llms",
            version: "0.1.0"
          },
          capabilities: null
        },
        DEFAULT_HEALTHCHECK_TIMEOUT_MS
      );
    } catch (error) {
      await this.shutdown();
      throw (
        error instanceof Error
          ? error
          : toAppError("Failed to initialize Codex app-server", {
              error,
              stderr: this.stderrBuffer || null
            })
      );
    }
  }

  private async startThread(providerModel: string, timeoutMs: number, logger: AppLogger): Promise<string> {
    const response = await this.request<ThreadStartResponse>(
      THREAD_START_METHOD,
      {
        approvalPolicy: DEFAULT_CODEX_APP_SERVER_APPROVAL_POLICY,
        cwd: DEFAULT_CODEX_APP_SERVER_CWD,
        ephemeral: true,
        model: providerModel,
        sandbox: DEFAULT_CODEX_APP_SERVER_SANDBOX
      },
      timeoutMs
    );

    logger.debug({ threadId: response.thread.id, providerModel }, "Started Codex app-server thread");
    return response.thread.id;
  }

  private async runTurn(
    threadId: string,
    prompt: string,
    timeoutMs: number,
    logger: AppLogger,
    operation: TurnOperation
  ): Promise<AdapterGenerateResult> {
    return new Promise<AdapterGenerateResult>((resolve, reject) => {
      const completionTimeout = setTimeout(() => {
        if (operation.completed) {
          return;
        }

        operation.completed = true;
        reject(
          toAppError("Codex app-server turn timed out", {
            threadId,
            turnId: operation.turnId,
            stderr: this.stderrBuffer || null
          }, 504)
        );
      }, timeoutMs);

      const settle = <T>(callback: (value: T) => void, value: T) => {
        if (operation.completed) {
          return;
        }

        operation.completed = true;
        clearTimeout(completionTimeout);
        callback(value);
      };

      operation.resolve = (result) => settle(resolve, result);
      operation.reject = (error) => settle(reject, error);

      void this.request<TurnStartResponse>(
        TURN_START_METHOD,
        {
          input: [
            {
              type: "text",
              text: prompt,
              text_elements: []
            }
          ],
          threadId
        },
        timeoutMs
      )
        .then((response) => {
          operation.turnId = response.turn.id;
          logger.debug({ threadId, turnId: response.turn.id }, "Started Codex app-server turn");
        })
        .catch((error) => {
          settle(
            reject,
            error instanceof Error
              ? error
              : toAppError("Failed to start Codex app-server turn", { error })
          );
        });
    });
  }

  private async unsubscribeThread(threadId: string, logger: AppLogger): Promise<void> {
    try {
      const response = await this.request<ThreadUnsubscribeResponse>(
        THREAD_UNSUBSCRIBE_METHOD,
        { threadId },
        DEFAULT_HEALTHCHECK_TIMEOUT_MS
      );

      logger.debug({ threadId, status: response.status }, "Unsubscribed Codex app-server thread");
    } catch (error) {
      logger.warn({ threadId, error: error instanceof Error ? error.message : error }, "Failed to unsubscribe Codex app-server thread");
    }
  }

  private async request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (!this.rpc || !this.child || this.child.exitCode !== null) {
      throw toAppError("Codex app-server is not running", { stderr: this.stderrBuffer || null });
    }

    return this.rpc.request<T>(method, params, timeoutMs);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const params = notification.params;

    if (!params || typeof params !== "object" || !("threadId" in params) || typeof params.threadId !== "string") {
      return;
    }

    const operation = this.turnOperations.get(params.threadId);
    if (!operation) return;

    handleTurnOperationNotification(operation, notification, this.stderrBuffer || null);
  }

  private appendStderr(line: string): void {
    const next = this.stderrBuffer === "" ? line : `${this.stderrBuffer}\n${line}`;
    this.stderrBuffer = next.length <= MAX_STDERR_BUFFER_LENGTH
      ? next
      : next.slice(next.length - MAX_STDERR_BUFFER_LENGTH);
  }

  private clearProcessState(): void {
    this.stdoutReader?.removeAllListeners();
    this.stderrReader?.removeAllListeners();
    this.stdoutReader?.close();
    this.stderrReader?.close();
    this.stdoutReader = null;
    this.stderrReader = null;
    this.rpc = null;
    this.child = null;
  }

  private async shutdown(): Promise<void> {
    const child = this.child;

    if (!child) {
      return;
    }

    this.child = null;

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        child.removeAllListeners();
        resolve();
      };

      child.once("close", cleanup);

      if (child.exitCode !== null) {
        cleanup();
        return;
      }

      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 1000);
    });

    this.clearProcessState();
  }
}
