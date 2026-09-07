// Offline tests for the screener's pure math + interpretation. No network,
// no Firestore. The fetchers themselves are exercised live on deploy (the
// sandbox can't reach Binance), same as the rest of the app.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SORT_COLS, GRID, buildOrderVars, buildSortCss } from '../lib/screener-sort.js';
import {
  pctChange,
  sma,
  realizedDailyMove,
  drawdownFromHigh,
  percentileRank,
  compositeStrengths,
  annualizeFunding,
  dailyFunding,
  oiChangePct,
  selectUniverse,
  marketAverageSeries,
  relativeSeries,
  buildInsights,
} from '../lib/screener.js';
import { interpretScreenerTrend, interpretVsBitcoin, interpretCostToHold } from '../lib/interpret.js';

describe('screener returns math', () => {
  const closes = [100, 101, 102, 103, 104, 105, 106, 110]; // oldest→newest, 8 days

  test('pctChange over N days uses `now` as current price', () => {
    // 7 days ago = closes[len-1-7] = closes[0] = 100; now = 110 → +10%
    assert.equal(round(pctChange(closes, 110, 7)), 10);
    // 1 day ago = closes[6] = 106; now = 110 → +3.77%
    assert.equal(round(pctChange(closes, 110, 1)), 3.8);
  });

  test('pctChange returns null when history is too short', () => {
    assert.equal(pctChange(closes, 110, 30), null);
  });

  test('sma needs full window', () => {
    assert.equal(sma([1, 2, 3, 4], 4), 2.5);
    assert.equal(sma([1, 2, 3], 4), null);
  });

  test('realizedDailyMove is a positive average swing', () => {
    const v = realizedDailyMove(closes);
    assert.ok(v > 0 && v < 10, `got ${v}`);
  });

  test('drawdownFromHigh measures distance below the peak', () => {
    const highs = [100, 120, 110, 105];
    const dd = drawdownFromHigh(highs, 90, 365);
    assert.equal(round(dd.pctBelowHigh), 25); // 90 is 25% below the 120 peak
    assert.equal(dd.daysListed, 4);
  });
});

describe('percentile + composite strength', () => {
  test('percentileRank: best of the set ranks ~100', () => {
    assert.equal(percentileRank(9, [1, 3, 5, 7, 9]), 100);
    assert.equal(percentileRank(1, [1, 3, 5, 7, 9]), 20);
  });

  test('the strongest coin scores highest composite', () => {
    const rows = [
      { r30d: 50, ma200Gap: 40, dailyMove: 5 }, // clearly best
      { r30d: 10, ma200Gap: 5, dailyMove: 5 },
      { r30d: -20, ma200Gap: -30, dailyMove: 5 }, // clearly worst
    ];
    const s = compositeStrengths(rows);
    assert.ok(s[0] > s[1] && s[1] > s[2], `expected descending, got ${s}`);
    assert.ok(s[0] >= 99);
  });
});

describe('funding + open interest', () => {
  test('annualizeFunding scales an 8h rate to a yearly percent', () => {
    // steady 0.0001 (0.01%) per 8h → 0.01% × 3 × 365 ≈ 10.95%/yr
    const annual = annualizeFunding(Array(21).fill(0.0001));
    assert.ok(Math.abs(annual - 10.95) < 0.1, `got ${annual}`);
  });

  test('dailyFunding buckets 8h prints into per-day sums', () => {
    const day = 86_400_000;
    const points = [
      { ts: 0, rate: 0.0001 },
      { ts: day / 3, rate: 0.0001 },
      { ts: day + 10, rate: -0.0002 },
    ];
    const bars = dailyFunding(points, 25);
    assert.equal(bars.length, 2);
    assert.ok(Math.abs(bars[0] - 0.02) < 1e-9); // two +0.01% prints same day
    assert.ok(Math.abs(bars[1] + 0.02) < 1e-9); // one -0.02% print
  });

  test('oiChangePct is window-start to now', () => {
    assert.equal(round(oiChangePct([100, 110, 78])), -22);
    assert.equal(oiChangePct([100]), null);
  });
});

describe('universe selection', () => {
  const tickers = [
    { symbol: 'BTCUSDT', quoteVolume: '100' },
    { symbol: 'ETHUSDT', quoteVolume: '90' },
    { symbol: 'SOLUSDT', quoteVolume: '80' },
    { symbol: 'VVVUSDT', quoteVolume: '1' }, // tiny — below the top-2 cut
    { symbol: 'ETHUSDT_240927', quoteVolume: '999' }, // dated future, excluded
    { symbol: 'BTCBUSD', quoteVolume: '50' }, // non-USDT, excluded
  ];

  test('takes top-N by volume but always keeps tracked coins', () => {
    const uni = selectUniverse(tickers, 2, ['VVVUSDT']);
    const syms = uni.map((t) => t.symbol);
    assert.deepEqual(syms.slice(0, 2), ['BTCUSDT', 'ETHUSDT']); // top 2 by vol
    assert.ok(syms.includes('VVVUSDT')); // tracked, force-added
    assert.ok(!syms.some((s) => s.includes('_'))); // no dated futures
    assert.ok(!syms.includes('BTCBUSD')); // no non-USDT
  });
});

describe('relative series + insights', () => {
  test('marketAverageSeries + relativeSeries put an outperformer above zero', () => {
    const strong = [100, 110, 121];
    const weak = [100, 95, 90];
    const avg = marketAverageSeries([strong, weak], 2);
    const rel = relativeSeries(strong, avg, 2);
    assert.ok(rel[rel.length - 1] > 0, `outperformer should end above the market avg, got ${rel}`);
  });

  test('buildInsights routes coins into the right lists', () => {
    const rows = [
      { symbol: 'AUSDT', base: 'A', name: 'A', tracked: false, strength: 95, r24h: 1, r7d: 12, r30d: 3, r60d: 5, relSpark: [], detail: { annualFunding: 40 } },
      { symbol: 'BUSDT', base: 'B', name: 'B', tracked: false, strength: 20, r24h: -12, r7d: -5, r30d: -10, r60d: -55, relSpark: [], detail: { annualFunding: 2 } },
    ];
    const ins = buildInsights(rows);
    assert.equal(ins.strongest.top[0].base, 'A'); // highest strength leads
    assert.equal(ins.washedOut.top[0].base, 'B'); // worst 2-month leads
    assert.equal(ins.crowded.top[0].base, 'A'); // 40%/yr funding is crowded
    assert.ok(ins.bigMoves.top.some((c) => c.base === 'B')); // -12% is a big move
    assert.ok(ins.speed.top.some((c) => c.base === 'A')); // week >> month → accelerating
  });
});

describe('screener interpretation labels', () => {
  test('trend buckets', () => {
    assert.equal(interpretScreenerTrend({ aboveMa200: true, r7d: 2 }).label, 'uptrend');
    assert.equal(interpretScreenerTrend({ aboveMa200: true, r7d: -2 }).label, 'cooling');
    assert.equal(interpretScreenerTrend({ aboveMa200: false, r7d: 8 }).label, 'bounce');
    assert.equal(interpretScreenerTrend({ aboveMa200: false, r7d: -2 }).label, 'downtrend');
  });

  test('vs bitcoin thresholds (and BTC itself is null)', () => {
    assert.equal(interpretVsBitcoin(20, 5), 'ahead of BTC');
    assert.equal(interpretVsBitcoin(-10, 5), 'behind BTC');
    assert.equal(interpretVsBitcoin(6, 5), 'tracks BTC');
    assert.equal(interpretVsBitcoin(10, 0, true), null);
  });

  test('cost to hold labels', () => {
    assert.equal(interpretCostToHold(15).label, '~15%/yr');
    assert.equal(interpretCostToHold(-8).label, 'paid to hold');
    assert.equal(interpretCostToHold(2).label, 'normal');
  });
});

function round(v) {
  return Math.round(v * 10) / 10;
}

// --- Table sorting -----------------------------------------------------
// The table sorts with CSS `order` alone, so what we assert is the ORDER
// NUMBERS the shaper emits per row per (column, direction). The browser side
// (radios, header state, the click-to-reverse swap) is verified in Chromium.

function orderOf(vars, key) {
  // rows listed in the sequence the given var puts them in
  return vars.map((v, i) => [i, Number(v[key])]).sort((a, b) => a[1] - b[1]).map(([i]) => i);
}

describe('screener table sorting', () => {
  const rows = [
    { symbol: 'AUSDT', base: 'ETH', sizeRank: 1, price: 3000, r24h: 2, r60d: 5, trend: { label: 'cooling' }, vsBtc: 'behind BTC', worthNoting: null, relSpark: [0, -1], detail: { annualFunding: 4 } },
    { symbol: 'BUSDT', base: 'BTC', sizeRank: 2, price: 60000, r24h: -3, r60d: null, trend: { label: 'uptrend' }, vsBtc: null, worthNoting: 'crowded', relSpark: [0, 7], detail: { annualFunding: 40 } },
    { symbol: 'CUSDT', base: 'SOL', sizeRank: 3, price: 150, r24h: 9, r60d: -2, trend: { label: 'downtrend' }, vsBtc: 'ahead of BTC', worthNoting: 'big move', relSpark: [0, 3], detail: { annualFunding: null } },
  ];
  const vars = buildOrderVars(rows);

  test('every column emits both directions for every row', () => {
    for (const col of SORT_COLS) {
      for (const v of vars) {
        assert.equal(typeof v[`--d-${col.id}`], 'string', `--d-${col.id}`);
        assert.equal(typeof v[`--a-${col.id}`], 'string', `--a-${col.id}`);
      }
    }
  });

  test('numeric columns sort high-to-low descending and reverse ascending', () => {
    assert.deepEqual(orderOf(vars, '--d-r24h'), [2, 0, 1]);
    assert.deepEqual(orderOf(vars, '--a-r24h'), [1, 0, 2]);
    assert.deepEqual(orderOf(vars, '--d-price'), [1, 0, 2]);
    assert.deepEqual(orderOf(vars, '--a-price'), [2, 0, 1]);
  });

  test('the coin column sorts alphabetically', () => {
    assert.deepEqual(orderOf(vars, '--a-coin'), [1, 0, 2]); // BTC, ETH, SOL
    assert.deepEqual(orderOf(vars, '--d-coin'), [2, 0, 1]);
  });

  test('categorical columns sort by their rank, best first descending', () => {
    assert.deepEqual(orderOf(vars, '--d-trend'), [1, 0, 2]); // uptrend, cooling, downtrend
    assert.deepEqual(orderOf(vars, '--d-note'), [2, 1, 0]); // big move, crowded, none
  });

  test('missing values sort LAST in BOTH directions', () => {
    // r60d: ETH 5, SOL -2, BTC null
    assert.deepEqual(orderOf(vars, '--d-r60d'), [0, 2, 1]);
    assert.deepEqual(orderOf(vars, '--a-r60d'), [2, 0, 1]);
    // vsBtc is null for BTC itself; funding is null for SOL
    assert.equal(vars[1]['--d-vsbtc'], vars[1]['--a-vsbtc']);
    assert.equal(Number(vars[1]['--a-vsbtc']), 2);
    assert.equal(Number(vars[2]['--a-cost']), 2);
  });

  test('every row gets a distinct slot, so no two rows collide', () => {
    for (const col of SORT_COLS) {
      for (const d of ['d', 'a']) {
        const slots = vars.map((v) => v[`--${d}-${col.id}`]);
        assert.equal(new Set(slots).size, rows.length, `--${d}-${col.id}`);
      }
    }
  });

  test('the stylesheet wires both directions of every column', () => {
    const css = buildSortCss();
    for (const col of SORT_COLS) {
      assert.match(css, new RegExp(`#sk-${col.id}-d:checked~\\.stbl>\\.srow\\{order:var\\(--d-${col.id}\\)\\}`));
      assert.match(css, new RegExp(`#sk-${col.id}-a:checked~\\.stbl>\\.srow\\{order:var\\(--a-${col.id}\\)\\}`));
    }
  });

  test('the grid track has one column per sort key', () => {
    assert.equal(GRID.split(' ').length, SORT_COLS.length);
  });
});
