# SignalDesk — PRD v1.0
### A beginner trader's daily market intelligence system
**Owner:** AA · **Builder:** Claude Code (Fable 5) · **Date:** July 2026 · **Status:** Ready for build

---

## 1. One-line summary

A single-page dashboard + daily push digest that turns 15 scattered crypto data sources into **3 high-signal data streams and one AI-written morning briefing**, designed for a beginner large-cap trader who does basic price action / market structure analysis on TradingView.

## 2. Problem

The user currently has no systematic information diet. Checking news, funding, and sentiment means visiting 5+ sites, most of which are noisy, ad-heavy, and assume expert knowledge. The result is either information overload or (more commonly) skipping the research entirely and trading on charts alone.

## 3. Product principles (non-negotiable)

1. **Optimize, don't maximize.** Three data streams at launch. Nothing gets added until the user has used the existing streams daily for 2+ weeks and can explain what each one means.
2. **Push beats pull.** The daily digest is delivered TO the user (Telegram). The dashboard exists for on-demand checks, but the habit loop is push-based.
3. **Every number must teach.** This is a learning tool as much as a trading tool. Every metric displays a plain-language interpretation next to the raw value. No naked numbers.
4. **AA's standard architecture applies:** minimal dependencies, AI as an optional layer (dashboard works even if the Anthropic API call fails), all API keys server-side only.
5. **Free-tier only at launch.** Zero paid data subscriptions. Upgrade paths documented but not built.

## 4. Non-goals (v1)

- ❌ NOT a charting tool (TradingView owns that job)
- ❌ NOT a trade journal (TradeGenie owns that job)
- ❌ NO liquidation heatmaps, on-chain flows, order book depth, options data, social sentiment scraping (Phase 2+, gated on demonstrated need)
- ❌ NO trade signals or buy/sell recommendations. This tool informs; the user decides.
- ❌ NO portfolio tracking, no exchange account connections, no execution.

---

## 5. The three data streams (the "1 out of 3" cut)

### Stream 1: Funding Rates (+ Open Interest as companion metric)
**Why this one:** Of all derivatives data, funding rate is the single most beginner-legible leverage/sentiment gauge. It's one number per coin, updated every 8 hours, and directly answers "is the market over-leveraged long or short right now?" Open interest comes from the same free API family at near-zero extra cost, and the two together are far more useful than either alone.

**Assets:** BTC, ETH, SOL (expandable to top-10 large caps later; start with 3).

**Source:** Exchange public REST APIs — free, no API key required.
- Primary: Binance USDⓈ-M Futures public API
  - Funding: `GET https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=30`
  - Premium/current funding: `GET https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT`
  - Open interest: `GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`
  - OI history: `GET https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=48`
- **⚠️ Known landmine:** Binance geo-blocks requests from US IP ranges. Vercel serverless functions default to US East (iad1). **Mitigation (required):** pin the Vercel function region to Singapore (`sin1`) in `vercel.json`, and implement OKX public API as automatic fallback (`GET https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP` — globally accessible, no key). Build the fetcher as an adapter so the source is swappable.

**Beginner interpretation layer (must ship with the metric):**
| Funding rate (8h) | Display label | Plain-language explanation shown in UI |
|---|---|---|
| > +0.05% | 🔴 Overheated longs | "Longs are paying a premium to stay in. Crowded long trade — vulnerable to a long squeeze / sharp dip." |
| +0.01% to +0.05% | 🟡 Mildly bullish | "Normal bull-market funding. Longs slightly dominant, nothing extreme." |
| −0.01% to +0.01% | ⚪ Neutral | "Balanced positioning. Funding tells you nothing right now — lean on your chart analysis." |
| −0.05% to −0.01% | 🟡 Mildly bearish | "Shorts paying to stay in. Mild bearish crowding." |
| < −0.05% | 🟢 Overheated shorts | "Heavy short crowding. Historically, this is when short squeezes happen." |

OI interpretation (shown as 24h delta + price direction combo):
- Price ↑ + OI ↑ → "New money entering longs — trend confirmation"
- Price ↑ + OI ↓ → "Shorts closing (short covering) — rally may lack fuel"
- Price ↓ + OI ↑ → "New shorts opening — bearish conviction"
- Price ↓ + OI ↓ → "Longs closing — could be capitulation flush"

### Stream 2: News Digest (RSS aggregation + AI synthesis)
**Why this one:** News is the user's stated #1 need. Since CryptoPanic killed its free API tier (April 2026), RSS is the free, durable, no-key path.

**Sources (RSS feeds, all free):**
- CoinDesk — `https://www.coindesk.com/arc/outboundfeeds/rss/`
- Cointelegraph — `https://cointelegraph.com/rss`
- The Block — `https://www.theblock.co/rss.xml`
- Decrypt — `https://decrypt.co/feed`
- Bitcoin Magazine — `https://bitcoinmagazine.com/feed` (optional 5th)

**Note for builder:** RSS feed URLs rot. Verify each at build time; build the ingester to tolerate individual feed failures (log + skip, never crash the pipeline). Store feed URLs in config, not code.

**Two consumption modes:**
1. **Live feed (dashboard tab):** raw headlines, deduplicated, newest first, refreshed every 15 min via Vercel Cron. Tagged by source. This is the "real-time-ish" capability — honest 15-minute latency, which is fine because the user is not scalping news.
2. **Daily digest (the core product):** once per day at 07:00 IST, a Claude API call receives the last 24h of headlines + the current funding/OI/sentiment snapshot and produces a structured briefing (spec in §7).

### Stream 3: Fear & Greed Index
**Why this one:** One number, zero cost, instantly legible, and teaches the single most important beginner lesson — sentiment extremes are contrarian signals. It's the training-wheels version of sentiment analysis.

**Source:** `GET https://api.alternative.me/fng/?limit=30` — free, no key. (Builder: verify endpoint at build time; if dead, Coinglass website publishes the same index and CoinMarketCap has an F&G endpoint on its free tier as fallback.)

**Interpretation layer:** show current value + 30-day sparkline + canned guidance ("Extreme Fear (<20): historically better buying zones than selling zones. Extreme Greed (>80): time for caution, not FOMO.").

---

## 6. Features & priority

### P0 — must ship in v1
1. **Dashboard (single page, mobile-first)** — three cards: Funding/OI card (3 coins), F&G card, News feed. Plus a "Today's Briefing" section at top showing the latest digest.
2. **Daily digest generation** — 07:00 IST Vercel Cron → gather data → Claude API → store in Firestore → render on dashboard.
3. **Telegram push** — digest also sent to the user's personal Telegram via a bot (free, ~20 lines of code, `sendMessage` to a chat ID). This is the habit anchor. Email fallback acceptable if Telegram setup stalls, but Telegram strongly preferred (user is mobile-heavy).
4. **Interpretation layer** — every metric ships with the plain-language explanations from §5. An info icon on each card opens a short "What is this and why do I care?" explainer.
5. **Graceful degradation** — if the Anthropic API call fails, dashboard still shows raw data + headlines. If a data source fails, its card shows "source unavailable" without breaking others.

### P1 — fast follow (only after 2 weeks of daily use)
- Macro events awareness: digest prompt includes instruction to flag known upcoming macro events (FOMC, CPI) — implement by having the digest call use Claude's web search tool once daily, or a static econ-calendar RSS. Cheap, high value.
- Expand coins to top 10 large caps (config change, not code change).
- 7-day funding rate history sparkline per coin.
- "Digest archive" page (past briefings, scrollable — becomes a learning record).

### P2 — gated on demonstrated need + budget decision
- Liquidation data + long/short ratios (requires Coinglass Hobbyist, $29/mo — decide only after v1 habit is proven).
- Exchange netflow / stablecoin supply (CryptoQuant free tier, manual first).
- Link/bridge into TradeGenie: attach a "market context snapshot" (funding, F&G, top headline) to each journal entry. **This is the eventual killer feature connecting the two apps — but explicitly deferred.**

---

## 7. Daily digest specification

**Trigger:** Vercel Cron, 07:00 IST daily.
**Model:** `claude-sonnet-4-6` via Anthropic API (server-side key, existing pattern). Est. cost: single-digit cents/day.
**Inputs assembled by the pipeline:** last 24h deduplicated headlines (title + source + timestamp, max ~60), current + 24h-ago funding rates and OI for BTC/ETH/SOL, F&G current + 7-day trend, BTC/ETH/SOL 24h price change (CoinGecko free endpoint: `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`).

**Output format (enforced via prompt, stored as structured JSON):**
1. **Market pulse** (2-3 sentences): what kind of day/regime is it — trending, chopping, fearful, greedy.
2. **Top 5 stories that matter** — each: one-line summary + one line on *why a trader should care*. Ranked by market relevance, not recency. Explicit instruction to ignore fluff (price-prediction articles, sponsored content, "top 10 coins" listicles).
3. **Positioning check** — funding + OI read per coin in plain language, using the §5 interpretation framework.
4. **Sentiment note** — F&G reading + whether it's at an extreme.
5. **One thing to learn today** — a single concept from the day's data explained in 2-3 sentences (e.g., "Notice ETH funding flipped negative while price held — here's what that divergence usually means"). This is the compounding-education feature.
6. **Honesty rules in the system prompt:** no predictions, no trade calls, flag uncertainty, never invent data not present in the inputs.

## 8. X/Twitter follow list (manual curation, not scraped in v1)

Scraping X is fragile and API access is expensive — v1 does NOT ingest X. Instead, the user manually follows a curated list; the dashboard links to it. Suggested starting list (~10, quality over quantity):

**News speed:** @Tree_of_Alpha (fastest credible breaking news), @WatcherGuru (fast but noisy — read headlines, skip takes), @CoinDesk, @TheBlock__
**Price action / market structure (matches user's TA style):** @CryptoDonAlt, @CredibleCrypto, @Pentosh1
**Data / on-chain:** @ki_young_ju (CryptoQuant CEO), @caprioleio (Charles Edwards)
**Macro:** @NickTimiraos (WSJ "Fed whisperer" — single best macro-policy follow), @RaoulGMI (macro framing, filter the perma-bull bias)

*Caveat to user: verify these accounts are still active/high-signal — X accounts decay. Treat every X take as opinion, never data.*

## 9. Architecture

```
Vercel Cron (every 15 min)          Vercel Cron (daily 07:00 IST)
       │                                     │
       ▼                                     ▼
/api/ingest  ──────────────►  Firestore  ◄── /api/digest
  • RSS fetch+dedupe            │              • assemble 24h data
  • Funding/OI (Binance,        │              • Claude API call
    OKX fallback)               │              • store digest JSON
  • F&G index                   │              • Telegram sendMessage
  • price snapshot              ▼
                          Next.js dashboard (single page)
                          reads Firestore, renders 3 cards + briefing
```

- **Stack:** Next.js (App Router) + Tailwind on Vercel; Firestore for storage; Vercel Cron for scheduling; Anthropic API for synthesis; Telegram Bot API for delivery. All consistent with AA's existing stack — zero new platforms.
- **Region:** pin serverless functions to `sin1` (Singapore) in `vercel.json` — required for Binance API access, and lower latency to India anyway.
- **Firestore collections:** `headlines` (docId = url hash; fields: title, source, url, publishedAt, ingestedAt), `metrics` (timestamped snapshots: funding, OI, fng, prices), `digests` (one doc/day: structured JSON + raw markdown).
- **Dependencies:** keep to Next.js, Tailwind, firebase-admin, an RSS parser (`rss-parser`), and nothing else. No charting library in v1 (sparklines can be inline SVG).
- **Secrets:** `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, Firebase service account — all Vercel env vars, never client-side. Cron endpoints protected with `CRON_SECRET` header check.

## 10. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Binance geo-block on Vercel | High if unaddressed | Pin region `sin1`; OKX adapter fallback; adapter pattern makes source swappable |
| RSS feed URLs change/die | Medium | Config-driven feeds, per-feed error tolerance, log failures visibly on dashboard admin note |
| User stops reading digest after novelty fades | High (the real product risk) | Telegram push (zero-friction), "one thing to learn" section, keep digest under 400 words |
| F&G endpoint deprecates | Low-medium | Documented fallbacks (CMC free tier) |
| Anthropic API failure at digest time | Low | Retry once; on failure send raw-data Telegram message; dashboard degrades gracefully |
| Scope creep (user's known pattern) | High | §3 principle 1 + §4 non-goals are the contract. Phase gates are behavioral (2 weeks of use), not calendar-based |

## 11. Success metrics

- **Primary:** user reads the digest ≥ 5 days/week for 3 consecutive weeks (self-reported / Telegram read behavior).
- **Learning:** after 4 weeks, user can explain funding rate, OI-price divergence, and F&G contrarianism unprompted.
- **Secondary:** at least one instance where digest context changed a trade decision (logged in TradeGenie).

## 12. Build phases

- **Phase 1 (build first, ship in days):** ingest pipeline (all 3 streams) + Firestore + daily digest + Telegram push. *No dashboard yet.* If the Telegram digest alone proves valuable, everything else is bonus.
- **Phase 2:** dashboard page with the three cards + briefing + interpretation layer.
- **Phase 3:** P1 features, gated on 2 weeks of demonstrated daily use.
