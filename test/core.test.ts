import test from "node:test";
import assert from "node:assert/strict";

import { parseCodexResult } from "../src/adapters/codex/parser.js";
import { shouldRetryGeminiWithFallback } from "../src/adapters/gemini/retry.js";
import { buildPrompt } from "../src/core/prompt.js";
import { resolveEffectiveModelSelection } from "../src/core/router.js";
import {
  loadRuntimeConfig,
  parseStartupOptions,
} from "../src/config/runtime.js";

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
} as const;

test("buildPrompt returns only user prompt when system prompt is omitted", () => {
  assert.equal(buildPrompt("classify this"), "classify this");
});

test("buildPrompt combines system and user prompts when both are provided", () => {
  assert.equal(
    buildPrompt("classify this", "Return JSON"),
    "System:\nReturn JSON\n\nUser:\nclassify this",
  );
});

test("resolveEffectiveModelSelection uses adapter default model", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "codex",
      userPrompt: "classify this",
    },
    { adapterConfigs },
  );

  assert.equal(selection.providerModel, "gpt-5.2");
  assert.equal(selection.adapterId, "codex");
});

test("resolveEffectiveModelSelection uses codex app-server default model", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "codex-app-server",
      userPrompt: "classify this",
    },
    { adapterConfigs },
  );

  assert.equal(selection.providerModel, "gpt-5.2");
  assert.equal(selection.adapterId, "codex-app-server");
});

test("resolveEffectiveModelSelection prefers request override", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemini",
      userPrompt: "classify this",
      providerModel: "gemini-2.5-flash",
    },
    { adapterConfigs },
  );

  assert.equal(selection.providerModel, "gemini-2.5-flash");
});

test("resolveEffectiveModelSelection uses configured Gemini default and fallback models", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemini",
      userPrompt: "classify this",
    },
    { adapterConfigs },
  );

  assert.equal(selection.providerModel, "gemini-3.1-flash-lite-preview");
  assert.deepEqual(selection.fallbackProviderModels, [
    "gemini-3-flash-preview",
  ]);
});

test("resolveEffectiveModelSelection maps Gemma alias to Ollama adapter", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemma4-e2b",
      userPrompt: "classify this",
    },
    { adapterConfigs },
  );

  assert.equal(selection.adapterId, "ollama");
  assert.equal(selection.providerModel, "gemma4:e2b");
});

test("resolveEffectiveModelSelection suppresses fallback models for explicit overrides", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemini",
      userPrompt: "classify this",
      providerModel: "gemini-3-flash-preview",
    },
    { adapterConfigs },
  );

  assert.equal(selection.providerModel, "gemini-3-flash-preview");
  assert.deepEqual(selection.fallbackProviderModels, []);
});

test("parseStartupOptions reads adapter skip flags", () => {
  const options = parseStartupOptions(["--skip-codex", "--skip-gemma4-e2b"]);

  assert.deepEqual(options.skipAliases, ["codex", "gemma4-e2b"]);
});

test("loadRuntimeConfig falls back to defaults", () => {
  const config = loadRuntimeConfig({}, { skipAliases: [] });

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4317);
  assert.equal(config.requestTimeoutMs, 120000);
});

test("parseCodexResult extracts output and token usage from jsonl", () => {
  const result = parseCodexResult(
    [
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          content: [
            {
              type: "output_text",
              text: "hello",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 123,
          output_tokens: 9,
        },
      }),
    ].join("\n"),
  );

  assert.equal(result.outputText, "hello");
  assert.equal(result.inputTokens, 123);
  assert.equal(result.cachedInputTokens, null);
  assert.equal(result.outputTokens, 9);
  assert.equal(result.thinkingText, null);
});

test("parseCodexResult extracts output from agent_message text field", () => {
  const result = parseCodexResult(
    [
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "Hello there, nice to meet you.",
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 5203,
          output_tokens: 12,
        },
      }),
    ].join("\n"),
  );

  assert.equal(result.outputText, "Hello there, nice to meet you.");
  assert.equal(result.inputTokens, 5203);
  assert.equal(result.cachedInputTokens, null);
  assert.equal(result.outputTokens, 12);
  assert.equal(result.thinkingText, null);
});

test("shouldRetryGeminiWithFallback detects retryable quota-style failures", () => {
  assert.equal(
    shouldRetryGeminiWithFallback({
      stderr:
        "Attempt 1 failed: You have exhausted your capacity on this model.",
    }),
    true,
  );
});

test("shouldRetryGeminiWithFallback ignores non-retryable failures", () => {
  assert.equal(
    shouldRetryGeminiWithFallback({
      stderr: "Authentication failed.",
    }),
    false,
  );
});
