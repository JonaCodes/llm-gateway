import test from "node:test";
import assert from "node:assert/strict";

import { ERROR_CODE_ADAPTER_EXECUTION } from "../src/config/constants.js";
import { AppError } from "../src/core/errors.js";
import type { AdapterGenerateInput, ResolvedAdapterConfig } from "../src/core/types.js";
import { CodexAppServerAdapter } from "../src/adapters/codex-app-server/index.js";
import { createSeedId } from "../src/adapters/codex-app-server/seeds.js";

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

test("stale internal seed is recreated and the request succeeds", async () => {
  const adapter = new CodexAppServerAdapter(adapterConfig);
  const client = (adapter as unknown as { client: Record<string, unknown> }).client;
  let createSeedCalls = 0;
  let generateFromSeedCalls = 0;

  client.createSeed = async () => {
    createSeedCalls += 1;
    return `seed-thread-${createSeedCalls}`;
  };
  client.generateFromSeed = async () => {
    generateFromSeedCalls += 1;

    if (generateFromSeedCalls === 1) {
      throw new AppError("Codex app-server request 'thread/fork' failed", {
        statusCode: 502,
        code: ERROR_CODE_ADAPTER_EXECUTION,
        details: {
          error: {
            code: -32600,
            message: "no rollout found for thread id seed-thread-1"
          },
          stderr: null
        }
      });
    }

    return {
      inputTokens: 10,
      cachedInputTokens: 8,
      outputText: "ok",
      outputTokens: 2
    };
  };

  const result = await adapter.generateWithSystemPrompt({
    systemPrompt: "seed prompt",
    prompt: "document payload",
    providerModel: "gpt-5.2",
    timeoutMs: 1000,
    logger: consoleLogger
  });

  assert.equal(result.outputText, "ok");
  assert.equal(createSeedCalls, 2);
  assert.equal(generateFromSeedCalls, 2);

  const seeds = (adapter as unknown as { seeds: Map<string, { threadId: string }> }).seeds;
  assert.equal(seeds.get(createSeedId("seed prompt", "gpt-5.2"))?.threadId, "seed-thread-2");
});

test("clearing process-local seeds causes the same prompt to be re-seeded on the next request", async () => {
  const adapter = new CodexAppServerAdapter(adapterConfig);
  const client = (adapter as unknown as { client: Record<string, unknown> }).client;
  let createSeedCalls = 0;

  client.createSeed = async () => {
    createSeedCalls += 1;
    return `seed-thread-${createSeedCalls}`;
  };
  client.generateFromSeed = async () => ({
    inputTokens: 10,
    cachedInputTokens: 8,
    outputText: "ok",
    outputTokens: 2
  });

  await adapter.generateWithSystemPrompt({
    systemPrompt: "seed prompt",
    prompt: "document payload",
    providerModel: "gpt-5.2",
    timeoutMs: 1000,
    logger: consoleLogger
  });

  adapter.clearSeeds();

  await adapter.generateWithSystemPrompt({
    systemPrompt: "seed prompt",
    prompt: "document payload",
    providerModel: "gpt-5.2",
    timeoutMs: 1000,
    logger: consoleLogger
  });

  assert.equal(createSeedCalls, 2);
});

const consoleLogger: AdapterGenerateInput["logger"] = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => consoleLogger
};
