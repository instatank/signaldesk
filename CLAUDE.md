# CLAUDE.md — SignalDesk

Read this before doing anything else in this repo. It's the current-state
handoff; `SIGNALDESK_PRD.md` is the full product spec and `SETUP.md` is the
owner's manual setup checklist. Keep all three in sync with reality as the
project moves — this file especially, since it's the first thing a new
session reads.

## What this is

A crypto market intelligence tool for a non-technical solo founder (the
owner, AA). Three data streams (news RSS, funding/OI, Fear & Greed) plus
prices, ingested every 15 min, synthesized into an AI-written briefing
pushed to Telegram twice daily (07:00 and 19:00 IST). See
`SIGNALDESK_PRD.md` for the full why/what; this file is about where the
build currently stands.

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
  `/api/digest` at 01:30 UTC = 07:00 IST and 13:30 UTC = 19:00 IST) and
  run automatically since this is a Production deployment — Vercel Cron
  only fires on Production, not Preview. **The owner is on the Vercel Pro
  plan** (upgraded to get exact cron timing and more than 2 jobs/project
  — Hobby caps both), so all scheduling lives in `vercel.json` directly;
  no external pinger (e.g. cron-job.org) is needed anymore.
- Each digest run is stored in Firestore's `digests` collection under a
  per-run doc id (`istSlotId()` in `lib/digest.js`, e.g. `2026-07-03-07`
  and `2026-07-03-19`) rather than one per day, since digest now runs
  twice daily — don't revert this to a per-day key or the evening run
  will overwrite the morning one.
- `assembleDigestInputs()` still looks back a full 24h for data
  continuity, but tags each headline `recent: true` (last 12h) or `false`
  (12-24h old); the Claude system prompt in `lib/claude.js` is told to
  lead `top_stories` with `recent` headlines so the two daily briefings
  don't just repeat each other.

**⚠️ Stray resource:** there's a second, empty Vercel project
`signaldesk-2rsg` (`prj_BamVnIbRrjjAACi76ABlgc1c2LML`) from a duplicate
import attempt. It has no env vars, no git connection, no deployments.
Safe to delete from the Vercel dashboard whenever; not otherwise
referenced anywhere.

## What's NOT done yet

**SETUP.md Step 5 is DONE** (confirmed by owner 2026-07-06): the digest
arrives on Telegram twice daily and the owner is consuming it. The
troubleshooting notes in SETUP.md remain relevant for future breakage.

**Phase 2 (dashboard) SHIPPED 2026-07-06** — the owner waived the 2-week
bar (he's a visual learner) and the dashboard was built the same day per
`PHASE2_DASHBOARD_PROMPT.md` (kept in the repo as the design record).
Same day, per owner feedback ("more clickability, leaner, cleaner — it'll
get crowded as sources are added"), the page was reorganized around
**snapshot-first progressive disclosure**; keep this shape as new
stats/sources land:

- Three disclosure layers everywhere: card header (a native `<summary>`,
  always visible — click folds the card to one row that still shows its
  key stat, e.g. "4/6 longs paying", "42 headlines") → visual snapshot
  (default open) → full text/enumeration behind an inner expand
  (`Disclose` in `app/components/ui.js`). A new source should be a new
  collapsible card following the same contract, never more
  always-visible rows.
- Pulse hero owns the 10-second read: briefing sentence, the whole Fear
  & Greed block (big number + classification + 30-day sparkline;
  guidance text lives in its ⓘ popover — there is NO separate F&G card
  anymore), and price ticker chips (compact $ + 24h%). Full briefing
  behind `<details>`.
- Positioning card does NOT list every coin by default: a band-colored
  "crowding strip" (one tinted chip per coin) plus only the most crowded
  coin's diverging bar (`positioningSummary()` in `lib/dashboard.js`);
  the full per-coin list (price, bar, OI combo) sits behind the expand.
- News card leads with shape (narrative-pulse bars, 24h flow histogram —
  counting, never sentiment) and shows 5 headlines; the rest are behind
  the expand.

Zero client JS — all disclosure is native `<details>`; sparkline/bars are
inline SVG/CSS. ISR `revalidate = 300`. Data shaping lives in
`lib/dashboard.js` (pure helpers + one Firestore reader, tested in
`tests/dashboard.test.mjs`); interpretation text comes from
`lib/interpret.js` so dashboard and Telegram digest never disagree. The
page build-degrades cleanly when `FIREBASE_SERVICE_ACCOUNT` is absent.

**P1 + free-tier P2 SHIPPED 2026-07-07** (owner asked for "all pending
that fall in free tier"; coin list explicitly kept as-is). Three pages
now — `/` (unchanged 10-second read), `/advance`, `/archive` — linked via
`app/components/SiteHeader.js`. What landed:

- **P1 items:** digest archive page (`/archive`); 7-day funding
  sparklines (inside the Positioning card's expand); macro-event flags —
  a static, owner-editable calendar in `config/macro-events.json` (FOMC
  dates confirmed from federalreserve.gov; CPI dates after Aug 2026
  follow the published BLS schedule — re-verify when extending into
  2027). Events within 7 days go into the digest inputs (prompt says
  mention, never predict the outcome), the raw fallback message, and
  chip badges in the `/` hero.
- **Advance page** (`/advance`, same card contract as `/`): long/short
  account ratios (Binance `futures/data` primary, OKX rubik fallback),
  spot order-book ±2% depth imbalance (Binance spot, OKX books
  fallback), stablecoin supply + BTC dominance (CoinGecko
  markets/global), Deribit options read (DVOL + put/call OI — BTC/ETH
  only, the liquid options markets), and a daily 30-day
  correlation-vs-BTC + realized-vol rollup (CoinGecko market_chart).
- **Ingest cadence** (all inside `/api/ingest`, stored in the single
  `advanced/latest` doc, merge-written so a failed section keeps its
  previous data): long/short + depth + stablecoins every 15 min; options
  + funding history only on the hourly `:00` run; the rollup re-fetches
  when its stored copy is >20h old (self-healing if a day's attempt
  fails). Fetchers + pure math + page shaping live in `lib/advanced.js`;
  the plain-language reads live in `lib/interpret.js` like everything
  else. `maxDuration` on ingest went 60→120 because the rollup fetches
  CoinGecko serially (free-tier rate-limit courtesy).
- **Deliberately NOT built — no free source exists (don't "solve" with a
  paid key without the owner's say-so):** liquidations & ETF flows
  (Coinglass paid; Binance removed its REST liquidation endpoint),
  exchange netflows (CryptoQuant has no free API), whale alerts (paid).
  The `/advance` footer lists these so the owner knows it's a choice,
  not an oversight.

Digest content/source refinement continues in parallel as the owner
reports what he wants tuned.

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
| `app/api/ingest/route.js` | 15-min cron: RSS + derivatives + F&G + prices + advanced sections → Firestore |
| `app/api/digest/route.js` | Daily cron: assemble 24h (+ macro events) → Claude → Firestore → Telegram |
| `lib/derivatives.js` | Binance→OKX funding/OI adapter with silent failover |
| `lib/advanced.js` | Advance-page data: long/short, depth, stablecoins, options, correlation rollup (fetchers + math + shaping) |
| `lib/macro.js` | Upcoming-macro-events window over `config/macro-events.json` |
| `lib/interpret.js` | ALL plain-language reads: PRD §5 tables + the advanced-stat interpretations |
| `lib/claude.js` | Anthropic Messages API via plain `fetch`, structured JSON output |
| `lib/digest.js` | Digest assembly + Telegram HTML formatting + raw fallback |
| `lib/dashboard.js` | Dashboard data shaping (pure helpers + Firestore readers, incl. digest archive) |
| `app/page.js` + `app/components/` | The Phase 2 dashboard (server-only, zero client JS) |
| `app/advance/page.js` | The Advance page (free-tier P2 stats, same card contract) |
| `app/archive/page.js` | Digest archive (P1) |
| `config/sources.json` | RSS feeds, asset mappings, advanced-API endpoints — edit here, not in code |
| `config/macro-events.json` | FOMC/CPI calendar — owner-editable, needs a yearly refresh |
| `tests/pipeline.test.mjs` | Offline tests (mocked fetch) — failover, dead-feed, auth, degraded-digest paths |
| `tests/advanced.test.mjs` | Offline tests for the advanced layer: math, shaping, failover, macro window |
| `scripts/verify-sources.mjs` | Live source health check (now incl. advanced endpoints) — run outside the sandbox |

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
