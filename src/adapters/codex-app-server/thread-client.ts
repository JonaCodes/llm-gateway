import type { AdapterGenerateResult } from "../../core/types.js";
import type { AppLogger } from "../../utils/logger.js";
import { DEFAULT_HEALTHCHECK_TIMEOUT_MS } from "../../config/constants.js";
import {
  DEFAULT_CODEX_APP_SERVER_APPROVAL_POLICY,
  DEFAULT_CODEX_APP_SERVER_CWD,
  DEFAULT_CODEX_APP_SERVER_SANDBOX,
  THREAD_ARCHIVE_METHOD,
  THREAD_FORK_METHOD,
  THREAD_START_METHOD,
  THREAD_UNSUBSCRIBE_METHOD,
  TURN_START_METHOD,
  toAppError,
  type ThreadArchiveResponse,
  type ThreadForkResponse,
  type ThreadStartResponse,
  type ThreadUnsubscribeResponse,
  type TurnStartResponse
} from "./protocol.js";
import type { TurnOperation } from "./turn-operation.js";

type RequestFn = <T>(method: string, params: unknown, timeoutMs: number) => Promise<T>;
type StderrProvider = () => string | null;
const SEED_WARMUP_PROMPT = "Initialization ping. Reply briefly.";

export async function startEphemeralThread(
  request: RequestFn,
  providerModel: string,
  timeoutMs: number,
  logger: AppLogger
): Promise<string> {
  const response = await request<ThreadStartResponse>(
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

export async function startSeedThread(
  request: RequestFn,
  systemPrompt: string,
  providerModel: string,
  timeoutMs: number,
  logger: AppLogger
): Promise<string> {
  const response = await request<ThreadStartResponse>(
    THREAD_START_METHOD,
    {
      approvalPolicy: DEFAULT_CODEX_APP_SERVER_APPROVAL_POLICY,
      baseInstructions: systemPrompt,
      cwd: DEFAULT_CODEX_APP_SERVER_CWD,
      ephemeral: false,
      model: providerModel,
      sandbox: DEFAULT_CODEX_APP_SERVER_SANDBOX
    },
    timeoutMs
  );

  logger.debug({ threadId: response.thread.id, providerModel }, "Started Codex app-server seed thread");
  return response.thread.id;
}

export async function forkThread(
  request: RequestFn,
  seedThreadId: string,
  providerModel: string,
  timeoutMs: number,
  logger: AppLogger
): Promise<string> {
  const response = await request<ThreadForkResponse>(
    THREAD_FORK_METHOD,
    {
      approvalPolicy: DEFAULT_CODEX_APP_SERVER_APPROVAL_POLICY,
      cwd: DEFAULT_CODEX_APP_SERVER_CWD,
      ephemeral: true,
      model: providerModel,
      sandbox: DEFAULT_CODEX_APP_SERVER_SANDBOX,
      threadId: seedThreadId
    },
    timeoutMs
  );

  logger.debug(
    {
      seedThreadId,
      threadId: response.thread.id,
      providerModel
    },
    "Forked Codex app-server thread from seed"
  );

  return response.thread.id;
}

export async function runTurn(
  request: RequestFn,
  stderrProvider: StderrProvider,
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
        toAppError(
          "Codex app-server turn timed out",
          {
            threadId,
            turnId: operation.turnId,
            stderr: stderrProvider()
          },
          504
        )
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

    void request<TurnStartResponse>(
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

export async function warmSeedRollout(
  request: RequestFn,
  stderrProvider: StderrProvider,
  threadId: string,
  timeoutMs: number,
  logger: AppLogger,
  operation: TurnOperation
): Promise<void> {
  await runTurn(request, stderrProvider, threadId, SEED_WARMUP_PROMPT, timeoutMs, logger, operation);
  logger.debug({ threadId }, "Warmed Codex app-server seed rollout");
}

export async function unsubscribeThread(
  request: RequestFn,
  threadId: string,
  logger: AppLogger
): Promise<void> {
  try {
    const response = await request<ThreadUnsubscribeResponse>(
      THREAD_UNSUBSCRIBE_METHOD,
      { threadId },
      DEFAULT_HEALTHCHECK_TIMEOUT_MS
    );

    logger.debug({ threadId, status: response.status }, "Unsubscribed Codex app-server thread");
  } catch (error) {
    logger.warn(
      { threadId, error: error instanceof Error ? error.message : error },
      "Failed to unsubscribe Codex app-server thread"
    );
  }
}

export async function archiveThread(
  request: RequestFn,
  threadId: string,
  logger: AppLogger
): Promise<void> {
  await request<ThreadArchiveResponse>(
    THREAD_ARCHIVE_METHOD,
    { threadId },
    DEFAULT_HEALTHCHECK_TIMEOUT_MS
  );

  logger.debug({ threadId }, "Archived Codex app-server thread");
}
