# Architecture

## Request Flow

1. Fastify receives `POST /v1/generate`.
2. Request body is validated in [src/http/schemas.ts](/Users/jona/Documents/projects/local-llms/src/http/schemas.ts).
3. The router resolves the public model alias to an adapter and effective provider model in [src/core/router.ts](/Users/jona/Documents/projects/local-llms/src/core/router.ts).
4. For normal requests, the prompt is assembled in [src/core/prompt.ts](/Users/jona/Documents/projects/local-llms/src/core/prompt.ts).
5. For seeded `codex-app-server` requests, the route bypasses prompt assembly and sends only the per-request user payload into a forked child thread.
6. The adapter either shells out through [src/utils/process.ts](/Users/jona/Documents/projects/local-llms/src/utils/process.ts) or uses a provider-specific persistent transport.
7. The route normalizes the result into the public response shape in [src/http/routes.ts](/Users/jona/Documents/projects/local-llms/src/http/routes.ts).

## Key Modules

- `src/http`
  - Fastify server, routes, validation, response mapping
- `src/core`
  - shared domain types, prompt assembly, adapter registry, alias routing
- `src/adapters/codex`
  - Codex execution and JSONL parsing
- `src/adapters/codex-app-server`
  - persistent Codex app-server transport over stdio JSON-RPC
  - optional in-memory seed registry for warmed base-instruction threads
  - `client.ts` owns process startup, JSON-RPC wiring, and request orchestration
  - `thread-client.ts` owns thread/turn RPC helpers; `process-lifecycle.ts` owns child-process error/close handling
- `src/adapters/gemini`
  - Gemini plain-text execution and fallback-model retry logic
- `src/config`
  - typed loading of checked-in adapter config and runtime flags
- `bin/`
  - repo-owned wrappers that mirror the lean shell wrappers

## Codex Adapter Variants

- `codex`
  - shells out to `codex exec` for each request
- `codex-app-server`
  - starts one long-lived `codex app-server` subprocess and speaks stdio JSON-RPC to it
  - creates an ephemeral Codex thread for each request, then unsubscribes when the turn completes
  - can also warm a persistent seed thread via `POST /v1/codex-app-server/seeds` and fork ephemeral child threads from it on seeded generate requests
  - currently serializes generations through one shared client to keep transport state simple
  - uses repo-owned wrapper [bin/qodex-app-server](/Users/jona/Documents/projects/local-llms/bin/qodex-app-server) so app-server requests run with the minimal Codex home by default

`codex-app-server` exists to reduce repeated Codex startup cost without changing the public HTTP API.

## Adapter Contract

Each adapter implements:

- `checkAvailability()`
- `generate()`

The server should only know about the shared adapter interface. Provider-specific details stay inside the adapter directory.

`codex-app-server` also exposes a narrow seed-management capability used only by the Codex seed route and seeded generate flow. That capability is intentionally not part of the base adapter contract.

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
- the Codex app-server client reuses one child process, buffers stderr for error reporting, and tears the child down on server close

## Codex App-Server Seed Flow

- `POST /v1/codex-app-server/seeds` creates or reuses a non-ephemeral seed thread keyed by a logical `seedKey`
- the seed thread stores shared instructions through `baseInstructions`
- seed creation also runs one small internal warm-up turn so the thread has a forkable rollout
- warmed seed threads stay loaded in the live shared app-server process so later `thread/fork` calls can reuse them
- the adapter keeps only lightweight in-memory metadata for each seed: `seedKey`, `threadId`, `providerModel`, prompt hash, and timestamps
- repeated warm-up with the same `seedKey`, normalized prompt, and provider model returns `reused`
- repeated warm-up with the same `seedKey` but changed prompt or provider model creates a fresh seed, swaps the in-memory mapping, and best-effort archives the old thread
- `POST /v1/generate` with `model: "codex-app-server"` and `seedKey` forks an ephemeral child thread from the stored seed and sends only the request-specific user prompt
- seeded mappings are runtime-only, tied to the current live app-server process, and are lost on process restart
- if a stored seed proves stale during `thread/fork`, the adapter drops that mapping and returns `seed_not_found` so the client can re-warm it

## Codex App-Server Defaults

The current `codex-app-server` transport is intentionally conservative:

- approval policy: `never`
- sandbox: `read-only`
- working directory: `/tmp`

Those defaults live in the adapter implementation, not the public API. Keep that split unless there is a clear product reason to expose more provider-specific knobs.

## Current Non-Goals

- streaming responses
- chat/messages array support
- provider SDK compatibility
