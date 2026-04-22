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
  CodexAppServerSeedResult,
  ResolvedAdapterConfig
} from "../src/core/types.js";

class NoopAdapter implements Adapter {
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

  async generate(_: AdapterGenerateInput): Promise<AdapterGenerateResult> {
    return {
      inputTokens: 1,
      cachedInputTokens: null,
      outputText: "ok",
      outputTokens: 1
    };
  }
}

class MockCodexAppServerAdapter extends NoopAdapter {
  private readonly seeds = new Map<string, { providerModel: string; threadId: string }>();
  lastGeneratedPrompt: string | null = null;
  lastSeededPrompt: string | null = null;

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

  async warmSeed(input: {
    readonly seedKey: string;
    readonly systemPrompt: string;
    readonly providerModel: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<CodexAppServerSeedResult> {
    const existing = this.seeds.get(input.seedKey);

    if (existing && existing.providerModel === input.providerModel && input.systemPrompt === "seed prompt") {
      return {
        seedKey: input.seedKey,
        providerModel: input.providerModel,
        status: "reused"
      };
    }

    this.seeds.set(input.seedKey, {
      providerModel: input.providerModel,
      threadId: `thread_${input.seedKey}`
    });

    return {
      seedKey: input.seedKey,
      providerModel: input.providerModel,
      status: existing ? "replaced" : "created"
    };
  }

  async generateFromSeed(input: {
    readonly seedKey: string;
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly logger: AdapterGenerateInput["logger"];
  }): Promise<AdapterGenerateResult> {
    this.lastSeededPrompt = input.prompt;

    return {
      inputTokens: 10,
      cachedInputTokens: 7,
      outputText: "seeded",
      outputTokens: 2
    };
  }

  getSeed(seedKey: string) {
    const seed = this.seeds.get(seedKey);

    if (!seed) {
      return null;
    }

    return {
      seedKey,
      threadId: seed.threadId,
      providerModel: seed.providerModel,
      systemPromptHash: "hash",
      createdAt: "now",
      updatedAt: "now"
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

function createRegistry(codexAppServerAdapter: MockCodexAppServerAdapter): AdapterRegistry {
  return {
    adapters: new Map<AdapterAlias, Adapter>([
      ["codex", new NoopAdapter("codex")],
      ["codex-app-server", codexAppServerAdapter],
      ["gemini", new NoopAdapter("gemini")]
    ]),
    health: async () => [],
    close: async () => undefined
  };
}

test("codex app-server seed route warms a seed", async () => {
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
    url: "/v1/codex-app-server/seeds",
    payload: {
      seedKey: "story-tagger",
      systemPrompt: "seed prompt"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    seedKey: "story-tagger",
    providerModel: "gpt-5.2",
    status: "created"
  });

  await server.close();
});

test("seeded generate uses seeded path and exposes cachedInputTokens", async () => {
  const codexAppServerAdapter = new MockCodexAppServerAdapter();
  await codexAppServerAdapter.warmSeed({
    seedKey: "story-tagger",
    systemPrompt: "seed prompt",
    providerModel: "gpt-5.2",
    timeoutMs: 1000,
    logger: consoleLogger
  });

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
      userPrompt: "document payload",
      seedKey: "story-tagger"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(codexAppServerAdapter.lastSeededPrompt, "document payload");
  assert.equal(codexAppServerAdapter.lastGeneratedPrompt, null);
  assert.deepEqual(response.json().cachedInputTokens, 7);

  await server.close();
});

test("generate rejects seedKey with systemPrompt", async () => {
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: []
    },
    adapterConfigs,
    adapterRegistry: createRegistry(new MockCodexAppServerAdapter())
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex-app-server",
      userPrompt: "document payload",
      systemPrompt: "should not be here",
      seedKey: "story-tagger"
    }
  });

  assert.equal(response.statusCode, 400);

  await server.close();
});

test("generate rejects seedKey on non-codex-app-server models", async () => {
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: []
    },
    adapterConfigs,
    adapterRegistry: createRegistry(new MockCodexAppServerAdapter())
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex",
      userPrompt: "document payload",
      seedKey: "story-tagger"
    }
  });

  assert.equal(response.statusCode, 400);

  await server.close();
});

test("generate returns 404 for unknown seed", async () => {
  const server = await createServer({
    runtimeConfig: {
      host: "127.0.0.1",
      port: 4317,
      requestTimeoutMs: 120000,
      skipAliases: []
    },
    adapterConfigs,
    adapterRegistry: createRegistry(new MockCodexAppServerAdapter())
  });

  const response = await server.inject({
    method: "POST",
    url: "/v1/generate",
    payload: {
      model: "codex-app-server",
      userPrompt: "document payload",
      seedKey: "missing"
    }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "seed_not_found");

  await server.close();
});

const consoleLogger: AdapterGenerateInput["logger"] = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => consoleLogger
};
