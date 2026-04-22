import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { toAppError } from "./protocol.js";
import type { JsonRpcConnection } from "./rpc.js";
import type { TurnOperation } from "./turn-operation.js";

interface RegisterCodexAppServerProcessHandlersOptions {
  readonly child: ChildProcessWithoutNullStreams;
  readonly rpc: JsonRpcConnection;
  readonly turnOperations: Map<string, TurnOperation>;
  readonly clearProcessState: () => void;
  readonly getStderr: () => string | null;
  readonly onProcessExit?: () => void;
}

export function registerCodexAppServerProcessHandlers(options: RegisterCodexAppServerProcessHandlersOptions): void {
  const { child, rpc, turnOperations, clearProcessState, getStderr, onProcessExit } = options;

  child.on("error", (error) => {
    rpc.rejectAllPending(toAppError("Failed to start Codex app-server", { error: error.message }));
    clearProcessState();
  });

  child.on("close", (exitCode, signal) => {
    const details = {
      exitCode: exitCode ?? null,
      signal: signal ?? null,
      stderr: getStderr()
    };

    rpc.rejectAllPending(toAppError("Codex app-server exited unexpectedly", details));

    for (const operation of turnOperations.values()) {
      operation.reject?.(toAppError("Codex app-server exited during generation", details));
    }

    turnOperations.clear();
    clearProcessState();
    onProcessExit?.();

    // TODO: If mid-run app-server exits become common in practice, add targeted restart/supervision
    // instead of just failing the in-flight request and relying on a later request to recreate it.
  });
}
