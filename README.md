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
