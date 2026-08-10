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

**They are on separate Firebase projects** (confirmed by the owner
2026-08-10). So the bridge is **HTTP, not a shared database** — which is
also the better design: one small contract, no shared credentials, either
app can be rebuilt without touching the other.

## The resolution decision: day-keyed, not moment-keyed

**Decided 2026-08-10.** The snapshot is keyed to the **briefing slot in
effect when the trade was entered**, not to the exact second of the save.

The owner proposed day-level linking on simplicity grounds. It's the right
call, for a stronger reason than simplicity:

- **Nothing analytically useful is lost.** Fear & Greed updates once a day.
  Funding regimes persist across days far more than they flip within one.
  The one input that genuinely moves intraday — price — is *already* on the
  trade as `entryPrice`, captured natively by TradeGenie. Minute-resolution
  market context would add precision the journal has no question for.
- **A day key is reproducible; a live snapshot is not.** Because the key is
  derived from the trade's timestamp, the same endpoint can serve *any*
  past date — so trades already in the journal can be backfilled, and a
  failed capture can simply be retried later. A moment-in-time snapshot is
  a one-shot: miss it and that trade is contextless forever.

**Still copy, don't link.** The day's context is *fetched once and frozen
onto the trade*. A stored reference ("see digest 2026-08-10-07") would rot
if SignalDesk's data were ever cleared or reshaped, and would force a
network call on every trade-page view. A journal is a permanent record; it
must stay readable with the other app switched off.

**Pick the slot at-or-before the trade, never after.** SignalDesk publishes
at 07:00 and 19:00 IST. A trade entered at 06:00 IST must map to the
*previous evening's* 19:00 briefing — not to the 07:00 briefing published
an hour later. Mapping a trade to a briefing that did not exist yet when it
was taken is lookahead bias: it would show the trader "knowing" things they
could not have known, and would quietly poison every Phase B pattern. One
comparison to get right, and it must be got right.

**Entry only, not exit.** The context is attached at trade *creation* and
never updated on close. The decision being graded is the entry — that's
where discipline lives ("did I buy into greed?", "did I chase a crowded
long?"). Exit-day context is a Phase B question, and adding it now doubles
the data model to answer a question the journal can't yet ask.

## Architecture

```
TradeGenie                                     SignalDesk
  saveTrade()                                    /api/snapshot
      │                                                │
      │  GET /api/snapshot?date=2026-08-10             │
      │      &slot=07&instrument=SOL                   │
      ├───────────────────────────────────────────────►│ reads Firestore
      │   (slot = latest briefing AT OR BEFORE         │ (data already
      │    the trade time, in IST)                     │  ingested — NO
      │                                                │  new fetching)
      │  ◄── 200 {fearGreed, funding, price, …}        │
      │      (or timeout/failure → null)               │
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
  "marketDate": "2026-08-10",       // IST calendar date — the day key
  "slot": "07",                     // "07" | "19" — the briefing in effect
  "capturedAt": "2026-08-10T09:14:00.000Z",  // when the copy was taken
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
Assemble the payload for a **given day + slot** from the `digests` doc for
that `istSlotId()` (already the stored doc id — `2026-08-10-07`), the
`metrics` snapshot nearest that slot, `headlines` from that window, and
`config/macro-events.json`. Reuse `lib/interpret.js` for `fundingLabel` /
`flowTag` so the snapshot can never disagree with the dashboard or digest.

The slot-resolution helper is the piece to get right and to test hardest:
`resolveSlot(tradeTime)` → the latest slot **at or before** that instant in
IST, rolling back to the previous day's `19` for early-morning trades.
Pure, exported, tested with IST-midnight and DST-free edge cases.

If the requested slot has no stored digest (a cron failure that day), fall
back to the nearest *earlier* slot rather than a later one — same
no-lookahead rule — and say which slot was actually used in the response.

### Step 2 — SignalDesk: `app/api/snapshot/route.js`
`GET`, returns the JSON above. Auth: `Authorization: Bearer $SNAPSHOT_TOKEN`
— a **new** secret, deliberately not `CRON_SECRET` (TradeGenie should not
hold the key that can trigger digests). Accepts `?date=&slot=&instrument=`;
with no date it serves the current slot. `export const dynamic =
'force-dynamic'`. Never throws: on any internal failure return `200` with
null sections rather than an error status, so a half-empty snapshot still
beats none.
Tests in `tests/snapshot.test.mjs`: auth rejection, slot resolution
(including the 06:00-IST → previous-day-19 case), shaping, missing-digest
fallback, and missing-data degradation.

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
of the redirect if it ever feels slow. Because the key is a day + slot, a
failed capture is **recoverable** — the Phase B backfill can fill it in
later — so never trade save-speed for capture certainty.

### Step 6 — TradeGenie: show it on the trade page
`app/trades/[id]/page.tsx` — a collapsed "Market context at entry" panel,
read-only, following the repo's "exhaustive but lean" pattern. Old trades
have no `marketContext`; render nothing for them, never a broken panel.

### Step 7 — Docs in both repos
SignalDesk `CLAUDE.md` (endpoint + token) and TradeGenie `AGENTS.md` /
`CLAUDE.md` (the new field + where it comes from). Mark PRD §6 P2 closed.

## Phase B — roadmap (NOT this build)

1. **Backfill existing trades** — the day key makes this nearly free: walk
   trades with no `marketContext`, resolve each one's slot from its
   `tradeDateTime`, fetch, write. This is the **first** thing to build after
   Phase A, because it's what turns a handful of new trades into a dataset
   worth analysing. Bounded by how far back the `digests` collection goes.
2. **Grouped analysis** — "win rate when F&G > 75", "R-multiple by funding
   band" on TradeGenie's `/analytics`. This is where the real payoff is, and
   it needs ~30 context-carrying trades before it says anything true. Until
   then it will show noise that looks like signal — resist shipping it early.
3. **Exit-day context** — a second capture at close, enabling "entered in
   greed, exited in fear" comparisons. Only worth it once (2) exists and the
   owner actually wants the comparison.
4. **Weekly review** — surface one context-based pattern in the weekly review.
5. **Reverse direction** — SignalDesk's briefing notes the coins with open
   positions. Powerful, but it makes the briefing position-aware; think hard
   before crossing that line, since the briefing is meant to inform, not to
   flatter the book.

## Settled questions (do not relitigate)

1. **Firebase:** separate projects, one per app. Confirmed by owner
   2026-08-10. Hence HTTP, no shared Firestore access.
2. **Resolution:** day + slot, entry only, at-or-before, copied not linked.
   Decided 2026-08-10 — see the resolution section above for the reasoning.
