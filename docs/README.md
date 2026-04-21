# Local LLMs Docs

This project is a small local HTTP gateway over private LLM backends. The public API is intentionally custom and task-oriented, not OpenAI-compatible.

## Current Scope

- Node + TypeScript server
- `POST /v1/generate`
- `GET /health`
- Public models:
  - `codex`
  - `codex-app-server`
  - `gemini`

The request shape is:

```json
{
  "model": "codex",
  "systemPrompt": "optional",
  "userPrompt": "required",
  "providerModel": "optional override"
}
```

The response shape is:

```json
{
  "id": "req_...",
  "model": "codex",
  "providerModel": "gpt-5.2",
  "inputTokens": 123,
  "outputText": "final text",
  "outputTokens": 9,
  "durationMs": 1200,
  "adapter": "codex"
}
```

## Quick Start

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

## Where To Look

- [ARCHITECTURE.md](/Users/jona/Documents/projects/local-llms/docs/ARCHITECTURE.md)
- [GEMINI.md](/Users/jona/Documents/projects/local-llms/docs/GEMINI.md)
- [QODEX.md](/Users/jona/Documents/projects/local-llms/QODEX.md)
- [QGEMINI.md](/Users/jona/Documents/projects/local-llms/QGEMINI.md)

## Current Priorities

- Keep the server lean
- Keep adapter behavior explicit
- Avoid adding provider-specific surface area to the public API unless necessary
- Prefer checked-in config over hidden runtime magic
