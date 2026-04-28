# `qodex`

`qodex` is a small shell wrapper around `codex exec` that runs Codex with a separate `CODEX_HOME`, typically `~/.codex-min`.

## Why use it

- Keeps one-off questions lightweight (~2s response vs 6-10s on M4 Mac with 16GB RAM).
- Avoids loading your normal Codex skills, plugins, memories, and prompt scaffolding.
- Leaves normal `codex` behavior unchanged.

## How it works

The wrapper sets `CODEX_HOME="$HOME/.codex-min"` only for that command, then calls `codex exec`.

That alternate Codex home can contain:

- a minimal `config.toml`
- a linked or copied `auth.json`

Because the environment override is process-local, plain `codex exec ...` still uses your normal `~/.codex` setup.

## Typical wrappers

```sh
qodex() {
  CODEX_HOME="$HOME/.codex-min" \
    codex exec --skip-git-repo-check -C /tmp "$@"
}

qodexq() {
  local out
  out="$(mktemp)"
  CODEX_HOME="$HOME/.codex-min" \
    codex exec --skip-git-repo-check -C /tmp -o "$out" "$@" 2>/dev/null
  cat "$out"
  rm -f "$out"
}
```

## Examples

```sh
qodex "What color is the sky?"
qodexq "Summarize this in one sentence."
qodex $'Line 1\nLine 2'
```
