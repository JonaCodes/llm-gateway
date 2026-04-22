import test from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../src/http/server.js";
import type { AdapterRegistry } from "../src/core/adapters.js";
import type {
  Adapter,
  AdapterAlias,
  AdapterId,
  AdapterAvailability,
  AdapterGenerateInput,
  AdapterGenerateResult,
  ResolvedAdapterConfig,
} from "../src/core/types.js";

class NoopAdapter implements Adapter {
  lastUserPrompt: string | null = null;
  lastSystemPrompt: string | null = null;
  lastThinking: boolean | null = null;

  constructor(
    readonly id: AdapterId,
    private readonly alias: AdapterAlias,
  ) {}

  async checkAvailability(): Promise<AdapterAvailability> {
    return {
      alias: this.alias,
      adapter: this.id,
      enabled: true,
      available: true,
      reason: null,
    };
  }

  async generate(input: AdapterGenerateInput): Promise<AdapterGenerateResult> {
    this.lastUserPrompt = input.userPrompt;
    this.lastSystemPrompt = input.systemPrompt ?? null;
    this.lastThinking = input.options.thinking;

    return {
      inputTokens: 1,
      cachedInputTokens: null,
      outputText: "ok",
      thinkingText: null,
      outputTokens: 1,
    };
  }
}

class MockCodexAppServerAdapter extends NoopAdapter {
  lastCachedSystemPrompt: string | null = null;
  lastCachedUserPrompt: string | null = null;

  constructor() {
    super("codex-app-server", "codex-app-server");
  }

  override async generate(
    input: AdapterGenerateInput,
  ): Promise<AdapterGenerateResult> {
    this.lastUserPrompt = input.userPrompt;
    this.lastSystemPrompt = input.systemPrompt ?? null;
    this.lastThinking = input.options.thinking;

    if (input.systemPrompt && input.systemPrompt.trim() !== "") {
      this.lastCachedSystemPrompt = input.systemPrompt;
      this.lastCachedUserPrompt = input.userPrompt;

      return {
        inputTokens: 10,
        cachedInputTokens: 7,
        outputText: "seeded",
        thinkingText: null,
        outputTokens: 2,
      };
    }

    return {
      inputTokens: 10,
      cachedInputTokens: null,
      outputText: "normal",
      thinkingText: null,
      outputTokens: 2,
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
    transport: {
      kind: "command",
      program: "/tmp/qodex",
      args: [],
    },
  },
  "codex-app-server": {
    alias: "codex-app-server",
    adapter: "codex-app-server",
    enabled: true,
    defaultProviderModel: "gpt-5.2",
    fallbackProviderModels: [],
    transport: {
      kind: "command",
      program: "/tmp/qodex-app-server",
      args: [],
    },
  },
  gemini: {
    alias: "gemini",
    adapter: "gemini",
    enabled: true,
    defaultProviderModel: "gemini-3.1-flash-lite-preview",
    fallbackProviderModels: ["gemini-3-flash-preview"],
    transport: {
      kind: "command",
      program: "/tmp/qgemini",
      args: [],
    },
  },
  "gemma4-e2b": {
    alias: "gemma4-e2b",
    adapter: "ollama",
    enabled: true,
    defaultProviderModel: "gemma4:e2b",
    fallbackProviderModels: [],
    transport: {
      kind: "http",
      baseUrl: "http://127.0.0.1:11434",
      defaultKeepAlive: "1m",
    },
  },
  "gemma4-e4b": {
    alias: "gemma4-e4b",
    adapter: "ollama",
    enabled: true,
    defaultProviderModel: "gemma4:e4b",
    fallbackProviderModels: [],
    transport: {
      kind: "http",
      baseUrl: "http://127.0.0.1:11434",
      defaultKeepAlive: "1m",
    },
  },
} satisfies Record<AdapterAlias, ResolvedAdapterConfig>;

function createRegistry(
  codexAppServerAdapter: MockCodexAppServerAdapter,
  codexAdapter = new NoopAdapter("codex", "codex"),
  ollamaAdapter = new NoopAdapter("ollama", "gemma4-e2b"),
): AdapterRegistry {
  return {
    adapters: new Map<AdapterAlias, Adapter>([
      ["codex", codexAdapter],
      ["codex-app-server", codexAppServerAdapter],
      ["gemini", new NoopAdapter("gemini", "gemini")],
      ["gemma4-e2b", ollamaAdapter],
      ["gemma4-e4b", new NoopAdapter("ollama", "gemma4-e4b")],
    ]),
    health: async () => [],
    close: async () => undefined,
  };
}

test("codex app-server generate with systemPrompt uses cached path and exposes cachedInputTokens", async () => {
  const codexAppServerAdapter = new MockCodexAppServerAdapter();
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: [],
    },
    adapterConfigs,
    adapterRegistry: createRegistry(codexAppServerAdapter),
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex-app-server",
      systemPrompt: "shared instructions",
      userPrompt: "document payload",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    codexAppServerAdapter.lastCachedSystemPrompt,
    "shared instructions",
  );
  assert.equal(codexAppServerAdapter.lastCachedUserPrompt, "document payload");
  assert.equal(codexAppServerAdapter.lastUserPrompt, "document payload");
  assert.equal(response.json().cachedInputTokens, 7);
  assert.equal(response.json().thinkingText, null);

  await server.close();
});

test("codex app-server generate without systemPrompt uses one-off path", async () => {
  const codexAppServerAdapter = new MockCodexAppServerAdapter();
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: [],
    },
    adapterConfigs,
    adapterRegistry: createRegistry(codexAppServerAdapter),
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex-app-server",
      userPrompt: "document payload",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(codexAppServerAdapter.lastUserPrompt, "document payload");
  assert.equal(codexAppServerAdapter.lastCachedSystemPrompt, null);
  assert.equal(response.json().cachedInputTokens, null);

  await server.close();
});

test("codex generate still uses normal prompt assembly when systemPrompt is present", async () => {
  const codexAdapter = new NoopAdapter("codex", "codex");
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: [],
    },
    adapterConfigs,
    adapterRegistry: createRegistry(
      new MockCodexAppServerAdapter(),
      codexAdapter,
    ),
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex",
      systemPrompt: "shared instructions",
      userPrompt: "document payload",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(codexAdapter.lastSystemPrompt, "shared instructions");
  assert.equal(codexAdapter.lastUserPrompt, "document payload");

  await server.close();
});

test("generate accepts options.thinking and exposes thinkingText", async () => {
  const ollamaAdapter = new NoopAdapter("ollama", "gemma4-e2b");
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: [],
    },
    adapterConfigs,
    adapterRegistry: createRegistry(
      new MockCodexAppServerAdapter(),
      new NoopAdapter("codex", "codex"),
      ollamaAdapter,
    ),
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "gemma4-e2b",
      userPrompt: "document payload",
      options: {
        thinking: true,
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(ollamaAdapter.lastThinking, true);
  assert.equal(response.json().thinkingText, null);

  await server.close();
});
