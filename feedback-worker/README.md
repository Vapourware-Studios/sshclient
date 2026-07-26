# sshclient feedback worker

A small, stateless Cloudflare Worker that relays in-app feedback from the
sshclient desktop app to a Discord channel. It stores nothing — every
request either becomes one Discord message or is rejected.

```
Electron app (Settings → Feedback) → this Worker → Discord webhook
```

## Why it's shaped this way

- **Discord webhook URL never touches the client.** The app only ever talks
  to this Worker; the webhook URL lives as a Worker secret. If it ever leaks
  or gets abused, rotate it in Discord and update the secret — the app needs
  no changes.
- **No shared client secret / CAPTCHA.** This repo is public and the desktop
  app ships as an (effectively) unpacked Electron bundle, so anything
  hardcoded in `src/main/main.js` to "authenticate" requests would be
  visible to anyone who reads the source or unpacks the app — it would be
  security theater, not security. Abuse resistance instead comes from the
  rate limits below plus Discord-side mention stripping. If spam becomes a
  real problem, the next real step up is Cloudflare Turnstile (its site key
  is *meant* to be public, unlike a bespoke secret) — deliberately left out
  for now since it means loading a third-party script into the app's
  renderer, which is worth a separate decision.
- **Diagnostics are whitelisted, not forwarded blindly.** Only a fixed list
  of non-identifying fields (app version, OS/platform/arch, Electron/Chrome/
  Node versions, locale) ever reach Discord — never hostnames, IPs, usernames,
  or anything from the vault.

## Anti-spam

Two native Cloudflare Rate Limiting bindings (`ratelimits` in
`wrangler.jsonc`, no dashboard setup needed):

- `FEEDBACK_LIMITER_IP` — 5 requests / 60s per sender IP.
- `FEEDBACK_LIMITER_GLOBAL` — 30 requests / 60s across everyone, so a
  botnet spread across many IPs can't flood the channel either.

Tune the `limit` values in `wrangler.jsonc` if they're too strict/loose.

## Setup

```bash
cd feedback-worker
npm install

# Log in to Cloudflare (opens a browser)
npx wrangler login

# Create your Discord webhook: Server Settings → Integrations → Webhooks →
# New Webhook, then copy its URL. Set it as a secret (never in config/git):
npx wrangler secret put DISCORD_WEBHOOK_URL

npx wrangler deploy
```

Deploy prints the Worker's URL. This instance is bound to a custom domain
via `routes` in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "feedback.vapourware-studios.net", "custom_domain": true }]
```

That requires the zone (`vapourware-studios.net`) to already be on the same
Cloudflare account — for a fork, either point `pattern` at your own domain's
zone, or delete the `routes` block entirely to fall back to the
`*.workers.dev` URL `wrangler deploy` prints.

### Wire it into the app

`src/main/main.js` reads the endpoint from `SSHCLIENT_FEEDBACK_URL`, falling
back to `https://feedback.vapourware-studios.net/feedback` (same pattern as
the existing sync service in `src/main/sync.js`). Override it with
`SSHCLIENT_FEEDBACK_URL=https://<your-worker-url>/feedback` for a different
deployment (e.g. a fork).

### Local dev

```bash
cp .dev.vars.example .dev.vars   # fill in a real (or test) webhook URL
npm run dev
```

`.dev.vars` is gitignored — never commit it.

## Request contract

`POST /feedback`

```jsonc
{
  "message": "string, required, 1-4000 chars",
  "category": "bug" | "idea" | "other",       // defaults to "other"
  "contactEmail": "optional, validated if present",
  "includeDiagnostics": true,
  "diagnostics": {
    "appVersion": "0.1.4",
    "platform": "darwin",
    "osVersion": "...",
    "arch": "arm64",
    "electronVersion": "...",
    "chromeVersion": "...",
    "nodeVersion": "...",
    "locale": "en-US",
    "packaged": true
  }
}
```

Any field outside this shape is ignored. Response is always
`{ "ok": true }` or `{ "error": "..." }` with an appropriate status code
(400/404/413/429/502).
