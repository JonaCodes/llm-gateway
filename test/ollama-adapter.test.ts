import test from "node:test";
import assert from "node:assert/strict";

import type { AdapterGenerateInput, ResolvedAdapterConfig } from "../src/core/types.js";
import { OllamaAdapter } from "../src/adapters/ollama/index.js";

const adapterConfig: ResolvedAdapterConfig = {
  alias: "gemma4-e2b",
  adapter: "ollama",
  enabled: true,
  defaultProviderModel: "gemma4:e2b",
  fallbackProviderModels: [],
  transport: {
    kind: "http",
    baseUrl: "http://127.0.0.1:11434",
    defaultKeepAlive: "10m"
  }
};

test("ollama healthcheck reports daemon failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  };

  try {
    const adapter = new OllamaAdapter(adapterConfig);
    const result = await adapter.checkAvailability();

    assert.equal(result.available, false);
    assert.match(result.reason ?? "", /Failed to reach Ollama/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama healthcheck reports missing configured models", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      models: [
        {
          name: "gemma4:e4b",
          model: "gemma4:e4b"
        }
      ]
    });

  try {
    const adapter = new OllamaAdapter(adapterConfig);
    const result = await adapter.checkAvailability();

    assert.equal(result.available, false);
    assert.equal(result.reason, "Model 'gemma4:e2b' is not installed in Ollama");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama generate maps token counts and omits thinking text by default", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null
    });

    return jsonResponse({
      message: {
        role: "assistant",
        content: "ok"
      },
      prompt_eval_count: 12,
      eval_count: 4
    });
  };

  try {
    const adapter = new OllamaAdapter(adapterConfig);
    const result = await adapter.generate(createGenerateInput());

    assert.equal(result.outputText, "ok");
    assert.equal(result.thinkingText, null);
    assert.equal(result.inputTokens, 12);
    assert.equal(result.outputTokens, 4);
    assert.equal(result.cachedInputTokens, null);
    assert.equal(requests[0]?.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(requests[0]?.body?.keep_alive, "10m");
    assert.equal(requests[0]?.body?.think, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ollama generate returns separate thinking text when enabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      message: {
        role: "assistant",
        content: "final answer",
        thinking: "reasoning trace"
      },
      prompt_eval_count: 20,
      eval_count: 6
    });

  try {
    const adapter = new OllamaAdapter(adapterConfig);
    const result = await adapter.generate(
      createGenerateInput({
        options: { thinking: true }
      })
    );

    assert.equal(result.outputText, "final answer");
    assert.equal(result.thinkingText, "reasoning trace");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createGenerateInput(
  overrides: Partial<AdapterGenerateInput> = {}
): AdapterGenerateInput {
  return {
    userPrompt: "document payload",
    systemPrompt: "shared instructions",
    providerModel: "gemma4:e2b",
    fallbackProviderModels: [],
    timeoutMs: 1000,
    options: {
      thinking: false
    },
    logger: consoleLogger,
    ...overrides
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

const consoleLogger: AdapterGenerateInput["logger"] = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => consoleLogger
};
