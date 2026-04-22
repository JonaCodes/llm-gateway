import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../src/http/server.js";
import type { AdapterRegistry } from "../src/core/adapters.js";
import type {
  Adapter,
  AdapterAlias,
  AdapterAvailability,
  AdapterGenerateInput,
  AdapterGenerateResult,
  ResolvedAdapterConfig
} from "../src/core/types.js";

class NoopAdapter implements Adapter {
  lastGeneratedPrompt: string | null = null;

  constructor(readonly id: AdapterAlias) {}

  async checkAvailability(): Promise<AdapterAvailability> {
    return {
      alias: this.id,
      adapter: this.id,
      enabled: true,
      available: true,
      reason: null
    };
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateResult> {
    this.lastGeneratedPrompt = input.prompt;

    return {
      inputTokens: 1,
      cachedInputTokens: null,
      outputText: "ok",
      outputTokens: 1
    };
  }
}

class MockCodexAppServerAdapter extends NoopAdapter {
  lastCachedSystemPrompt: string | null = null;
  lastCachedUserPrompt: string | null = null;

  constructor() {
    super("codex-app-server");
  }

  override async generate(input: AdapterGenerateInput): Promise<AdapterGenerateResult> {
    this.lastGeneratedPrompt = input.prompt;

    return {
      inputTokens: 10,
      cachedInputTokens: null,
      outputText: "normal",
      outputTokens: 2
    };
  }

  async generateWithSystemPrompt(input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly providerModel: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<AdapterGenerateResult> {
    this.lastCachedSystemPrompt = input.systemPrompt;
    this.lastCachedUserPrompt = input.prompt;

    return {
      inputTokens: 10,
      cachedInputTokens: 7,
      outputText: "seeded",
      outputTokens: 2
    };
  }
}

const adapterConfigs = {
  codex: {
    alias: "codex",
    adapter: "codex",
    enabled: true,
    defaultProviderModel: "gpt-5.2",
    fallbackProviderModels: [],
    command: {
      program: "/tmp/qodex",
      args: []
    }
  },
  "codex-app-server": {
    alias: "codex-app-server",
    adapter: "codex-app-server",
    enabled: true,
    defaultProviderModel: "gpt-5.2",
    fallbackProviderModels: [],
    command: {
      program: "/tmp/qodex-app-server",
      args: []
    }
  },
  gemini: {
    alias: "gemini",
    adapter: "gemini",
    enabled: true,
    defaultProviderModel: "gemini-3.1-flash-lite-preview",
    fallbackProviderModels: ["gemini-3-flash-preview"],
    command: {
      program: "/tmp/qgemini",
      args: []
    }
  }
} satisfies Record<AdapterAlias, ResolvedAdapterConfig>;

function createRegistry(codexAppServerAdapter: MockCodexAppServerAdapter, codexAdapter = new NoopAdapter("codex")): AdapterRegistry {
  return {
    adapters: new Map<AdapterAlias, Adapter>([
      ["codex", codexAdapter],
      ["codex-app-server", codexAppServerAdapter],
      ["gemini", new NoopAdapter("gemini")]
    ]),
    health: async () => [],
    close: async () => undefined
  };
}

test("codex app-server generate with systemPrompt uses cached path and exposes cachedInputTokens", async () => {
  const codexAppServerAdapter = new MockCodexAppServerAdapter();
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: []
    },
    adapterConfigs,
    adapterRegistry: createRegistry(codexAppServerAdapter)
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex-app-server",
      systemPrompt: "shared instructions",
      userPrompt: "document payload"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(codexAppServerAdapter.lastCachedSystemPrompt, "shared instructions");
  assert.equal(codexAppServerAdapter.lastCachedUserPrompt, "document payload");
  assert.equal(codexAppServerAdapter.lastGeneratedPrompt, null);
  assert.equal(response.json().cachedInputTokens, 7);

  await server.close();
});

test("codex app-server generate without systemPrompt uses one-off path", async () => {
  const codexAppServerAdapter = new MockCodexAppServerAdapter();
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: []
    },
    adapterConfigs,
    adapterRegistry: createRegistry(codexAppServerAdapter)
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex-app-server",
      userPrompt: "document payload"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(codexAppServerAdapter.lastGeneratedPrompt, "document payload");
  assert.equal(codexAppServerAdapter.lastCachedSystemPrompt, null);
  assert.equal(response.json().cachedInputTokens, null);

  await server.close();
});

test("codex generate still uses normal prompt assembly when systemPrompt is present", async () => {
  const codexAdapter = new NoopAdapter("codex");
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: []
    },
    adapterConfigs,
    adapterRegistry: createRegistry(new MockCodexAppServerAdapter(), codexAdapter)
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex",
      systemPrompt: "shared instructions",
      userPrompt: "document payload"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(codexAdapter.lastGeneratedPrompt ?? "", /System:\nshared instructions/);
  assert.match(codexAdapter.lastGeneratedPrompt ?? "", /User:\ndocument payload/);

  await server.close();
});
