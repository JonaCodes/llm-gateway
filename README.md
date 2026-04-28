# llm-gateway

`llm-gateway` is a local HTTP server for LLM backends reachable from your machine, including local Ollama models and subscription-backed CLIs like Codex and Gemini.

# Why I built this

When developing locally, I don't want to burn real money on testing. But I _do_ want to run a real flow that goes to a real model. In theory I could output the prompt, copy-paste it to codex/gemini - but that's barbaric.

So I made this to expose the CLI-based LLMs as a local HTTP service. Then I added support for local models as well, because it made sense to unify that.

## Note

Everything except for the section above and this note is, obviously, LLM-generated. It's not pretending to be a super-production project. It is literally for local dev.

Enjoy シ

## Quick Start

Install dependencies and start the server:

```bash
pnpm install
pnpm dev
```

The server listens on `http://127.0.0.1:4317`.

## Requirements

- `codex` must be installed and logged in once if you want Codex routes
- `gemini` must be installed and logged in once if you want Gemini routes
- Ollama must be installed locally if you want Ollama-backed models

The repo-owned `qodex`, `qodex-app-server`, and `qgemini` wrappers bootstrap their lean minimal-home setup automatically on first use.

## Request Shape

Requests go to `POST /v1/generate` and use a messages-based body:

```json
{
  "model": "codex",
  "messages": [
    { "role": "system", "content": "Answer briefly and directly." },
    { "role": "user", "content": "What color is the sky?" }
  ]
}
```

Supported message roles:

- `system`
- `user`

`system` messages must come before `user` messages.

## Which Model To Use

- `codex-app-server`
  - long-lived Codex process
  - best for repeated requests with the same shared instructions (e.g. large system prompts for tagging or extraction tasks)
  - supports internal prompt reuse and `cachedInputTokens`
- `codex`
  - one-shot Codex execution
  - simpler path for low-volume requests
- `gemini`
  - Gemini with configured default/fallback model behavior
- `gemma`
  - family alias for the default local Gemma path on Ollama
- `gemma4-e2b`, `gemma4-e4b`
  - pinned Gemma aliases
- raw provider models
  - `gpt-5.2`
  - `gemini-3.1-flash-lite-preview`
  - `gemma4:e2b`
  - other Ollama `name:tag` models

## Notes

- Ollama-backed models support `options.thinking`
- `codex-app-server` is the main optimization path when many requests share the same system prompt
- `/health` reports adapter availability

## Examples

- [docs/EXAMPLES.md](/Users/jona/Documents/projects/local-llms/docs/EXAMPLES.md)

## Read Next

- [docs/ARCHITECTURE.md](/Users/jona/Documents/projects/local-llms/docs/ARCHITECTURE.md)
- [docs/QODEX.md](/Users/jona/Documents/projects/local-llms/docs/QODEX.md)
- [docs/GEMINI.md](/Users/jona/Documents/projects/local-llms/docs/GEMINI.md)
- [docs/QGEMINI.md](/Users/jona/Documents/projects/local-llms/docs/QGEMINI.md)
