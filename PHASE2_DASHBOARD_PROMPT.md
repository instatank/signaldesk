# Phase 2 Build Prompt — SignalDesk Dashboard

> **How to use this file:** paste everything below the line into a fresh
> Claude Code (Fable 5) session opened on this repo, or just tell a session
> "execute PHASE2_DASHBOARD_PROMPT.md". It is self-contained but assumes the
> session has also read CLAUDE.md (it will — that's automatic).

---

## Your task

Build the SignalDesk **Phase 2 dashboard**: a single-page, mobile-first,
visually rich market-intelligence view at `/` (replacing the placeholder in
`app/page.js`). The owner is a **visual learner** — he retains information
from charts, color, and spatial layout far better than from text. The
Telegram digest (Phase 1, live and validated) is the text form of this
product; the dashboard is the *visual* form of the same data. Optimize
ruthlessly for glanceability: the owner should absorb the market's state in
10 seconds of eyeballing before reading a single word.

The phase gate in CLAUDE.md is **lifted** — the owner explicitly approved
building this now (digest is working and consumed daily; he waived the
2-week bar). Do not re-ask.

## Context you must respect (from CLAUDE.md — non-negotiable)

1. **No new dependencies.** No charting library, no icon pack, no fonts
   beyond system/Google-hosted-via-CSS. Sparklines, gauges, and bars are
   **inline SVG or pure CSS**. Current deps: next, react, react-dom,
   tailwind, firebase-admin, rss-parser. That list does not grow.
2. **All secrets stay server-side.** The page reads Firestore via
   `getDb()` from `lib/firestore.js` in **server components / route
   handlers only**. Nothing from the 5 env vars ever reaches the client
   bundle. No client-side Firestore SDK — ever.
3. **Graceful degradation.** Any card whose data is missing shows a quiet
   "source unavailable" state without breaking siblings. If no digest
   exists yet today, show the most recent one with its timestamp.
4. **Don't touch the pipeline.** `app/api/ingest`, `app/api/digest`,
   `lib/*` data code, `vercel.json` crons, and the `sin1` region pin all
   stay as they are. You are adding a read-only presentation layer.
5. Keep `npm test` green and add offline tests for any new pure functions
   (formatting, data shaping). Update CLAUDE.md's status section when done.

## The data you have (real shapes, verified against the code)

All in Firestore, written by the 15-min ingest cron:

- **`metrics`** — snapshot docs, newest by `ts`. Each has:
  - `derivatives.{SYM}` → `{ fundingRate, openInterest, source: 'binance'|'okx' }`
  - `fng` → `{ value, classification, history: [{value, ...}, ...30 days] }`
  - `prices.{SYM}` → `{ usd, change24hPct }`
  - Assets currently: BTC, ETH, SOL, ZEC, HYPE, VVV (from `config/sources.json` — read it, don't hardcode).
- **`headlines`** — `{ title, source, url, publishedAt, ingestedAt }`, docId = url hash.
- **`digests`** — docId = `istSlotId()` (e.g. `2026-07-06-07`). Contains the
  structured digest JSON: `market_pulse`, `top_stories[{summary, source,
  why_it_matters}]`, `positioning[{asset, read}]`, `sentiment_note`,
  `learn_today`, plus stored metadata. Check `app/api/digest/route.js` for
  the exact stored field names before reading.
- **Interpretation functions** already exist in `lib/interpret.js`
  (`interpretFunding` → `{emoji, label, explanation}`, `interpretOiPrice`,
  `interpretFearGreed`, `formatFundingPct`). **Reuse them** — the dashboard
  must show the same labels/thresholds as the Telegram digest, one source
  of truth. If you need them in client components, pass their *results*
  down from the server component as props.

To get 24h/7d history for sparklines, query `metrics` ordered by `ts`
descending with a time cutoff and downsample server-side (one point per
hour is plenty). Keep Firestore reads modest — this page may be refreshed
often.

## Architecture

- `app/page.js` → **server component**, `export const revalidate = 300`
  (5 min ISR — fresh enough for 15-min data, near-zero Firestore cost).
  Also set `export const dynamic` appropriately so build doesn't fail when
  env vars are absent locally — wrap data fetching so a missing
  `FIREBASE_SERVICE_ACCOUNT` at build time renders the degraded state
  instead of crashing the build.
- Small client components only where interactivity demands it (the "what
  is this?" explainer popovers, tab switch on the news feed). Everything
  else server-rendered.
- Put presentational components in `app/components/` and pure
  data-shaping helpers in `lib/dashboard.js` (testable offline).
- A lightweight `/api/summary` route is NOT needed — read Firestore
  directly in the server component. Don't add API surface without cause.

## Page structure (top to bottom, mobile-first single column; 2-col grid ≥lg)

1. **Header strip** — "SignalDesk" wordmark, IST date, a small "data as of
   HH:MM IST" freshness stamp derived from the latest `metrics.ts`. If the
   latest snapshot is >45 min old, show an amber "data may be stale" pill.

2. **Market pulse hero** — the latest digest's `market_pulse` displayed
   large, with the F&G value as a color-coded number beside it and each
   asset's 24h price change as small colored chips (green/red, sign always
   shown). This is the 10-second read. Below it, collapsible (`<details>`
   or a client toggle): the full briefing — top stories with
   `why_it_matters`, positioning, sentiment note, and **"One thing to
   learn today"** styled distinctly (e.g. a bordered "🎓" callout — the
   owner values this section; make it feel like a daily card to look
   forward to).

3. **Positioning card (Funding + OI)** — one row per asset:
   - Asset symbol + price + 24h change (colored).
   - Funding rate as a **horizontal diverging bar** centered on 0, colored
     by the `interpretFunding` band (red overheated-longs → neutral gray →
     green overheated-shorts), with the emoji+label text beside it. The
     bar makes crowding *visible* — this is the single most important
     visual on the page.
   - OI 24h delta arrow + the `interpretOiPrice` combo sentence underneath
     in muted small text.
   - Tiny "ⓘ" opens the plain-language explainer (the PRD §5 table text —
     every number must teach).

4. **Fear & Greed card** — big number (color: red <25 → orange → yellow →
   green >75), classification word, a **30-day inline-SVG sparkline** from
   `fng.history`, and the canned contrarian guidance from
   `interpretFearGreed`. Mark the extremes visually (shade <20 and >80
   bands on the sparkline).

5. **News feed card** — last ~24h of headlines, newest first, deduped,
   each linking out (`target="_blank" rel="noopener"`), tagged with source
   and a relative time ("2h ago"). Cap at ~20 with a "show more" client
   toggle. Highlight headlines <2h old with a subtle "new" dot.

6. **Footer** — quiet one-liner: "Informs, never advises. No signals, no
   predictions." (brand-level restatement of the PRD non-goals) + link to
   the X follow list section of the PRD is NOT needed; keep footer minimal.

## Visual design direction (you decide details; this is the frame)

- **Dark theme, single theme.** Traders live in dark UIs (TradingView,
  exchanges); it makes the semantic colors pop. Near-black background
  (zinc-950), zinc-900 cards with subtle borders (zinc-800), generous
  rounding (rounded-2xl) and spacing. No pure white text — zinc-100/zinc-400
  hierarchy.
- **Color is semantic, never decorative.** Green = bullish/positive delta,
  red = bearish/negative, amber = caution/stale, one accent (sky or indigo)
  for interactive elements only. If a color doesn't encode meaning, it's
  gray.
- **Numbers are the typography.** Big tabular-nums (`tabular-nums` class)
  for values; labels small, uppercase, tracked-wide, muted. The visual
  hierarchy is: number → color → label → explanation.
- Cards should feel like instrument panels, not blog posts. Density is
  fine; clutter is not — every element earns its pixels.
- It must look good on a phone first (the owner is mobile-heavy); the
  desktop layout is the adaptation, not the other way around.

## Definition of done

- `npm test` passes (existing + your new tests for data-shaping helpers).
- `npm run build` succeeds **without** env vars set (degraded render path).
- Page renders correctly in three states you can reason through:
  (a) full data, (b) no digest yet today, (c) empty Firestore (fresh
  project) — each degrades to something intentional, never a crash or a
  blank page.
- No new entries in `package.json` dependencies.
- CLAUDE.md updated: Phase 2 shipped, key files table extended, "what's
  not done" section refreshed.
- Commit with a clear message and push to the branch Vercel deploys from
  (check CLAUDE.md for the current production branch before pushing).
  Remind the owner the live URL updates automatically on push and ask him
  to eyeball it on his phone — his reaction drives the next iteration.

## Explicitly out of scope (do not build, even if tempting)

- Digest archive page, funding history sparklines per coin, macro-event
  flags — those are P1 fast-follows, next iteration.
- Auth/login — the page shows no secrets and read-only public-ish data;
  it stays open for now.
- Any charting/UI library, client-side data fetching loops, websockets,
  or "live" tickers. 5-minute ISR freshness is the product's honest pace.
