// Offline tests for the TradeGenie bridge's snapshot layer.
//
// The slot resolver gets the most attention on purpose: it is the one
// comparison in this feature that can be silently, permanently wrong.
// Mapping a 06:00 IST trade forward to the 07:00 briefing published an hour
// later would show the trader "knowing" things they could not have known and
// would poison every downstream pattern. Every case below that crosses a day,
// month or year boundary exists to pin that down.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSlot,
  previousSlot,
  slotFromParts,
  normalizeInstrument,
  matchAsset,
  shapeCoin,
  buildSnapshot,
  getSnapshot,
  SNAPSHOT_VERSION,
} from '../lib/snapshot.js';

// IST is UTC+05:30, so 07:00 IST = 01:30 UTC and 19:00 IST = 13:30 UTC.
// Helper: build the UTC instant for an IST wall-clock time.
function ist(dateStr, hh, mm = 0, ss = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - 5.5 * 60 * 60 * 1000);
}

describe('resolveSlot — the briefing at or before the trade', () => {
  test('a mid-morning trade maps to the same day 07:00', () => {
    const s = resolveSlot(ist('2026-08-10', 9, 14));
    assert.equal(s.date, '2026-08-10');
    assert.equal(s.slot, '07');
    assert.equal(s.id, '2026-08-10-07');
  });

  test('THE case: 06:00 IST maps BACK to the previous evening, never forward', () => {
    const s = resolveSlot(ist('2026-08-10', 6, 0));
    assert.equal(s.id, '2026-08-09-19');
  });

  test('one second before 07:00 is still the previous evening', () => {
    assert.equal(resolveSlot(ist('2026-08-10', 6, 59, 59)).id, '2026-08-09-19');
  });

  test('exactly 07:00:00 belongs to the 07 slot (at-or-before includes it)', () => {
    assert.equal(resolveSlot(ist('2026-08-10', 7, 0, 0)).id, '2026-08-10-07');
  });

  test('an afternoon trade still belongs to 07, not to the evening ahead of it', () => {
    assert.equal(resolveSlot(ist('2026-08-10', 18, 59, 59)).id, '2026-08-10-07');
  });

  test('exactly 19:00:00 belongs to the 19 slot', () => {
    assert.equal(resolveSlot(ist('2026-08-10', 19, 0, 0)).id, '2026-08-10-19');
  });

  test('late night stays on the same day 19', () => {
    assert.equal(resolveSlot(ist('2026-08-10', 23, 59, 59)).id, '2026-08-10-19');
  });

  test('IST midnight rolls back to the previous evening', () => {
    assert.equal(resolveSlot(ist('2026-08-10', 0, 0, 0)).id, '2026-08-09-19');
  });

  test('rolls back across a month boundary', () => {
    assert.equal(resolveSlot(ist('2026-08-01', 3, 30)).id, '2026-07-31-19');
  });

  test('rolls back across a year boundary', () => {
    assert.equal(resolveSlot(ist('2026-01-01', 1, 15)).id, '2025-12-31-19');
  });

  test('rolls back across a leap day', () => {
    assert.equal(resolveSlot(ist('2028-03-01', 5, 0)).id, '2028-02-29-19');
  });

  test('slotAt is the real UTC instant of the briefing', () => {
    // 07:00 IST = 01:30 UTC.
    assert.equal(resolveSlot(ist('2026-08-10', 9, 0)).slotAt.toISOString(), '2026-08-10T01:30:00.000Z');
    // 19:00 IST = 13:30 UTC.
    assert.equal(resolveSlot(ist('2026-08-10', 20, 0)).slotAt.toISOString(), '2026-08-10T13:30:00.000Z');
  });

  test('slotAt is never after the instant it was resolved from', () => {
    // Sweep every 10 minutes across two days: the invariant that makes
    // lookahead structurally impossible.
    const start = ist('2026-08-09', 0, 0).getTime();
    for (let i = 0; i < 288; i += 1) {
      const at = new Date(start + i * 10 * 60 * 1000);
      assert.ok(resolveSlot(at).slotAt.getTime() <= at.getTime(), `lookahead at ${at.toISOString()}`);
    }
  });

  test('accepts an ISO string as well as a Date', () => {
    assert.equal(resolveSlot('2026-08-10T01:29:00.000Z').id, '2026-08-09-19');
    assert.equal(resolveSlot('2026-08-10T01:30:00.000Z').id, '2026-08-10-07');
  });

  test('a garbage timestamp resolves to null, not to a plausible default', () => {
    assert.equal(resolveSlot('not-a-date'), null);
    assert.equal(resolveSlot(new Date('nope')), null);
  });
});

describe('previousSlot — walks backwards only', () => {
  test('19 steps back to the same day 07; 07 steps back to the previous 19', () => {
    const evening = resolveSlot(ist('2026-08-10', 20, 0));
    assert.equal(evening.id, '2026-08-10-19');
    const morning = previousSlot(evening);
    assert.equal(morning.id, '2026-08-10-07');
    assert.equal(previousSlot(morning).id, '2026-08-09-19');
  });

  test('each step is strictly earlier', () => {
    let cursor = resolveSlot(ist('2026-01-01', 8, 0));
    for (let i = 0; i < 6; i += 1) {
      const prev = previousSlot(cursor);
      assert.ok(prev.slotAt < cursor.slotAt);
      cursor = prev;
    }
  });
});

describe('slotFromParts — explicit date+slot', () => {
  test('round-trips a resolved slot', () => {
    const s = slotFromParts('2026-08-10', '19');
    assert.equal(s.id, '2026-08-10-19');
    assert.equal(s.slotAt.toISOString(), '2026-08-10T13:30:00.000Z');
  });

  test('rejects anything that is not a real slot', () => {
    assert.equal(slotFromParts('2026-08-10', '12'), null);
    assert.equal(slotFromParts('2026-08-10', ''), null);
    assert.equal(slotFromParts('10-08-2026', '07'), null);
    assert.equal(slotFromParts(null, '07'), null);
  });
});

describe('instrument matching', () => {
  const assets = [{ symbol: 'BTC' }, { symbol: 'ETH' }, { symbol: 'SOL' }];

  test('strips the quote currency and perp suffixes the trader might type', () => {
    assert.equal(normalizeInstrument('BTCUSDT'), 'BTC');
    assert.equal(normalizeInstrument('btc/usdt'), 'BTC');
    assert.equal(normalizeInstrument('SOL-PERP'), 'SOL');
    assert.equal(normalizeInstrument('ETHUSD'), 'ETH');
    assert.equal(normalizeInstrument('  sol  '), 'SOL');
    assert.equal(normalizeInstrument(''), null);
  });

  test('matches tracked assets and shrugs at untracked ones', () => {
    assert.equal(matchAsset('BTCUSDT', assets), 'BTC');
    assert.equal(matchAsset('sol', assets), 'SOL');
    assert.equal(matchAsset('NIFTY', assets), null);
    assert.equal(matchAsset(null, assets), null);
  });
});

describe('shapeCoin', () => {
  const latest = {
    prices: { BTC: { usd: 71234, change24hPct: 1.2 }, SOL: { usd: 182.4, change24hPct: 3.1 } },
    derivatives: {
      BTC: { fundingRate: 0.0006, openInterest: 110, source: 'binance' },
      SOL: { fundingRate: 0.00041, openInterest: 105, source: 'okx' },
    },
  };
  const dayAgo = {
    derivatives: {
      BTC: { fundingRate: 0.0004, openInterest: 100, source: 'binance' },
      SOL: { fundingRate: 0.0004, openInterest: 100, source: 'binance' }, // source flipped
    },
  };

  test('carries price, funding read and OI flow using the shared interpreters', () => {
    const btc = shapeCoin('BTC', latest, dayAgo);
    assert.equal(btc.symbol, 'BTC');
    assert.equal(btc.price, 71234);
    assert.equal(btc.fundingBand, 'red');
    assert.equal(btc.fundingLabel, 'Overheated longs');
    assert.ok(Math.abs(btc.oiChange24h - 10) < 1e-9);
    assert.equal(btc.flowTag, 'new longs');
  });

  test('suppresses a cross-source OI delta (different pools, misleading number)', () => {
    const sol = shapeCoin('SOL', latest, dayAgo);
    assert.equal(sol.oiChange24h, null);
    assert.equal(sol.flowTag, null);
    assert.equal(sol.fundingBand, 'amber'); // funding still reads fine
  });

  test('returns null for an untracked or absent coin', () => {
    assert.equal(shapeCoin(null, latest, dayAgo), null);
    assert.equal(shapeCoin('DOGE', latest, dayAgo), null);
  });
});

describe('buildSnapshot', () => {
  const slot = resolveSlot(ist('2026-08-10', 9, 14));
  const assets = [{ symbol: 'BTC' }, { symbol: 'SOL' }];
  const capturedAt = new Date('2026-08-10T09:14:00.000Z');

  test('assembles the full payload', () => {
    const snap = buildSnapshot({
      slot,
      instrument: 'SOL',
      assets,
      latest: {
        prices: { BTC: { usd: 71234, change24hPct: 1.2 }, SOL: { usd: 182.4, change24hPct: 3.1 } },
        derivatives: { SOL: { fundingRate: 0.00041, openInterest: 105, source: 'binance' } },
        fng: { value: 72, classification: 'Greed' },
      },
      dayAgo: { derivatives: { SOL: { fundingRate: 0.0004, openInterest: 100, source: 'binance' } } },
      headline: {
        title: 'Something happened',
        source: 'CoinDesk',
        url: 'https://example.com/a',
        publishedAt: new Date('2026-08-10T01:00:00.000Z'),
      },
      digest: { narrative: { headline: 'Risk appetite returns' } },
      briefingSlotId: '2026-08-10-07',
      macroEvents: [{ name: 'US CPI (July data)', date: '2026-08-12' }],
      capturedAt,
    });

    assert.equal(snap.marketDate, '2026-08-10');
    assert.equal(snap.slot, '07');
    assert.equal(snap.version, SNAPSHOT_VERSION);
    assert.equal(snap.source, 'signaldesk');
    assert.equal(snap.capturedAt, '2026-08-10T09:14:00.000Z');
    assert.equal(snap.instrument, 'SOL');
    assert.deepEqual(snap.fearGreed, { value: 72, classification: 'Greed' });
    assert.equal(snap.coin.symbol, 'SOL');
    assert.equal(snap.coin.price, 182.4);
    assert.deepEqual(snap.btc, { price: 71234, change24h: 1.2 });
    assert.equal(snap.topHeadline.source, 'CoinDesk');
    assert.equal(snap.briefingHeadline, 'Risk appetite returns');
    assert.equal(snap.briefingSlot, '2026-08-10-07');
    assert.deepEqual(snap.macroNext, { name: 'US CPI (July data)', date: '2026-08-12' });
  });

  test('every section is independently nullable — no data still yields a valid snapshot', () => {
    const snap = buildSnapshot({ slot, capturedAt });
    assert.equal(snap.marketDate, '2026-08-10');
    assert.equal(snap.fearGreed, null);
    assert.equal(snap.coin, null);
    assert.equal(snap.btc, null);
    assert.equal(snap.topHeadline, null);
    assert.equal(snap.briefingHeadline, null);
    assert.equal(snap.macroNext, null);
  });

  test('falls back to market_pulse for digests archived before narrative existed', () => {
    const snap = buildSnapshot({ slot, digest: { market_pulse: 'Quiet tape.' }, capturedAt });
    assert.equal(snap.briefingHeadline, 'Quiet tape.');
  });

  test('an untracked instrument still gets the BTC backdrop', () => {
    const snap = buildSnapshot({
      slot,
      instrument: 'NIFTY',
      assets,
      latest: { prices: { BTC: { usd: 71234, change24hPct: 1.2 } } },
      capturedAt,
    });
    assert.equal(snap.coin, null);
    assert.equal(snap.btc.price, 71234);
  });

  test('macroNext is judged from the slot instant, not from today', () => {
    // An event that already passed relative to the slot must not show up.
    const snap = buildSnapshot({
      slot,
      macroEvents: [{ name: 'FOMC', date: '2026-07-29' }, { name: 'US CPI', date: '2026-08-12' }],
      capturedAt,
    });
    assert.equal(snap.macroNext.name, 'US CPI');
  });
});

// --- a tiny in-memory Firestore stand-in ----------------------------------
// Supports exactly the query shapes lib/snapshot.js uses: single-field range
// filters + orderBy desc + limit, and doc-id gets.
function fakeDb({ metrics = [], headlines = [], digests = {} } = {}) {
  const collections = { metrics, headlines };
  function query(name, filters = []) {
    return {
      where: (field, op, value) => query(name, [...filters, { field, op, value }]),
      orderBy: () => query(name, filters),
      limit: (n) => ({
        get: async () => {
          const field = name === 'metrics' ? 'ts' : 'ingestedAt';
          const rows = collections[name]
            .filter((row) =>
              filters.every(({ op, value }) =>
                op === '<=' ? row[field] <= value : op === '>=' ? row[field] >= value : true
              )
            )
            .sort((a, b) => b[field] - a[field])
            .slice(0, n);
          return { empty: rows.length === 0, docs: rows.map((r) => ({ data: () => r })) };
        },
      }),
    };
  }
  return {
    collection: (name) => ({
      ...query(name),
      doc: (id) => ({
        get: async () => ({ exists: id in digests, data: () => digests[id] }),
      }),
    }),
  };
}

describe('getSnapshot — reads bounded at or before the slot', () => {
  const slot = resolveSlot(ist('2026-08-10', 9, 14)); // → 2026-08-10-07, slotAt 01:30Z
  const assets = [{ symbol: 'BTC' }];

  const beforeSlot = { ts: new Date('2026-08-10T01:15:00Z'), prices: { BTC: { usd: 71000, change24hPct: 1 } } };
  const afterSlot = { ts: new Date('2026-08-10T04:00:00Z'), prices: { BTC: { usd: 99999, change24hPct: 50 } } };
  const dayBefore = { ts: new Date('2026-08-09T01:20:00Z'), derivatives: { BTC: { openInterest: 100, source: 'binance' } } };

  test('uses the metrics snapshot at or before the slot, never a later one', async () => {
    const db = fakeDb({ metrics: [beforeSlot, afterSlot, dayBefore] });
    const snap = await getSnapshot(db, { slot, instrument: 'BTC', assets });
    assert.equal(snap.btc.price, 71000); // not 99999
  });

  test('ignores a headline ingested after the slot', async () => {
    const db = fakeDb({
      headlines: [
        { ingestedAt: new Date('2026-08-10T01:00:00Z'), title: 'Before', source: 'A', url: 'u1' },
        { ingestedAt: new Date('2026-08-10T02:00:00Z'), title: 'After', source: 'B', url: 'u2' },
      ],
    });
    const snap = await getSnapshot(db, { slot, assets });
    assert.equal(snap.topHeadline.title, 'Before');
  });

  test('ignores a headline older than 24h', async () => {
    const db = fakeDb({
      headlines: [{ ingestedAt: new Date('2026-08-07T01:00:00Z'), title: 'Ancient', source: 'A' }],
    });
    const snap = await getSnapshot(db, { slot, assets });
    assert.equal(snap.topHeadline, null);
  });

  test('takes the slot digest when it exists', async () => {
    const db = fakeDb({ digests: { '2026-08-10-07': { digest: { narrative: { headline: 'Today' } } } } });
    const snap = await getSnapshot(db, { slot, assets });
    assert.equal(snap.briefingHeadline, 'Today');
    assert.equal(snap.briefingSlot, '2026-08-10-07');
  });

  test('falls back to an EARLIER slot when that run failed, and says which', async () => {
    const db = fakeDb({ digests: { '2026-08-09-19': { digest: { narrative: { headline: 'Last night' } } } } });
    const snap = await getSnapshot(db, { slot, assets });
    assert.equal(snap.briefingHeadline, 'Last night');
    assert.equal(snap.briefingSlot, '2026-08-09-19');
  });

  test('never falls FORWARD to a later slot', async () => {
    const db = fakeDb({ digests: { '2026-08-10-19': { digest: { narrative: { headline: 'Tonight' } } } } });
    const snap = await getSnapshot(db, { slot, assets });
    assert.equal(snap.briefingHeadline, null);
    assert.equal(snap.briefingSlot, null);
  });

  test('gives up rather than reaching back further than two days', async () => {
    const db = fakeDb({ digests: { '2026-08-07-19': { digest: { narrative: { headline: 'Stale' } } } } });
    const snap = await getSnapshot(db, { slot, assets });
    assert.equal(snap.briefingHeadline, null);
  });

  test('an empty database yields a valid, all-null snapshot rather than throwing', async () => {
    const snap = await getSnapshot(fakeDb(), { slot, instrument: 'BTC', assets });
    assert.equal(snap.marketDate, '2026-08-10');
    assert.equal(snap.coin, null);
    assert.equal(snap.btc, null);
    assert.equal(snap.topHeadline, null);
  });

  test('one failing collection degrades one field, not the snapshot', async () => {
    const db = fakeDb({ metrics: [beforeSlot] });
    const original = db.collection;
    db.collection = (name) =>
      name === 'headlines'
        ? { where: () => { throw new Error('firestore is having a day'); }, doc: () => {} }
        : original(name);
    const snap = await getSnapshot(db, { slot, instrument: 'BTC', assets });
    assert.equal(snap.topHeadline, null);
    assert.equal(snap.btc.price, 71000); // the rest survived
  });
});
