import test from "node:test";
import assert from "node:assert/strict";

import { parseCodexResult } from "../src/adapters/codex/parser.js";
import { shouldRetryGeminiWithFallback } from "../src/adapters/gemini/retry.js";
import { buildPrompt } from "../src/core/prompt.js";
import { resolveEffectiveModelSelection } from "../src/core/router.js";
import { loadRuntimeConfig, parseStartupOptions } from "../src/config/runtime.js";

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
} as const;

test("buildPrompt returns only user prompt when system prompt is omitted", () => {
  assert.equal(buildPrompt("classify this"), "classify this");
});

test("buildPrompt combines system and user prompts when both are provided", () => {
  assert.equal(
    buildPrompt("classify this", "Return JSON"),
    "System:\nReturn JSON\n\nUser:\nclassify this"
  );
});

test("resolveEffectiveModelSelection uses adapter default model", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "codex",
      userPrompt: "classify this"
    },
    { adapterConfigs }
  );

  assert.equal(selection.providerModel, "gpt-5.2");
  assert.equal(selection.adapterId, "codex");
});

test("resolveEffectiveModelSelection prefers request override", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemini",
      userPrompt: "classify this",
      providerModel: "gemini-2.5-flash"
    },
    { adapterConfigs }
  );

  assert.equal(selection.providerModel, "gemini-2.5-flash");
});

test("resolveEffectiveModelSelection uses configured Gemini default and fallback models", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemini",
      userPrompt: "classify this"
    },
    { adapterConfigs }
  );

  assert.equal(selection.providerModel, "gemini-3.1-flash-lite-preview");
  assert.deepEqual(selection.fallbackProviderModels, ["gemini-3-flash-preview"]);
});

test("resolveEffectiveModelSelection suppresses fallback models for explicit overrides", () => {
  const selection = resolveEffectiveModelSelection(
    {
      model: "gemini",
      userPrompt: "classify this",
      providerModel: "gemini-3-flash-preview"
    },
    { adapterConfigs }
  );

  assert.equal(selection.providerModel, "gemini-3-flash-preview");
  assert.deepEqual(selection.fallbackProviderModels, []);
});

test("parseStartupOptions reads adapter skip flags", () => {
  const options = parseStartupOptions(["--skip-codex"]);

  assert.deepEqual(options.skipAliases, ["codex"]);
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
              text: "hello"
            }
          ]
        }
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 123,
          output_tokens: 9
        }
      })
    ].join("\n")
  );

  assert.equal(result.outputText, "hello");
  assert.equal(result.inputTokens, 123);
  assert.equal(result.outputTokens, 9);
});

test("parseCodexResult extracts output from agent_message text field", () => {
  const result = parseCodexResult(
    [
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "Hello there, nice to meet you."
        }
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 5203,
          output_tokens: 12
        }
      })
    ].join("\n")
  );

  assert.equal(result.outputText, "Hello there, nice to meet you.");
  assert.equal(result.inputTokens, 5203);
  assert.equal(result.outputTokens, 12);
});

test("shouldRetryGeminiWithFallback detects retryable quota-style failures", () => {
  assert.equal(
    shouldRetryGeminiWithFallback({
      stderr: "Attempt 1 failed: You have exhausted your capacity on this model."
    }),
    true
  );
});

test("shouldRetryGeminiWithFallback ignores non-retryable failures", () => {
  assert.equal(
    shouldRetryGeminiWithFallback({
      stderr: "Authentication failed."
    }),
    false
  );
});
