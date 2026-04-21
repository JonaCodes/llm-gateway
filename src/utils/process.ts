import { spawn } from "node:child_process";

import { AppError } from "../core/errors.js";
import { DEFAULT_PROCESS_KILL_GRACE_MS, ERROR_CODE_ADAPTER_EXECUTION } from "../config/constants.js";
import type { AppLogger } from "./logger.js";

export interface ExecuteCommandOptions {
  readonly program: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: AppLogger;
  readonly logName?: string;
}

export interface ExecuteCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function truncateForLogs(value: string, maxLength = 400): string | null {
  if (value.trim() === "") {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

export async function executeCommand(options: ExecuteCommandOptions): Promise<ExecuteCommandResult> {
  return new Promise((resolve, reject) => {
    const operationName = options.logName ?? options.program;
    const child = spawn(options.program, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let timedOut = false;
    let settled = false;

    const collectOutput = () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
      stderr: Buffer.concat(stderrChunks).toString("utf8").trim()
    });

    const settleWithTimeout = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);

      const { stdout, stderr } = collectOutput();

      options.logger?.error(
        {
          operation: operationName,
          program: options.program,
          stdout: truncateForLogs(stdout),
          stderr: truncateForLogs(stderr)
        },
        "Subprocess timed out"
      );

      reject(
        new AppError(`Process '${options.program}' timed out`, {
          statusCode: 504,
          code: ERROR_CODE_ADAPTER_EXECUTION,
          details: { stdout, stderr }
        })
      );
    };

    options.logger?.info(
      {
        operation: operationName,
        program: options.program,
        timeoutMs: options.timeoutMs
      },
      "Starting subprocess"
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      options.logger?.warn(
        {
          operation: operationName,
          program: options.program,
          timeoutMs: options.timeoutMs
        },
        "Subprocess exceeded timeout; sending SIGTERM"
      );
      child.kill("SIGTERM");
    }, options.timeoutMs);

    const forceKillTimeout = setTimeout(() => {
      if (settled || !timedOut) {
        return;
      }

      options.logger?.warn(
        {
          operation: operationName,
          program: options.program,
          graceMs: DEFAULT_PROCESS_KILL_GRACE_MS
        },
        "Subprocess did not exit after SIGTERM; sending SIGKILL"
      );
      child.kill("SIGKILL");
      settleWithTimeout();
    }, options.timeoutMs + DEFAULT_PROCESS_KILL_GRACE_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      settled = true;
      options.logger?.error(
        {
          operation: operationName,
          program: options.program,
          error: error.message
        },
        "Failed to start subprocess"
      );
      reject(
        new AppError(`Failed to start process '${options.program}'`, {
          statusCode: 503,
          code: ERROR_CODE_ADAPTER_EXECUTION,
          details: { error: error.message }
        })
      );
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      settled = true;

      const { stdout, stderr } = collectOutput();

      if (timedOut) {
        settleWithTimeout();
        return;
      }

      options.logger?.info(
        {
          operation: operationName,
          program: options.program,
          exitCode: exitCode ?? 1,
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: Buffer.byteLength(stderr),
          stderrPreview: truncateForLogs(stderr)
        },
        "Subprocess completed"
      );

      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1
      });
    });
  });
}
