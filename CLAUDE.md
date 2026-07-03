# CLAUDE.md — SignalDesk

Read this before doing anything else in this repo. It's the current-state
handoff; `SIGNALDESK_PRD.md` is the full product spec and `SETUP.md` is the
owner's manual setup checklist. Keep all three in sync with reality as the
project moves — this file especially, since it's the first thing a new
session reads.

## What this is

A crypto market intelligence tool for a non-technical solo founder (the
owner, AA). Three data streams (news RSS, funding/OI, Fear & Greed) plus
prices, ingested every 15 min, synthesized into one AI-written daily
briefing pushed to Telegram at 07:00 IST. See `SIGNALDESK_PRD.md` for the
full why/what; this file is about where the build currently stands.

## Current status: Phase 1 is live in production

- Code: complete, tested, on branch `claude/new-session-8uz6j0` (this repo
  has **no `main` branch** — that branch is the GitHub default and the
  Vercel production branch; keep pushing there unless the owner asks to
  restructure).
- Deployed: **https://signaldesk-tawny.vercel.app** — Vercel project
  `signaldesk` (`prj_KyENx9ytovswy3g9ZhIq93FGVOXH`), team
  `ankitanand25-4465's projects` (`team_P4uKN28r7smT5lPcH5jm0Jac`), connected
  to GitHub (`instatank/signaldesk`), last deploy `dpl_FmrzgxjCnghVZMvuRidri1xsKsYK`
  built from commit `86266a8`, state `READY`, target `production`.
- All 5 env vars are set in Vercel (owner did this manually):
  `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT`.
- Cron jobs are wired in `vercel.json` (`/api/ingest` every 15 min,
  `/api/digest` daily at 01:30 UTC = 07:00 IST) and will run automatically
  now that this is a Production deployment — Vercel Cron only fires on
  Production, not Preview.

**⚠️ Stray resource:** there's a second, empty Vercel project
`signaldesk-2rsg` (`prj_BamVnIbRrjjAACi76ABlgc1c2LML`) from a duplicate
import attempt. It has no env vars, no git connection, no deployments.
Safe to delete from the Vercel dashboard whenever; not otherwise
referenced anywhere.

## What's NOT done yet

**Owner action, not code** — SETUP.md Step 5 (verify sources, trigger a
manual ingest, confirm the `unauthorized` response, trigger the first
digest and confirm the Telegram message arrives). If the owner reports a
problem here, it's almost always one of: wrong `CRON_SECRET` header
format, `FIREBASE_SERVICE_ACCOUNT` pasted incompletely, or the Telegram
chat never started (see SETUP.md's troubleshooting section — keep it
current if new failure modes turn up).

**Phase 2 (dashboard) is explicitly gated** — per the PRD (§3 principle 1
and §12), do not start building the dashboard until the owner has used the
Telegram digest daily for 2+ weeks and reports it's earning its place.
If asked to "add the dashboard" before that, ask whether the 2-week bar
has been met rather than assuming.

## Architecture rules (non-negotiable — see original handoff for full
rationale, condensed here)

1. **Minimal dependencies.** Currently: `next`, `react`/`react-dom` (peers),
   `tailwindcss` + `@tailwindcss/postcss`, `firebase-admin`, `rss-parser`.
   Anthropic and Telegram are called via plain `fetch` — no SDKs. Anything
   beyond this list needs a one-line justification and should make you
   suspicious of yourself.
2. **AI is optional, never load-bearing.** `/api/digest` retries the Claude
   call once, then falls back to `buildRawFallbackMessage()` — the pipeline
   must never go silent because Anthropic had a bad day. Preserve this
   property in any change to `lib/claude.js` or `lib/digest.js`.
3. **All secrets server-side only.** Never let any of the 5 secrets reach
   a client bundle. Cron endpoints (`/api/ingest`, `/api/digest`) must keep
   checking `Authorization: Bearer $CRON_SECRET` via `lib/auth.js`.
4. **Region pinned to `sin1`** in `vercel.json` — required for Binance
   access (geo-blocks US IPs) and is why the Binance→OKX adapter in
   `lib/derivatives.js` exists at all. Don't remove either without cause.

## Key files

| File | Purpose |
|---|---|
| `app/api/ingest/route.js` | 15-min cron: RSS + derivatives + F&G + prices → Firestore |
| `app/api/digest/route.js` | Daily cron: assemble 24h → Claude → Firestore → Telegram |
| `lib/derivatives.js` | Binance→OKX funding/OI adapter with silent failover |
| `lib/interpret.js` | The PRD §5 interpretation tables (funding labels, OI+price combos, F&G read) |
| `lib/claude.js` | Anthropic Messages API via plain `fetch`, structured JSON output |
| `lib/digest.js` | Digest assembly + Telegram HTML formatting + raw fallback |
| `config/sources.json` | RSS feed URLs and asset symbol mappings — edit here, not in code |
| `tests/pipeline.test.mjs` | Offline tests (mocked fetch) — failover, dead-feed, auth, degraded-digest paths |
| `scripts/verify-sources.mjs` | Live source health check — run from an environment with real internet |

## Working in this repo from a sandboxed Claude Code session

This project has been built from a cloud sandbox whose outbound network is
allow-listed (npm registry, Anthropic API — not arbitrary third-party APIs
or `api.vercel.com`). Two consequences worth knowing before you retry
something that failed for a past session:

- `npm run verify:sources` and any live-API testing needs to run from an
  environment with real internet (the owner's machine, or `vercel dev`) —
  it will show 403s from this sandbox even though the code is correct.
- The Vercel MCP tools (`list_projects`, `list_deployments`, etc.) work
  because they run through Anthropic's own infrastructure, but
  `deploy_to_vercel` cannot actually trigger a build from here (no CLI
  auth, and `api.vercel.com` is blocked). If a deploy is needed, the
  reliable path is: confirm the Vercel project is Git-connected to
  `instatank/signaldesk` (branch `claude/new-session-8uz6j0`), then just
  `git push` — Vercel's own servers pick it up, no local network needed.
  Don't burn time re-attempting CLI-token deploys from inside this sandbox.

## Commands

```
npm run dev             # local dev server
npm test                # offline tests
npm run verify:sources  # live source check (run outside the sandbox)
npm run build           # production build
```
