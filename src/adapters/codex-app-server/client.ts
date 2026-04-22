import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";

import { DEFAULT_HEALTHCHECK_TIMEOUT_MS } from "../../config/constants.js";
import { requireCommandTransport } from "../../config/adapters.js";
import type { AdapterGenerateResult, ResolvedAdapterConfig } from "../../core/types.js";
import type { AppLogger } from "../../utils/logger.js";
import {
  INITIALIZE_METHOD,
  MAX_STDERR_BUFFER_LENGTH,
  toAppError,
  type InitializeResponse,
  type JsonRpcNotification
} from "./protocol.js";
import { registerCodexAppServerProcessHandlers } from "./process-lifecycle.js";
import { JsonRpcConnection } from "./rpc.js";
import {
  archiveThread,
  forkThread,
  runTurn,
  startEphemeralThread,
  startSeedThread,
  warmSeedRollout,
  unsubscribeThread
} from "./thread-client.js";
import { createTurnOperation, handleTurnOperationNotification, type TurnOperation } from "./turn-operation.js";

interface CodexAppServerClientOptions {
  readonly onProcessExit?: () => void;
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadLineInterface | null = null;
  private stderrReader: ReadLineInterface | null = null;
  private rpc: JsonRpcConnection | null = null;
  private readonly turnOperations = new Map<string, TurnOperation>();
  private stderrBuffer = "";
  private startupPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ResolvedAdapterConfig,
    private readonly options: CodexAppServerClientOptions = {}
  ) {}

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
    const threadId = await this.startEphemeralThread(providerModel, timeoutMs, logger);
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

  async createSeed(systemPrompt: string, providerModel: string, timeoutMs: number, logger: AppLogger): Promise<string> {
    await this.ensureStarted(logger);

    const startedAt = Date.now();
    const threadId = await this.startSeedThread(systemPrompt, providerModel, timeoutMs, logger);
    const operation = createTurnOperation(threadId);
    this.turnOperations.set(threadId, operation);

    try {
      const elapsedMs = Date.now() - startedAt;
      const remainingTimeoutMs = Math.max(1, timeoutMs - elapsedMs);
      await warmSeedRollout(
        this.request.bind(this),
        () => this.stderrBuffer || null,
        threadId,
        remainingTimeoutMs,
        logger,
        operation
      );
      return threadId;
    } finally {
      this.turnOperations.delete(threadId);
    }
  }

  async generateFromSeed(
    seedThreadId: string,
    prompt: string,
    providerModel: string,
    timeoutMs: number,
    logger: AppLogger
  ): Promise<AdapterGenerateResult> {
    await this.ensureStarted(logger);

    const startedAt = Date.now();
    const threadId = await this.forkThread(seedThreadId, providerModel, timeoutMs, logger);
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

  async archiveThread(threadId: string, logger: AppLogger): Promise<void> {
    await this.ensureStarted(logger);
    await archiveThread(this.request.bind(this), threadId, logger);
  }

  private async start(logger?: AppLogger): Promise<void> {
    const transport = requireCommandTransport(this.config);
    const child = spawn(transport.program, [...transport.args], {
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

    registerCodexAppServerProcessHandlers({
      child,
      rpc: this.rpc,
      turnOperations: this.turnOperations,
      clearProcessState: () => {
        this.clearProcessState();
      },
      getStderr: () => this.stderrBuffer || null,
      onProcessExit: this.options.onProcessExit
    });

    logger?.info({ program: transport.program }, "Starting Codex app-server");

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

  private async startEphemeralThread(providerModel: string, timeoutMs: number, logger: AppLogger): Promise<string> {
    return startEphemeralThread(this.request.bind(this), providerModel, timeoutMs, logger);
  }

  private async startSeedThread(
    systemPrompt: string,
    providerModel: string,
    timeoutMs: number,
    logger: AppLogger
  ): Promise<string> {
    return startSeedThread(this.request.bind(this), systemPrompt, providerModel, timeoutMs, logger);
  }

  private async forkThread(
    seedThreadId: string,
    providerModel: string,
    timeoutMs: number,
    logger: AppLogger
  ): Promise<string> {
    return forkThread(this.request.bind(this), seedThreadId, providerModel, timeoutMs, logger);
  }

  private async runTurn(
    threadId: string,
    prompt: string,
    timeoutMs: number,
    logger: AppLogger,
    operation: TurnOperation
  ): Promise<AdapterGenerateResult> {
    return runTurn(
      this.request.bind(this),
      () => this.stderrBuffer || null,
      threadId,
      prompt,
      timeoutMs,
      logger,
      operation
    );
  }

  private async unsubscribeThread(threadId: string, logger: AppLogger): Promise<void> {
    await unsubscribeThread(this.request.bind(this), threadId, logger);
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
