# Codex Classifier Handoff

## Goal

Build a subscription-backed classification pipeline for Reddit posts, blog posts, and similar text items.

Each item should be sent to Codex with:

- one stable classification instruction block
- one per-item content payload

The system prompt stays the same across items. The main optimization goal is to reuse that shared prompt context as efficiently as possible while staying on the user's ChatGPT/Codex subscription rather than moving to paid API usage.

## What We Are Optimizing For

- Use Codex subscription limits, not API billing.
- Minimize repeated prompt overhead across many classification calls.
- Keep each classification isolated so one item does not pollute the next.
- Make the pipeline scriptable and non-interactive.

## What Was Learned

### `qodex`

`qodex` was created as a lean wrapper around `codex exec` using a stripped-down `CODEX_HOME`.

That reduced prompt overhead significantly for simple calls, but it did **not** solve the batching/classification problem by itself.

Observed behavior:

- Fresh one-shot `qodex` calls with the same long repeated prefix did **not** show meaningful cache reuse.
- Reusing a thread with `codex exec resume` did show large `cached_input_tokens`.
- But resuming the same thread causes history growth, so total input keeps increasing over time.

### Standard CLI forking

Standard Codex CLI has a `fork` command, but it is interactive/TUI-oriented.

Important limitation:

- there is currently no normal headless `codex exec fork ...` path
- `codex fork ...` opens the interactive UI

That makes plain CLI forking awkward for a production pipeline.

### Codex app-server

This is the chosen direction.

Codex app-server exposes JSON-RPC thread operations, including:

- `thread/start`
- `thread/resume`
- `thread/fork`
- `turn/start`

This matters because it allows the desired pattern:

1. seed one thread once with the long, stable classifier instructions
2. fork from that seed for each item
3. send only the item content to the fork
4. read back the JSON classification result

This is the closest match to the target workflow:

- stable shared prompt
- isolated per-item runs
- no thread-history explosion in the seed thread
- subscription-backed Codex usage

## Chosen Architecture

Use `codex app-server` as the transport layer for the classification worker.

### Intended flow

1. Start `codex app-server`.
2. Initialize a JSON-RPC client.
3. Create one seed thread with the stable classifier prompt.
4. Save the returned seed thread id.
5. For each post/item:
   - call `thread/fork` from the seed thread
   - prefer `ephemeral: true` for the forked child if that fits the implementation
   - call `turn/start` on the forked thread with only the item payload
   - parse the model response as JSON
6. Discard the forked child thread after reading the result.

### Why this is the best current option

- Fresh one-shot `qodex` did not show useful repeated-prefix caching.
- `resume` alone accumulates too much history.
- App-server exposes true programmatic forking, which matches the pipeline need directly.

## Prompting Shape

The stable classifier instructions should be loaded once into the seed thread.

Each item turn should contain only the per-item payload, for example:

- title
- body
- optional metadata/source fields if needed

The next agent should preserve this rule:

- do **not** resend the full classifier prompt for every item

## Model / Runtime Guidance

- Keep the model fixed across tests and production runs.
- Prefer the lightest reasoning setup that still classifies reliably.
- Since this is structured classification, optimize for deterministic output and throughput, not elaborate reasoning.

## Existing Local Docs To Copy Into The New Project

These were created during exploration and should be copied over for context:

- [QODEX.md](/Users/jona/Documents/projects/google-reichman-projects/cr/QODEX.md)
- [QGEMINI.md](/Users/jona/Documents/projects/google-reichman-projects/cr/QGEMINI.md)

They are background docs only. The implementation direction for this project is the Codex app-server approach described here.

## What The Next Agent Should Do First

1. Create a tiny local client for `codex app-server`.
2. Prove the end-to-end flow:
   - initialize
   - `thread/start`
   - `thread/fork`
   - `turn/start`
3. Seed the classifier prompt once and classify two sample items via forks.
4. Inspect usage on the forked runs to verify whether cached input is improving relative to fresh one-shot execution.
5. Wrap the working flow in a small reusable CLI/script for batch classification.

## Success Criteria

The project should be considered on the right track when all of the following are true:

- one seed thread is created once
- multiple items can be classified without resending the seed prompt
- each item runs on its own forked thread
- output is valid JSON with the requested schema
- the system is fully non-interactive
