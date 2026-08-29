# SignalDesk

A beginner trader's daily market intelligence system: three high-signal
crypto data streams + one AI-written briefing, pushed to Telegram once a
day (07:00 IST), plus a zero-client-JS dashboard.

All planned phases have shipped: the pipeline (Phase 1), the dashboard
(Phase 2), the P1 fast-follows (archive, funding sparklines, macro-event
flags) and the free-tier P2 stats, plus owner-requested additions — an
on-demand Flash briefing, a no-AI market screener, and a light/dark theme.
Full spec in `SIGNALDESK_PRD.md`; owner setup steps in `SETUP.md`; current
project state and handoff notes in `CLAUDE.md`.

## How it works

```
Vercel Cron                              Vercel Cron
  /api/ingest    every 15 min              /api/digest    07:00 IST daily
  /api/screener  daily 00:45 UTC           • assemble last-24h data
       │                                     (+ upcoming macro events)
       ▼                                   • Claude API call
   Firestore  ◄──────────────────────────  • store digest JSON
       │                                   • Telegram sendMessage
       ▼
Next.js pages (server-only, zero client JS):
  /          10-second read: briefing, F&G, prices, positioning, news
  /advance   long/short ratios, depth, stablecoins, options, correlations
  /flash     on-demand real-time reaction briefing (public, cooldown-gated)
  /screener  strength/momentum/crowding across ~30 coins (+ per-coin detail)
  /archive   past briefings, scrollable
```

- **Region pinned to Singapore** (`sin1` in `vercel.json`) — Binance
  geo-blocks US IPs, and Vercel defaults to US East.
- **Binance → OKX adapter** (`lib/derivatives.js`): if Binance returns
  451/403, OKX serves funding/OI silently; every snapshot records which
  source it came from.
- **AI is optional, never load-bearing**: if the Claude call fails (one
  retry), a raw-data Telegram message built from the interpretation tables
  in `lib/interpret.js` goes out instead. The screener uses no AI at all —
  pure exchange data + arithmetic.
- **Feeds are config, not code** (`config/sources.json`); one dead feed is
  logged and skipped, never fatal. The macro calendar
  (`config/macro-events.json`) is owner-editable the same way.
- **Dedupe**: headline doc ID = sha256 of the canonical URL (tracking
  params stripped), so republished/overlapping stories store once.
- **Secrets are server-side only** — see `.env.example` for the list.
  Cron endpoints reject anything without `Authorization: Bearer $CRON_SECRET`.
  The two public POST endpoints (`/api/flash`, `/api/screener/refresh`)
  are instead bounded by Firestore-transaction cooldowns.
- **Zero client JS** in every page; disclosure is native `<details>`,
  filters/sorting are hidden radio groups + generated CSS. The single
  deliberate exception: a tiny pre-paint theme-boot script in
  `app/layout.js` for the dark/light toggle.

## Dependencies (deliberately minimal)

`next` (+ its required `react`/`react-dom` peers), `tailwindcss`
(+ `@tailwindcss/postcss`, Tailwind v4's own build plugin), `firebase-admin`,
`rss-parser`. Anthropic and Telegram are called with plain `fetch` — no SDKs.

## Commands

```
npm run dev             # local dev server
npm test                # offline tests (mocked network — failover paths etc.)
npm run verify:sources  # live-check every RSS feed / API endpoint
npm run build           # production build
```

## Firestore collections

| Collection | Doc ID | Contents |
|---|---|---|
| `headlines` | sha256(canonical URL) | title, url, source, publishedAt, ingestedAt |
| `metrics` | auto | per-run snapshot: funding/OI per coin (+source), F&G (+30d history), prices, errors |
| `digests` | `YYYY-MM-DD-HH` (IST slot, e.g. `2026-07-03-07`) | structured digest JSON, rendered message, degraded flag |
| `advanced` | `latest` (merge-written) | long/short, depth, stablecoins, options, correlation rollup |
| `flash` | `latest` + `cooldown` | last flash briefing + its transaction-claimed cooldown slot |
| `screener` | `latest` (+ `livePrices` overlay) | daily screener build + 15-min live-price refresh |
