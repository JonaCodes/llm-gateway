# Phone PWA Relay

Host-agnostic phone-as-worker prototype for `llm-gateway`.

The PWA runs inference in the Android browser through WebLLM/WebGPU. The relay is a generic local Node service that accepts Mac-side HTTP jobs and forwards them to the phone over a WebSocket. The static PWA can be hosted on Cloudflare Pages, Supabase hosting, Vercel, Netlify, or any HTTPS static host.

## Layout

- `pwa/` - static phone worker UI.
- `relay/` - local Node WebSocket/HTTP relay for first tests.
- `shared/` - protocol types shared by the PWA and relay.

## Install

```bash
cd phone-pwa-relay
pnpm install
```

## Local Test Loop

Start the relay on the Mac:

```bash
pnpm dev:relay
```

Start the PWA dev server:

```bash
pnpm dev:pwa
```

Open the PWA on the Android phone. Use a relay URL that the phone can reach, for example:

```text
ws://MAC_LAN_IP:8787/worker
```

Use the same session id and token in the PWA and in the gateway environment:

```bash
export LOCAL_LLMS_PHONE_PWA_SESSION=default
export LOCAL_LLMS_PHONE_PWA_TOKEN=dev-token
```

Enable a phone alias in `../config/adapters.json` by setting `enabled` to `true` for `gemma-phone`, then start the gateway from the repo root:

```bash
pnpm dev
```

Call the gateway:

```bash
curl -s http://127.0.0.1:4317/v1/generate \
  -H 'content-type: application/json' \
  -d '{
    "model": "gemma-phone",
    "messages": [
      { "role": "user", "content": "Reply with exactly: phone worker ok" }
    ]
  }'
```

## Deploy Notes

For Cloudflare Pages or any static host, deploy only the PWA build output:

```bash
pnpm build:pwa
```

The relay is intentionally not tied to Cloudflare. It can run locally, on a small Node host, or be replaced later by a WebSocket-capable edge/runtime service that implements the same protocol:

- `WS /worker?session=<id>&token=<token>`
- `GET /sessions/:sessionId/status`
- `POST /sessions/:sessionId/jobs`

## Model Notes

The default PWA model is a small WebLLM model for first connectivity tests. Exact Gemma E4B support depends on what WebLLM can run well in the Android browser. If browser performance is not acceptable, keep the relay/gateway protocol and replace the PWA inference engine with a native Android worker later.
