# Local LLMs

This project is a standalone local HTTP gateway for LLM backends reachable through local runtimes, **including subscription-backed CLIs like Codex and Gemini**. Other repositories can run against it over HTTP, while provider-specific behavior stays isolated inside adapters.

# Why I built this

When developing locally, I don't want to burn real money on testsing. But I _do_ want to run a real flow that goes to a real model. In theory I could output the prompt, copy-paste it to codex/gemini - but that's barbaric.

So I made this to expose the CLI-based LLMs as a local HTTP service. Then I added support for local models as well, because it made sense to unify that.

## Which Path To Use

- `codex-app-server` with automatic prompt reuse
  - recommended for repeated work where many requests share the same system prompt
  - best fit for tagging, classification, extraction, or any batch process over many items
  - the server internally reuses a warmed seed derived from `systemPrompt + providerModel`, then forks child threads so later requests can benefit from cache reuse
- `codex`
  - useful as a simple one-shot Codex path
  - best for convenience, debugging, or low-volume requests
- `gemini`
  - useful when you explicitly want the Gemini backend or its fallback behavior
- `gemma4-e2b` / `gemma4-e4b`
  - local Gemma 4 edge-model paths backed by Ollama
  - no-thinking is the default path
  - set `options.thinking: true` only when you explicitly want reasoning output

## Why Prompt Reuse Matters

The `codex-app-server` prompt-reuse path is the main optimization path in this repo.

If you have a large stable system prompt and many different user payloads, this path lets you:

- warm the shared prompt once
- fork isolated child runs for each item
- avoid growing one long conversation forever
- **take advantage of `cachedInputTokens`** when the backend reuses the shared prefix

That is the path to prefer for workloads like tagging hundreds of documents with the same instructions. The other paths are still useful, but they are mainly conveniences or one-offs.

Example:

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "codex-app-server",
    "systemPrompt": "Large shared tagging instructions (e.g system prompt) go here",
    "userPrompt": "Document payload 1"
  }'
```

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "codex-app-server",
    "systemPrompt": "Large shared tagging instructions (e.g system prompt) go here",
    "userPrompt": "Document payload 2"
  }'
```

For `codex-app-server`, repeated requests with the same `systemPrompt + providerModel` automatically reuse the same internal seed. In practice, **the first request does not always show a cache hit**, but follow-up requests often do. Check `cachedInputTokens` in the response rather than assuming every request will report reuse identically.

For Gemma 4 on Ollama, v1 cache behavior is intentionally narrower: the server keeps the model warm via Ollama `keep_alive`, but does not claim prompt-prefix reuse accounting. Gemma responses therefore return `cachedInputTokens: null`.

Default no-thinking example:

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "gemma4-e2b",
    "systemPrompt": "Answer briefly and directly.",
    "userPrompt": "Summarize KV cache reuse in one sentence.",
    "options": {
      "thinking": false
    }
  }'
```

If you omit `options` entirely, Gemma still runs with no thinking:

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "gemma4-e4b",
    "systemPrompt": "Answer briefly and directly.",
    "userPrompt": "{\"title\":\"Announcing our new desktop app\",\"body\":\"We just launched the first public version today with local sync, offline support, and a redesigned settings screen.\"}"
  }'
```

Typical shell workflow with a large saved system prompt and a JSON payload file:

```bash
SYSTEM_PROMPT=$(cat <<'EOF'
# Editorial Classification

Choose exactly one editorial category for the item

...

Return strict JSON only.
Output schema: tagging.editorial_classification.v1
Respond with a JSON object containing `editorial_category`. `editorial_category` must be exactly one of feature, new_release, useful_tip, help_request, technical_discussion, complaint, incident, fun_story, general_chatter, opinion, other. Use `feature` for discussion about an existing capability or behavior. Use `new_release` when the main news peg is that something was launched, announced, rolled out, or newly released.

Input JSON:
EOF
)

curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d "$(jq -n \
    --arg systemPrompt "$SYSTEM_PROMPT" \
    --arg userPrompt "$(cat input.json)" \
    '{
      model: "gemma4-e4b",
      systemPrompt: $systemPrompt,
      userPrompt: $userPrompt
    }'
  )"
```

Gemma responses include:

- `outputText`
- `thinkingText`
- `inputTokens`
- `outputTokens`
- `cachedInputTokens` as `null`

For the default no-thinking path, expect `thinkingText: null`.

## Quick Start

Run this repo as its own local service, then have other projects call it over HTTP.

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm build
pnpm test
node dist/src/server.js --skip-gemini
node dist/src/server.js --skip-codex
node dist/src/server.js --skip-codex-app-server
```

## Read Next

- [docs/ARCHITECTURE.md](/Users/jona/Documents/projects/local-llms/docs/ARCHITECTURE.md)
- [docs/QODEX.md](/Users/jona/Documents/projects/local-llms/docs/QODEX.md)
- [docs/GEMINI.md](/Users/jona/Documents/projects/local-llms/docs/GEMINI.md)
- [docs/QGEMINI.md](/Users/jona/Documents/projects/local-llms/docs/QGEMINI.md)
