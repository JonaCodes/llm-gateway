# Gemini Notes

Gemini support is intentionally simpler than Codex support.

## Current Behavior

- Gemini uses plain-text `qgemini` execution only
- no structured output mode
- no Gemini token collection
- response returns:
  - `inputTokens: null`
  - `outputTokens: null`

This is deliberate. Structured Gemini mode was slower and less reliable than plain prompt execution.

## Model Strategy

Default server model:

- `gemini-3.1-flash-lite-preview`

Automatic fallback model:

- `gemini-3-flash-preview`

Fallback happens only for retryable capacity/rate-limit style failures detected from Gemini stderr/stdout. If both models fail, the request returns an error.

If the request explicitly sets `providerModel`, the adapter does not rotate models. That request is treated as an exact override.

## Why This Differs From Codex

Codex exposes structured JSONL output that is useful enough to parse for final text and token usage.

Gemini CLI, in this setup, is better treated as a plain text backend:

- more predictable
- closer to the real `qgemini "..."` shell behavior
- lower complexity

## When Editing Gemini Support

- preserve the minimal-home wrapper behavior in [bin/qgemini](/Users/jona/Documents/projects/local-llms/bin/qgemini)
- do not reintroduce structured Gemini output unless there is a clear speed and reliability win
- keep fallback behavior narrow and explicit
