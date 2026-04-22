import test from "node:test";
import assert from "node:assert/strict";

import { ERROR_CODE_ADAPTER_EXECUTION, ERROR_CODE_SEED_NOT_FOUND } from "../src/config/constants.js";
import { AppError } from "../src/core/errors.js";
import type { AdapterGenerateInput, ResolvedAdapterConfig } from "../src/core/types.js";
import { CodexAppServerAdapter } from "../src/adapters/codex-app-server/index.js";

const adapterConfig: ResolvedAdapterConfig = {
  alias: "codex-app-server",
  adapter: "codex-app-server",
  enabled: true,
  defaultProviderModel: "gpt-5.2",
  fallbackProviderModels: [],
  command: {
    program: "/tmp/qodex-app-server",
    args: []
  }
};

test("stale seed fork failure invalidates the seed and returns seed_not_found", async () => {
  const adapter = new CodexAppServerAdapter(adapterConfig);
  const client = (adapter as unknown as { client: Record<string, unknown> }).client;

  client.createSeed = async () => "seed-thread";
  client.generateFromSeed = async () => {
    throw new AppError("Codex app-server request 'thread/fork' failed", {
      statusCode: 502,
      code: ERROR_CODE_ADAPTER_EXECUTION,
      details: {
        error: {
          code: -32600,
          message: "no rollout found for thread id seed-thread"
        },
        stderr: null
      }
    });
  };

  await adapter.warmSeed({
    seedKey: "doc-tagging-demo",
    systemPrompt: "seed prompt",
    providerModel: "gpt-5.2",
    timeoutMs: 1000,
    logger: consoleLogger
  });

  assert.ok(adapter.getSeed("doc-tagging-demo"));

  await assert.rejects(
    adapter.generateFromSeed({
      seedKey: "doc-tagging-demo",
      prompt: "document payload",
      timeoutMs: 1000,
      logger: consoleLogger
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ERROR_CODE_SEED_NOT_FOUND);
      assert.equal(error.statusCode, 404);
      assert.deepEqual(error.details, {
        seedKey: "doc-tagging-demo",
        reason: "Seed is no longer available in the current Codex app-server process; warm it again."
      });
      return true;
    }
  );

  assert.equal(adapter.getSeed("doc-tagging-demo"), null);
});

test("clearing process-local seeds invalidates warmed seed mappings", async () => {
  const adapter = new CodexAppServerAdapter(adapterConfig);
  const client = (adapter as unknown as { client: Record<string, unknown> }).client;

  client.createSeed = async () => "seed-thread";

  await adapter.warmSeed({
    seedKey: "doc-tagging-demo",
    systemPrompt: "seed prompt",
    providerModel: "gpt-5.2",
    timeoutMs: 1000,
    logger: consoleLogger
  });

  assert.ok(adapter.getSeed("doc-tagging-demo"));

  adapter.clearSeeds();

  assert.equal(adapter.getSeed("doc-tagging-demo"), null);

  await assert.rejects(
    adapter.generateFromSeed({
      seedKey: "doc-tagging-demo",
      prompt: "document payload",
      timeoutMs: 1000,
      logger: consoleLogger
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ERROR_CODE_SEED_NOT_FOUND);
      assert.equal(error.statusCode, 404);
      return true;
    }
  );
});

const consoleLogger: AdapterGenerateInput["logger"] = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => consoleLogger
};
