# `qgemini`

`qgemini` is the Gemini CLI analogue of `qodex`, but the mechanism is different.

Codex supports a separate `CODEX_HOME`. Gemini CLI does not expose a comparable `GEMINI_HOME`, so `qgemini` works by:

- running Gemini with a different `HOME`
- keeping that alternate `~/.gemini` minimal
- overriding the built-in system prompt with `GEMINI_SYSTEM_MD`
- disabling extensions with `-e none`

## Installed setup

`qgemini` uses `~/.gemini-min-home/.gemini/`.

That minimal home contains:

- a tiny `settings.json`
- a tiny `system.md`
- symlinks to the normal Gemini auth files

The wrapper in `~/.zshrc` is:

```sh
qgemini() {
  local gh="$HOME/.gemini-min-home"

  if [[ "$1" == -* ]]; then
    HOME="$gh" \
    GEMINI_SYSTEM_MD="$gh/.gemini/system.md" \
    gemini -e none "$@"
  else
    HOME="$gh" \
    GEMINI_SYSTEM_MD="$gh/.gemini/system.md" \
    gemini -e none -p "$*"
  fi
}
```

The system prompt is intentionally minimal:

```md
Answer briefly and directly.
If the request can be answered from general knowledge, answer in one short response.
```

## Why use it

- Keeps one-off prompts lighter.
- Avoids loading your normal `~/.gemini/GEMINI.md`, skills, history, and extensions.
- Leaves normal `gemini` behavior unchanged.

## Gotchas

- Plain `gemini` is unchanged. Only `qgemini` uses the alternate home.
- `qgemini "prompt"` forces headless mode by adding `-p`.
- `qgemini --output-format json -p "prompt"` passes flags through directly.
- `-e none` matters. Gemini loads all available extensions by default.
- Gemini can load user and project context files; the minimal home disables the user-level context filename to keep the prompt smaller.
- Gemini supports a full built-in system-prompt override through `GEMINI_SYSTEM_MD`; that is the closest analogue to the `qodex` prompt minimization trick.
- Auth is the fragile part. If Gemini asks you to log in again, the minimal home is missing something your current auth flow expects.
