# Architecture

## Request Flow

1. Fastify receives `POST /v1/generate`.
2. Request body is validated in [src/http/schemas.ts](/Users/jona/Documents/projects/local-llms/src/http/schemas.ts).
3. The router resolves the public model alias to an adapter and effective provider model in [src/core/router.ts](/Users/jona/Documents/projects/local-llms/src/core/router.ts).
4. The prompt is assembled in [src/core/prompt.ts](/Users/jona/Documents/projects/local-llms/src/core/prompt.ts).
5. The adapter shells out through [src/utils/process.ts](/Users/jona/Documents/projects/local-llms/src/utils/process.ts).
6. The route normalizes the result into the public response shape in [src/http/routes.ts](/Users/jona/Documents/projects/local-llms/src/http/routes.ts).

## Key Modules

- `src/http`
  - Fastify server, routes, validation, response mapping
- `src/core`
  - shared domain types, prompt assembly, adapter registry, alias routing
- `src/adapters/codex`
  - Codex execution and JSONL parsing
- `src/adapters/gemini`
  - Gemini plain-text execution and fallback-model retry logic
- `src/config`
  - typed loading of checked-in adapter config and runtime flags
- `bin/`
  - repo-owned wrappers that mirror the lean shell wrappers

## Adapter Contract

Each adapter implements:

- `checkAvailability()`
- `generate()`

The server should only know about the shared adapter interface. Provider-specific details stay inside the adapter directory.

## Config Shape

[config/adapters.json](/Users/jona/Documents/projects/local-llms/config/adapters.json) is the source of truth for:

- public alias
- adapter id
- default provider model
- fallback provider models
- wrapper command

If a request explicitly passes `providerModel`, that override wins and adapter-level fallback models are disabled for that request.

## Logging And Timeouts

- Fastify logging is enabled at `info`
- each request gets a request-scoped logger
- subprocesses log start, completion, timeout, and kill escalation
- subprocess timeout is a hard budget, including Gemini fallback attempts

## Current Non-Goals

- streaming responses
- chat/messages array support
- provider SDK compatibility
- persistent worker pools
- Codex app-server integration
