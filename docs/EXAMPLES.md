# Examples

## Health

```bash
curl -s http://127.0.0.1:4317/health
```

## Codex

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "codex",
    "messages": [
      { "role": "user", "content": "Reply with exactly: codex ok" }
    ]
  }'
```

## Codex App Server

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "codex-app-server/gpt-5.2",
    "messages": [
      { "role": "system", "content": "Answer briefly and directly." },
      { "role": "user", "content": "Reply with exactly: codex app server ok" }
    ]
  }'
```

## Gemini

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "gemini",
    "messages": [
      { "role": "user", "content": "Reply with exactly: gemini ok" }
    ]
  }'
```

## Gemma / Ollama

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "gemma4:e2b",
    "messages": [
      { "role": "system", "content": "Answer briefly and directly." },
      { "role": "user", "content": "Reply with exactly: gemma ok" }
    ],
    "options": {
      "thinking": false
    }
  }'
```
