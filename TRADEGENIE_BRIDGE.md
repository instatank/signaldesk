# TradeGenie Bridge — design + build plan

Status: **scoped, not built.** Owner approved 2026-08-10 ("nice, clean
linkage… basic bridging to start"). This is the design record and the
step-by-step plan; it spans **two repos**, so it lives here and is mirrored
by a pointer in TradeGenie's `AGENTS.md`.

Closes PRD §6 P2 ("Link/bridge into TradeGenie"), the last unbuilt item on
the SignalDesk roadmap.

## The idea in one line

When a trade is saved in TradeGenie, staple a small, frozen snapshot of what
the market looked like at that moment — so a year of trades carries a year of
weather reports, and patterns like "I lose money buying into greed" become
visible in aggregate.

## Scope discipline (read before building)

The owner asked for **basic bridging only**. Phase A below is the whole job.
Phase B is a roadmap, explicitly **not** in this build. If a Phase A step
starts growing an analysis screen, stop — that's Phase B.

The bridge is a **capture** feature. It writes context onto trades and shows
it back on the trade page. It does not aggregate, score, or advise.

## The two apps (verified 2026-08-10 by reading both repos)

| | SignalDesk | TradeGenie |
|---|---|---|
| Repo | `instatank/signaldesk` | `instatank/TradeGenie` |
| Working branch | `claude/new-session-8uz6j0` (no `main`) | `main` (direct commits, auto-deploys) |
| Stack | Next.js 15 App Router, **JS**, Tailwind v4 | Next.js 15 App Router, **TypeScript**, Tailwind v3 |
| Storage | Firestore via `FIREBASE_SERVICE_ACCOUNT` (one JSON blob) | Firestore via `FIREBASE_PROJECT_ID` / `CLIENT_EMAIL` / `PRIVATE_KEY` |
| Tests | `npm test` (node:test, offline) | `npm run typecheck` + `lint` + `build` |

**They almost certainly use different Firebase projects** (different env
shapes, configured separately). So the bridge is **HTTP, not a shared
database**. That is also the better design: one small public contract, no
shared credentials, either app can be rebuilt without touching the other.

## Architecture

```
TradeGenie                                     SignalDesk
  saveTrade()                                    /api/snapshot
      │                                                │
      │  GET /api/snapshot?instrument=SOL              │
      ├───────────────────────────────────────────────►│ reads Firestore
      │                                                │ (data already
      │  ◄── 200 {fearGreed, funding, price, …}        │  ingested — NO
      │      (or timeout/failure → null)               │  new fetching)
      ▼
  trade.marketContext = snapshot   ← frozen forever, never recomputed
```

**Non-negotiable: the bridge is never load-bearing.** If SignalDesk is down,
slow, or returns junk, the trade still saves with `marketContext: null`. Same
principle as "AI is optional, never load-bearing" — the journal must never
fail because the market-data app had a bad day. 2-second timeout, catch
everything, move on.

**Frozen, not live.** The snapshot is copied onto the trade doc and never
refreshed. The whole point is what the market looked like *then*.

## The snapshot payload (keep it small)

Built entirely from data SignalDesk already stores. No new API calls, so the
endpoint is fast and free.

```jsonc
{
  "capturedAt": "2026-08-10T09:14:00.000Z",
  "source": "signaldesk",
  "version": 1,                     // bump if the shape ever changes
  "instrument": "SOL",              // echoed back when asked for
  "fearGreed": { "value": 72, "classification": "Greed" },
  "coin": {                         // only the asked-for coin, when tracked
    "symbol": "SOL",
    "price": 182.4,
    "change24h": 3.1,
    "fundingRate": 0.041,
    "fundingBand": "amber",
    "fundingLabel": "Mildly bullish",
    "oiChange24h": 5.2,
    "flowTag": "New money entering longs"
  },
  "btc": { "price": 71234, "change24h": 1.2 },   // always, as the backdrop
  "topHeadline": { "title": "…", "source": "CoinDesk", "url": "…", "publishedAt": "…" },
  "briefingHeadline": "…",          // narrative.headline from the latest digest
  "macroNext": { "name": "US CPI (July data)", "date": "2026-08-12" }
}
```

Every field is nullable. A missing section returns `null`, never a 500.

## Phase A — the build (one commit per step)

### Step 1 — SignalDesk: `lib/snapshot.js` (pure shaping + reader)
Assemble the payload from the latest `metrics` doc, `headlines`, the latest
`digests` doc, and `config/macro-events.json`. Reuse `lib/interpret.js` for
`fundingLabel`/`flowTag` so the snapshot can never disagree with the
dashboard or the digest. Pure helpers exported for tests.

### Step 2 — SignalDesk: `app/api/snapshot/route.js`
`GET`, returns the JSON above. Auth: `Authorization: Bearer $SNAPSHOT_TOKEN`
— a **new** secret, deliberately not `CRON_SECRET` (TradeGenie should not
hold the key that can trigger digests). Accepts `?instrument=SOL`.
`export const dynamic = 'force-dynamic'`. Never throws: on any internal
failure return `200` with null sections rather than an error status, so a
half-empty snapshot still beats none.
Tests in `tests/snapshot.test.mjs`: auth rejection, shaping, missing-data
degradation.

### Step 3 — SignalDesk: env + docs
Add `SNAPSHOT_TOKEN` to `.env.example` and the SETUP.md env table. **Owner
action:** generate one (`openssl rand -hex 32`) and add it in Vercel to both
projects.

### Step 4 — TradeGenie: `lib/market-context.ts`
`captureMarketContext(instrument): Promise<MarketContext | null>` — one
`fetch` with `AbortSignal.timeout(2000)`, wrapped in try/catch, returns
`null` on **any** failure. Zod-validate the response (repo already uses zod)
so a malformed payload becomes `null` rather than corrupt journal data.
Reads `SIGNALDESK_SNAPSHOT_URL` + `SIGNALDESK_SNAPSHOT_TOKEN`; if either is
unset, return `null` immediately without a network call — the feature is off
until configured, and nothing breaks.

### Step 5 — TradeGenie: type + wire into the three save paths
Add `marketContext?: MarketContext | null` to `Trade` in `lib/types.ts`.
All trade writes funnel through `db.create("trades", …)` in `app/actions.ts`
at exactly three sites (verified):
- `createTradeAction` (~L400) — the full trade form
- `quickLogTradeAction` (~L445) — quick log
- `createTradeFromStructured` (~L1181) — the voice/inbox flow

Add one explicit line to each rather than hiding the fetch inside the generic
`db.create` wrapper in `lib/data.ts` — that wrapper serves every collection,
and magic there would be a trap for the next session.

**Friction budget check:** TradeGenie's hard limit is <30s for a quick trade
note. A 2s-capped, non-blocking fetch fits, but keep it off the critical path
of the redirect if it ever feels slow.

### Step 6 — TradeGenie: show it on the trade page
`app/trades/[id]/page.tsx` — a collapsed "Market context at entry" panel,
read-only, following the repo's "exhaustive but lean" pattern. Old trades
have no `marketContext`; render nothing for them, never a broken panel.

### Step 7 — Docs in both repos
SignalDesk `CLAUDE.md` (endpoint + token) and TradeGenie `AGENTS.md` /
`CLAUDE.md` (the new field + where it comes from). Mark PRD §6 P2 closed.

## Phase B — roadmap (NOT this build)

1. **Backfill** — SignalDesk keeps `metrics` history, so `/api/snapshot?at=<ISO>`
   could reconstruct context for trades already logged.
2. **Grouped analysis** — "win rate when F&G > 75", "R-multiple by funding
   band" on TradeGenie's `/analytics`. This is where the real payoff is, and
   it needs ~30 trades carrying context before it says anything true.
3. **Weekly review** — surface one context-based pattern in the weekly review.
4. **Reverse direction** — SignalDesk's briefing notes the coins with open
   positions. Powerful, but it makes the briefing position-aware; think hard
   before crossing that line, since the briefing is meant to inform, not to
   flatter the book.

## Open questions for the owner

1. **Same Firebase project or two?** Doesn't change the design (HTTP either
   way), but worth knowing.
2. **Snapshot on save, or on status change too?** Plan captures at *creation*.
   Capturing again at close would enable entry-vs-exit comparison — more
   value, slightly more complexity. Phase B unless he wants it now.
