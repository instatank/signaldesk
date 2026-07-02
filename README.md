# SignalDesk

A beginner trader's daily market intelligence system: three high-signal
crypto data streams + one AI-written morning briefing, pushed to Telegram
at 07:00 IST.

**Phase 1 (this build):** the pipeline. No dashboard yet — the product is
the Telegram digest. The dashboard is Phase 2, built after a few days of
validating the digest. Full spec in `SIGNALDESK_PRD.md`; owner setup steps
in `SETUP.md`.

## How it works

```
Vercel Cron (every 15 min)          Vercel Cron (daily 07:00 IST)
       │                                     │
       ▼                                     ▼
/api/ingest  ──────────────►  Firestore  ◄── /api/digest
  • RSS fetch + dedupe          │              • assemble last-24h data
  • Funding/OI (Binance,        │              • Claude API call
    OKX auto-fallback)          │              • store digest JSON
  • Fear & Greed index          │              • Telegram sendMessage
  • CoinGecko prices            ▼
                          (dashboard reads this in Phase 2)
```

- **Region pinned to Singapore** (`sin1` in `vercel.json`) — Binance
  geo-blocks US IPs, and Vercel defaults to US East.
- **Binance → OKX adapter** (`lib/derivatives.js`): if Binance returns
  451/403, OKX serves funding/OI silently; every snapshot records which
  source it came from.
- **AI is optional, never load-bearing**: if the Claude call fails (one
  retry), a raw-data Telegram message built from the interpretation tables
  in `lib/interpret.js` goes out instead.
- **Feeds are config, not code** (`config/sources.json`); one dead feed is
  logged and skipped, never fatal.
- **Dedupe**: headline doc ID = sha256 of the canonical URL (tracking
  params stripped), so republished/overlapping stories store once.
- **Secrets are server-side only** — see `.env.example` for the list.
  Cron endpoints reject anything without `Authorization: Bearer $CRON_SECRET`.

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
| `digests` | `YYYY-MM-DD` (IST) | structured digest JSON, rendered message, degraded flag |
