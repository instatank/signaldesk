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
  to GitHub (`instatank/signaldesk`), last deploy `dpl_81gNJLpLkubwcqp2cnuqfyqRucp2`
  built from commit `479b375` (daylight mode), state `READY`, target
  `production` (verified via Vercel MCP 2026-07-17).
- All 5 env vars are set in Vercel (owner did this manually):
  `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT`.
- Cron jobs are wired in `vercel.json` (`/api/ingest` every 15 min,
  `/api/digest` at 01:30 UTC = 07:00 IST and 13:30 UTC = 19:00 IST,
  `/api/screener` at 00:45 UTC daily) and
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
  "crowding strip" (one tinted chip per coin) plus a single coin's
  diverging bar. The strip is a **coin selector** — each pill is a
  `<label>` for a hidden radio (`name="pf"`); click a pill and the
  snapshot bar swaps to that coin (default = most crowded,
  `positioningSummary()` in `lib/dashboard.js`), same generated
  `:checked ~` CSS pattern as the news filter. The full per-coin list
  (price, bar, OI combo) sits behind an expand, but there is **no
  "show more" arrow row** — the snapshot bar itself is the `<summary>` of
  a native `<details>`, so clicking the snapshot toggles the full table
  open/closed (small inline chevron is the only affordance). Three
  independent click targets: card header folds the whole card, snapshot
  toggles the table, pills pick the coin.
- News card leads with shape (narrative-pulse bars, 24h flow histogram —
  counting, never sentiment) and shows 5 headlines by default. The
  narrative-pulse bars double as a **filter**: click a bar to narrow the
  list to just that coin/theme (all matches, not only the top 5), with an
  active-bar highlight and a "✕ clear" control; a "All N headlines" toggle
  still reveals the full unfiltered list. It's a native radio group
  (`name="nf"`, one hidden `<input>` per bar + "all"/"every" defaults)
  driven by a generated `:checked ~` stylesheet in `NewsCard.js` — still
  zero client JS. Each headline `<li>` carries a `t-<tag>` class per
  coin/theme so the CSS can hide/show it precisely.

Zero client JS — all disclosure is native `<details>` (news filter is a
native radio group + generated CSS); sparkline/bars are inline SVG/CSS. ISR `revalidate = 300`. Data shaping lives in
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

**Flash briefing SHIPPED 2026-07-08** (owner wanted to trigger a fresh,
real-time read from the UI when a major event hits — e.g. a war/hack — to
gauge how the market is reacting *now*). Key decision: recency is a **dial
on the existing pipeline, not a second system.** `assembleDigestInputs()`
took `windowHours`/`recentHours`/`mode` opts (defaults `24`/`12`/
`'scheduled'` reproduce the twice-daily digest byte-for-byte). A flash run
passes `{windowHours:12, recentHours:4, mode:'flash'}`; `lib/claude.js`
appends a "flash addendum" to the system prompt only when
`inputs.mode==='flash'`, re-framing the *same* briefing as a present-tense,
last-4h reaction read (standing no-predictions rules intact). What landed:

- New page `/flash` (4th nav tab), same card/zero-JS contract. The trigger
  is a plain `<form method="post" action="/api/flash">` → 303 redirect back
  to the page. During cooldown the button is **server-rendered disabled**
  with a static "available in ~Xm" (reload to refresh — no ticking JS).
  Page is `dynamic='force-dynamic'` (on-demand, never cached).
- `/api/flash` is **PUBLIC** (a browser form can't hold `CRON_SECRET`) —
  abuse is bounded by a **10-min cooldown claimed in a Firestore
  transaction** (`acquireFlashSlot`) *before* any Claude call. If you ever
  add auth here, keep the cooldown too. This is the one endpoint not gated
  by `lib/auth.js`, by design.
- A **lean ingest** (`leanIngest` in `lib/flash.js`): only RSS + prices +
  F&G + funding/OI, never the slow advanced/options/rollup — seconds, not
  the 2-min cron. It writes the same `headlines`/`metrics` collections, so
  a flash also warms the dashboard and the next scheduled digest.
- Flash differs from the scheduled digest in two deliberate ways: **one**
  Claude attempt then raw-data fallback (a flash is time-sensitive; a 2nd
  60s retry is worse UX), and **no Telegram push** (owner is at the screen).
  Result stored in `flash/latest`. To flip either default, edit `runFlash`.

**Screener SHIPPED 2026-07-09** (owner cloned a reference "crypto-screener":
what's strong / moving / crowded across a coin universe, plus a per-coin
detail view). Decisions locked by owner: **universe = top ~30** Binance-
futures coins by volume (unioned with our tracked 6, which are highlighted);
**zero client JS**. Key property: **NO AI, essentially zero cost** — it's
pure Binance-futures data + arithmetic. What landed:

- New page `/screener` (5th nav tab): a market-summary banner (BTC 200-day
  regime, breadth, avg month return, funding crowding, OI anomaly), five
  insight cards (Strongest / Picking up speed / Crowded longs / Washed out /
  Yesterday's big moves), and an ALL COINS table. Rolling windows per owner:
  1d = 24h, 1w = 7d, 1m = 30d, 2m = 60d.
- **Table sorting is zero-JS** — a hidden radio group + a generated
  `:checked ~` stylesheet that sets each row's CSS `order` per sort key
  (same trick as the news filter). Rows are a flex column so `order` reflows
  them. Live prices carry a small green dot.
- Per-coin detail `/screener/[coin]`: strength headline, return ladder, five
  templated plain-language reads (NOT AI — interpret.js-style), and three
  static SVG charts (rel-perf vs the average coin, daily funding bars, OI
  change). "open in TradingView" is just an external link.
- **Data flow:** daily cron `/api/screener` (00:45 UTC) computes the whole
  thing → one `screener/latest` doc via `buildScreener()` in `lib/screener.js`
  (fetchers batched 6-at-a-time for Binance rate-limit courtesy; all pure
  math exported + tested in `tests/screener.test.mjs`). A **near-real-time
  price refresh** (`refreshScreenerPrices` in `lib/screener-live.js`)
  piggybacks on the 15-min `/api/ingest`, writing only a compact `livePrices`
  map (never rewriting the rows array); the reader overlays it.
- **REFRESH button** (faithful to the reference + fixes cold-start): a public
  `/api/screener/refresh` POST gated by a 5-min Firestore-transaction
  cooldown (`acquireScreenerRefresh`), same public-but-bounded pattern as
  flash. Zero-JS form → 303 back. The `/screener` page is `force-dynamic` so
  refresh + live prices show immediately.
- All Binance futures endpoints live in `config/sources.json` under
  `screener` (incl. a `names` map for pretty coin names); region stays `sin1`
  so Binance is reachable. Sandbox can't hit Binance, so live data only
  appears after deploy (hit Refresh, or wait for the cron).

**Daylight mode SHIPPED 2026-07-09** (owner wanted to flip between a light
and dark screen — "light sometimes, dark sometimes"). Key decision:
**re-theme via CSS variables, not per-component rewrites.** Tailwind v4
compiles every color utility to a `var(--color-*)` reference (e.g.
`bg-zinc-900` → `background-color:var(--color-zinc-900)`), so the whole app
re-themes by re-pointing those variables under `[data-theme="light"]` in
`app/globals.css` — no `dark:` variants, no touching the ~334 utility
usages. The zinc ramp is used semantically (high N = dark surface, low N =
bright text), so it's remapped to a cool-grey light ramp that preserves
that meaning; accent/status hues are shifted a step deeper for contrast on
white. What landed:

- `data-theme` on `<html>` (default `dark`), flipped by a header toggle
  (☀ in dark → ☾ in light; the glyph swap is pure CSS via `.theme-toggle`).
  Two states only — dark/light — persisted in `localStorage`
  (`signaldesk_theme`).
- The **one piece of client JS in the app, by design**: a tiny pre-paint
  boot script in `app/layout.js` that applies the saved theme before first
  paint (no flash) and defines `window.__sdToggleTheme`, which the header
  button calls via an inline `onclick` (rendered as raw HTML so it needs no
  client component — the site stays server-only). Display stays 100%
  CSS-driven; this just flips an attribute + updates `<meta theme-color>`.
- A handful of hardcoded colors that Tailwind can't reach (SVG
  stroke/fill props, generated `:checked ~` stylesheet strings) were
  swapped from literal hex/rgb to `var(--color-*)` so they flip too. SVG
  colors moved from presentation attributes to `style` (presentation attrs
  don't resolve `var()`; CSS `style` does) — see `Sparkline` in
  `app/components/ui.js`.
- Verified in both themes with headless Chromium; dark mode is unchanged.

**Production-alignment audit 2026-07-17** (branch
`claude/production-alignment-pending-phases-a8k971`, cut from production
commit `479b375` — the exact commit the live production deployment was
built from). Result: **every planned phase and step is complete** — PRD
§12 Phases 1–3, all P0 and P1 items, the free-tier P2 stats, plus the
owner-requested Flash / Screener / Daylight additions. 71/71 offline
tests pass; production build clean. Docs were re-synced in this audit
(README rewritten from its stale Phase-1-only text; SETUP.md status note
and cron list corrected). What remains open is open **by explicit
decision, not oversight**:

- Paid-source stats — liquidations & ETF flows (Coinglass), exchange
  netflows (CryptoQuant), whale alerts — await an owner budget decision;
  listed in the `/advance` footer.
- The TradeGenie bridge (PRD §6 P2) is explicitly deferred by the PRD and
  spans a second app outside this repo.
- Coin-list expansion to top 10 (P1) was declined by the owner 2026-07-07.
- The PRD §8 X follow-list dashboard link was deliberately dropped in
  `PHASE2_DASHBOARD_PROMPT.md` ("keep footer minimal"); the list itself is
  manual curation by the owner, nothing to build.
- `config/macro-events.json` needs its yearly refresh when extending into
  2027 (currently covers through Dec 2026).

**Briefing refinement SHIPPED 2026-08-09** (owner: too much Fear & Greed,
too much coin-by-coin funding/OI prose the dashboard already shows, not
enough real interpretation of the news). Governing decision: **the AI
writes only what is judgement; everything that is arithmetic is rendered
deterministically.** Don't reverse this — if a future stat can be derived
from stored numbers, render it, don't ask Claude to describe it.

- **Out of the Claude schema:** `positioning` (per-coin prose) and
  `sentiment_note`. Positioning is now `buildPositioningGrid()` in
  `lib/digest.js` — a monospace `<pre>` grid (funding-band emoji for
  color, ▲/▼ for direction, a two-word flow tag from `oiPriceTag()` in
  `lib/interpret.js`), shared by the AI message *and* the raw fallback so
  the two can't disagree. Sentiment is one line: "Fear & Greed 42 · Fear".
- **Into the schema:** a required `narrative` object — `headline`,
  `synthesis` (4–6 sentences), `market_reaction`, `tension`, `conviction`
  (high/medium/low), `news_tone` (risk-on/risk-off/mixed/quiet) — plus
  `category`/`impact`/`tone` and an optional `assets` array per story, and
  a `watch_next` array. The schema is the main behavioral lever; keep
  `market_reaction` and `tension` **required** or the model quietly stops
  doing the cross-check and the steelman, which is the whole point.
- **Headline tone scoring** (owner-requested 2026-08-09) is an LLM
  judgement, not NLP: the prompt insists tone tracks *market implication*,
  never the writing style ("emotive language is not bullish"), and that
  `neutral` is a real answer. The per-story **tally** (`toneTally()` in
  `lib/digest.js`) is counted from those labels rather than asked of the
  model — same judgement-vs-arithmetic split as everything else. Note
  `news_tone` covers the whole feed and may legitimately disagree with the
  top-story tally.
- **Coin attribution** (owner clarified 2026-08-09): the earlier "stay
  generic" note was about avoiding a *systematic coin-by-coin walkthrough*,
  not a ban. The prompt now defaults to crypto-wide/macro but explicitly
  tells the model to name a coin (and fill `assets`) when the story is
  genuinely specific and consequential. Don't re-tighten this to a blanket
  prohibition.
- **System prompt** gained a seven-step synthesis method (cluster
  syndicated headlines → classify the pressure source → filter on whether
  a story changes ownership/cost/access/trust → go second-order →
  cross-examine the story against price/funding/OI → steelman → set
  conviction honestly), plus an explicit scope rule: crypto-wide and macro,
  name a coin only when the story is genuinely coin-specific and large.
  No-predictions rules unchanged; quiet days must read as quiet.
- `formatDigestMessage(digest, date, inputs)` takes a third arg now — the
  raw inputs, for the grid + F&G/macro lines. Without it those blocks are
  skipped (no crash).
- **`app/components/BriefingBody.js`** is the single renderer for the full
  briefing, used by `PulseHero` (so `/` and `/flash`) and `/archive`. It
  still renders legacy `positioning`/`sentiment_note` when present so old
  archived digests stay complete — leave that fallback in.

**Disclosure rows + Flash button feedback SHIPPED 2026-08-09** (owner: the
small blue "Read the full briefing" / "All 60 headlines" links were easy to
miss, and the Flash button gave no sign it was working).

- `ROW_TAB` + `Chevron` in `app/components/ui.js` are now the shared look
  for every second-level expander: full-width click target, hover tint,
  chevron chip — the Card-header contract one level quieter. `Disclose`
  and the news card's show-more/less/clear labels both use them, so new
  expanders should too rather than rolling a bare text link. The news
  footer's generated CSS switched `display:inline-flex` → `flex` to match.
- `/flash` gained the app's **second** inline script (`TICK_SCRIPT` in
  `app/flash/page.js`), same raw-HTML-no-client-component pattern as the
  theme toggle. It does two things the server can't: a "⏳ Running…" button
  state during the ~30–60s wait (with a double-submit guard), and a live
  m:ss cooldown that re-enables the button at zero instead of freezing
  until reload. Both are cosmetic — the form still works with JS off and
  the cooldown is still enforced in the Firestore transaction. One form
  now serves both states; `disabled:` Tailwind variants carry the look, so
  the script only flips `disabled` and the label.
- Verified in headless Chromium (20 checks: ticking, re-enable at zero,
  running state, double-submit guard, full-row hit area at the right edge,
  hover tint, both themes). No bundle growth — the page is still 151 B.

**Advance-page coaching + clickable stories SHIPPED 2026-08-09** (owner is
a beginner reading advanced stats and wanted a refresher per section; also
wanted briefing stories to open the source article).

- **`app/components/advanceGuide.js` is the single source for all Advance
  explanatory copy.** Each entry has `one` (a two-line grey footnote,
  always visible under the card) and `body` (the full text, used by BOTH
  the card's ⓘ popover and the "How to read this page" panel at the top of
  `/advance`). The old per-card `*_EXPLAINER` constants are gone — add new
  copy here or the three surfaces will drift. Both layers exist on purpose:
  the owner had never found the ⓘ, so the footnote is the discoverable one.
  `Footnote` lives in `ui.js` and renders even when a card's data is
  unavailable.
- **Briefing stories link to the source article.** The model never sees or
  emits URLs — it sets `headline_index` (required) pointing at the `i` of
  an input headline, and `attachStoryLinks()` in `lib/digest.js` resolves
  that server-side to a URL. `toPromptPayload()` in `lib/claude.js` adds
  the `i` and **strips `url`** from headlines before they reach Claude
  (saves tokens; a URL it cannot see is a URL it cannot invent). Any index
  that is missing, non-integer, negative or out of range yields no link
  rather than a wrong one — keep that validation. Applied on both the
  scheduled and flash paths. Old stored digests have no `url`, so
  `BriefingBody` falls back to plain text.

**Anti-hallucination guardrails SHIPPED 2026-08-10** (owner: with this much
subjectivity in the briefing, it's hard to tell high-quality signal from
confident AI slop — "quality is paramount, even if it means less depth").
Governing principle: **the synthesis can't be validated automatically, but
the hard facts underneath it can be** — so validate those in code and make
the model's confidence auditable.

- **Prompt** gained an `EPISTEMIC DISCIPLINE` section (the most important
  one): a three-tier fact / attributed-claim / inference rule with required
  hedging on inferences; a ban on inventing any specific (number, date,
  name, ticker, institution) not in the input; no invented causation
  ("alongside", not "because"); no fabricated history ("largest since
  March"); don't stretch one syndicated wire story into "reports"; and
  explicit permission for `top_stories` to hold 2, 1 or 0 entries. Also a
  `BEFORE YOU EMIT` self-check. Step 4 (second-order) got a leash — it was
  the biggest fabrication vector the earlier refinement introduced.
- **`conviction_basis`** is now a required schema field: one sentence of
  working, naming the evidence AND what couldn't be verified. Rendered
  under the narrative. `high` conviction now has a hard bar (3+ independent
  stories AND market corroboration).
- **`inputs.dataQuality`** (in `assembleDigestInputs`) counts headlines,
  recent headlines and distinct sources, and sets `thin`. The model reads
  real counts instead of guessing its evidence base; the prompt keys the
  conviction bar off it.
- **`lib/verify.js` → `verifyFigures()`** is the deterministic check: every
  percentage and dollar amount in the AI's prose must match a figure from
  the input (prices, funding, OI, F&G, or a number quoted in a headline),
  with tolerance for rounding. `learn_today` is exempt (illustrative
  numbers are legitimate). Result is stored as `digest.check` and surfaced
  as an amber note on the page and a line in Telegram. **Advisory only —
  it never blocks or edits the briefing.**
- **`sharesSubstance()`** guards story links: the summary and the resolved
  headline must share a substantive word, else no link. A link to the wrong
  article costs more trust than a missing one.

Ideas deliberately NOT built yet (discussed with the owner): a second
"critic" Claude pass (doubles cost), a thumbs-up/down feedback loop stored
in Firestore for tracking quality over time, and auto-downgrading
conviction when `dataQuality.thin` contradicts it.

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
| `app/api/flash/route.js` | On-demand: cooldown-gated PUBLIC endpoint → lean ingest + 4h flash digest → `flash/latest` |
| `lib/flash.js` | Flash: cooldown math, lean ingest, `runFlash` orchestrator, `flash/latest` reader |
| `app/flash/page.js` | The Flash page (button + last real-time reaction read) |
| `app/api/screener/route.js` | Daily cron: build the screener (Binance futures) → `screener/latest` |
| `app/api/screener/refresh/route.js` | Public cooldown-gated REFRESH → rebuild screener now |
| `lib/screener.js` | Screener: fetchers (batched) + all pure math + insights/summary + reader |
| `lib/screener-live.js` | 15-min live-price overlay refresh (piggybacks on `/api/ingest`) |
| `app/screener/page.js` + `[coin]/page.js` | Screener list (cards + zero-JS sort table) + per-coin detail |
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
