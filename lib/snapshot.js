// The TradeGenie bridge (see TRADEGENIE_BRIDGE.md — the design record that
// spans both repos). When a trade is saved in TradeGenie, it asks this module
// for a small, frozen snapshot of what the market looked like at that moment,
// and staples it onto the trade forever.
//
// Two properties define the whole design:
//
//   1. KEYED TO THE BRIEFING SLOT, NOT THE SECOND. SignalDesk publishes once
//      a day at 07:00 IST (twice daily until 2026-08-29). A trade is described
//      by the briefing that was in effect when it was entered. Nothing
//      analytically useful is lost — Fear & Greed moves once a day, funding
//      regimes persist — and a day+slot key is reproducible, so a failed
//      capture can be retried later. The cost of the single daily slot is
//      staleness: an evening trade's market section is bounded at that
//      morning's 07:00. If that becomes a problem, bound the metrics reads at
//      the TRADE instant while keeping the briefing keyed to the slot — do not
//      invent a slot that never published.
//
//   2. AT OR BEFORE, NEVER AFTER. A trade entered at 06:00 IST maps to the
//      PREVIOUS day's 07:00 briefing, not to today's, published an hour
//      later. Mapping a trade to a briefing that did not exist yet is
//      lookahead bias: it would show the trader "knowing" things they could
//      not have known. Every lookup here — the slot, the digest, the metrics
//      snapshot, the headline — is bounded at or before the slot instant.
//
// Everything is assembled from data already in Firestore. No new fetching, so
// the endpoint is fast and free. Every section is independently nullable: a
// half-empty snapshot beats none.
import { interpretFunding, oiPriceTag } from './interpret.js';
import { fundingBand } from './dashboard.js';
import { upcomingMacroEvents } from './macro.js';

export const SNAPSHOT_VERSION = 1;

// IST is a fixed +05:30 offset and has never observed DST, so plain offset
// arithmetic is exact here — and unlike Intl formatting it is reversible,
// which is what turns a wall-clock slot back into a UTC instant.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// The briefing slots, in IST hours, latest first. SignalDesk publishes ONCE
// a day at 07:00 IST (it ran twice daily until 2026-08-29), so resolution
// only ever produces the 07 slot.
export const SLOT_HOURS = [7];

// Slot hours that a stored digest may legitimately carry: the live schedule
// plus the retired 19:00 evening run, whose docs are still in Firestore.
// slotFromParts accepts these so an archived evening briefing stays
// addressable by id; resolveSlot never MINTS one, because mapping a trade
// forward onto a slot that no longer publishes would be fiction.
export const ADDRESSABLE_SLOT_HOURS = [19, 7];

// How far back to walk when the resolved slot has no stored digest (a cron
// failure). 2 slots = 2 days; beyond that the briefing is not "context for
// this trade" in any honest sense, so we return none rather than something.
const MAX_DIGEST_FALLBACK_SLOTS = 2;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// YYYY-MM-DD for a UTC-midnight-of-an-IST-day timestamp.
function dateStringFromIstMidnight(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Build a slot object from an IST day (UTC-midnight ms) + an IST hour.
function makeSlot(dayMs, slotHour) {
  const date = dateStringFromIstMidnight(dayMs);
  const slot = pad2(slotHour);
  return {
    date,
    slot,
    id: `${date}-${slot}`,
    // The slot's publication instant, in real (UTC) time — the ceiling for
    // every lookup below.
    slotAt: new Date(dayMs + slotHour * HOUR_MS - IST_OFFSET_MS),
  };
}

// THE one comparison this whole feature has to get right.
//
// Given any instant, return the briefing slot in effect at that instant:
// the latest 07:00 IST publication AT OR BEFORE it.
//   09:14 IST → today 07 · 07:00 IST → today 07 (a slot owns its own instant)
//   06:00 IST → YESTERDAY's 07, never today's, published an hour later
//   23:00 IST → today 07 (the briefing he has been reading all day)
// Returns null for an unparseable input rather than silently defaulting to
// now — a bad timestamp must not quietly produce a plausible-looking answer.
export function resolveSlot(at = new Date()) {
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(t)) return null;

  // Read the IST wall clock by shifting into the offset and using UTC getters.
  const ist = new Date(t + IST_OFFSET_MS);
  const hour = ist.getUTCHours();
  let dayMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());

  let slotHour = SLOT_HOURS.find((h) => hour >= h);
  if (slotHour === undefined) {
    // Before the first slot of the day: the briefing in effect is yesterday's.
    slotHour = SLOT_HOURS[0];
    dayMs -= DAY_MS;
  }

  return makeSlot(dayMs, slotHour);
}

// The slot immediately before this one (one day back, now that there is one
// slot a day). Used to walk back when a slot has no stored digest —
// backwards only, same no-lookahead rule.
export function previousSlot(slot) {
  if (!slot) return null;
  return resolveSlot(new Date(slot.slotAt.getTime() - 1));
}

// Rebuild a slot from an explicit date + slot pair (the ?date=&slot= form of
// the API). Accepts the retired 19 slot so archived evening briefings stay
// addressable by id. Returns null for anything that isn't a real slot id, so
// a typo can't be mistaken for a valid day.
export function slotFromParts(date, slot) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const hour = Number(slot);
  if (!ADDRESSABLE_SLOT_HOURS.includes(hour)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const dayMs = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(dayMs)) return null;
  return makeSlot(dayMs, hour);
}

// --- instrument matching --------------------------------------------------
// TradeGenie's instrument field is free text the trader typed ("BTC", "btc",
// "BTCUSDT", "BTC/USDT", "BTC-PERP"). Reduce it to a bare symbol so it can be
// matched against the tracked-asset list. An unmatched instrument is not an
// error — it just means no per-coin section (BTC still ships as the backdrop).
export function normalizeInstrument(instrument) {
  const raw = String(instrument || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw) return null;
  const stripped = raw.replace(/(USDTPERP|USDPERP|PERP|USDT|USDC|USD)$/, '');
  return stripped || raw;
}

export function matchAsset(instrument, assets = []) {
  const symbol = normalizeInstrument(instrument);
  if (!symbol) return null;
  return assets.find((a) => a.symbol.toUpperCase() === symbol)?.symbol || null;
}

// --- shaping (pure) -------------------------------------------------------

// One coin's market context: price + funding read + OI flow, using the same
// interpretation helpers as the dashboard and the digest so the snapshot can
// never disagree with what the briefing said that morning.
export function shapeCoin(symbol, latest, dayAgo) {
  if (!symbol) return null;
  const price = latest?.prices?.[symbol] || null;
  const current = latest?.derivatives?.[symbol] || null;
  const previous = dayAgo?.derivatives?.[symbol] || null;
  if (!price && !current) return null;

  // Only compare OI across the same source — Binance and OKX measure
  // different pools, so a cross-source delta would be misleading.
  let oiChange24h = null;
  if (current && previous && current.source === previous.source && previous.openInterest > 0) {
    oiChange24h = ((current.openInterest - previous.openInterest) / previous.openInterest) * 100;
  }

  const funding = current ? interpretFunding(current.fundingRate) : null;
  return {
    symbol,
    price: price?.usd ?? null,
    change24h: price?.change24hPct ?? null,
    fundingRate: current?.fundingRate ?? null,
    fundingBand: current ? fundingBand(current.fundingRate) : null,
    fundingLabel: funding?.label ?? null,
    oiChange24h,
    flowTag: oiPriceTag(price?.change24hPct ?? null, oiChange24h),
  };
}

function shapeFearGreed(latest) {
  const fng = latest?.fng;
  if (!fng || !Number.isFinite(Number(fng.value))) return null;
  return { value: Number(fng.value), classification: fng.classification ?? null };
}

function shapeBtc(latest) {
  const price = latest?.prices?.BTC || null;
  if (!price) return null;
  return { price: price.usd ?? null, change24h: price.change24hPct ?? null };
}

// narrative.headline is where the briefing's one-line thesis lives. Digests
// archived before the briefing refinement have no narrative object, so fall
// back to the pulse sentence rather than showing the trade nothing.
function shapeBriefingHeadline(digest) {
  if (!digest) return null;
  return digest.narrative?.headline || digest.market_pulse || null;
}

function shapeMacroNext(macroEvents, at) {
  const next = upcomingMacroEvents(macroEvents, at)[0];
  if (!next) return null;
  return { name: next.name, date: next.date };
}

// Assemble the payload from already-read pieces. Pure — every Firestore read
// happens in getSnapshot() below, so this is testable without a database.
export function buildSnapshot({
  slot,
  instrument = null,
  assets = [],
  latest = null,
  dayAgo = null,
  headline = null,
  digest = null,
  briefingSlotId = null,
  macroEvents = [],
  capturedAt = new Date(),
}) {
  const symbol = matchAsset(instrument, assets);
  return {
    marketDate: slot.date,
    slot: slot.slot,
    slotAt: slot.slotAt.toISOString(),
    capturedAt: capturedAt.toISOString(),
    source: 'signaldesk',
    version: SNAPSHOT_VERSION,
    instrument: instrument || null,
    fearGreed: shapeFearGreed(latest),
    coin: shapeCoin(symbol, latest, dayAgo),
    btc: shapeBtc(latest),
    topHeadline: headline
      ? {
          title: headline.title ?? null,
          source: headline.source ?? null,
          url: headline.url ?? null,
          publishedAt: headline.publishedAt ? headline.publishedAt.toISOString() : null,
        }
      : null,
    briefingHeadline: shapeBriefingHeadline(digest),
    // Which slot's briefing actually supplied briefingHeadline. Normally the
    // resolved slot; an earlier one when that day's cron failed. Never later.
    briefingSlot: briefingSlotId,
    macroNext: shapeMacroNext(macroEvents, slot.slotAt),
  };
}

// --- Firestore reads ------------------------------------------------------
// Each one is bounded at or before the slot instant. db is injected so the
// tests can hand in a fake.

async function readMetricsAt(db, at) {
  const snap = await db
    .collection('metrics')
    .where('ts', '<=', at)
    .orderBy('ts', 'desc')
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
}

// The last headline published before the slot. Capped at 24h old — a
// three-day-old headline is not "what was in the news when I entered".
async function readTopHeadline(db, at, maxAgeHours = 24) {
  const snap = await db
    .collection('headlines')
    .where('ingestedAt', '<=', at)
    .where('ingestedAt', '>=', new Date(at.getTime() - maxAgeHours * HOUR_MS))
    .orderBy('ingestedAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  return {
    title: d.title ?? null,
    source: d.source ?? null,
    url: d.url ?? null,
    publishedAt: d.publishedAt?.toDate?.() || null,
  };
}

// The stored briefing for this slot, walking BACKWARDS through earlier slots
// if the cron failed that day. Returns the digest plus the slot id it really
// came from, so the caller can say so instead of implying freshness.
async function readDigestForSlot(db, slot) {
  let cursor = slot;
  for (let i = 0; i <= MAX_DIGEST_FALLBACK_SLOTS && cursor; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design: each
    // step back is only taken when the previous slot had nothing stored.
    const doc = await db.collection('digests').doc(cursor.id).get();
    if (doc.exists) {
      const data = doc.data();
      if (data?.digest) return { digest: data.digest, slotId: cursor.id };
    }
    cursor = previousSlot(cursor);
  }
  return { digest: null, slotId: null };
}

// The whole thing: resolve → read → shape. Never fetches from the network,
// only from Firestore. Sections fail independently (Promise.allSettled), so a
// missing collection degrades one field instead of the snapshot.
export async function getSnapshot(db, { slot, instrument = null, assets = [], macroEvents = [], capturedAt = new Date() }) {
  const [latestRes, dayAgoRes, headlineRes, digestRes] = await Promise.allSettled([
    readMetricsAt(db, slot.slotAt),
    readMetricsAt(db, new Date(slot.slotAt.getTime() - DAY_MS)),
    readTopHeadline(db, slot.slotAt),
    readDigestForSlot(db, slot),
  ]);
  const value = (res, fallback = null) => (res.status === 'fulfilled' ? res.value : fallback);
  const digest = value(digestRes, { digest: null, slotId: null }) || { digest: null, slotId: null };

  return buildSnapshot({
    slot,
    instrument,
    assets,
    latest: value(latestRes),
    dayAgo: value(dayAgoRes),
    headline: value(headlineRes),
    digest: digest.digest,
    briefingSlotId: digest.slotId,
    macroEvents,
    capturedAt,
  });
}
