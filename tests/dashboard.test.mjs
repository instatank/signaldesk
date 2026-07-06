// Offline tests for the dashboard's pure data-shaping helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeTime,
  isStale,
  fundingBand,
  fundingBarPct,
  fngTone,
  sparklinePoints,
  buildAssetRows,
  shapeHeadlines,
  shapeFearGreed,
} from '../lib/dashboard.js';

const NOW = new Date('2026-07-06T10:00:00Z');

test('relativeTime buckets minutes, hours, days', () => {
  assert.equal(relativeTime(new Date(NOW - 5 * 60000), NOW), '5m ago');
  assert.equal(relativeTime(new Date(NOW - 3 * 3600000), NOW), '3h ago');
  assert.equal(relativeTime(new Date(NOW - 49 * 3600000), NOW), '2d ago');
  assert.equal(relativeTime(null, NOW), '');
});

test('isStale flags snapshots older than 45 minutes (and missing ones)', () => {
  assert.equal(isStale(new Date(NOW - 10 * 60000), NOW), false);
  assert.equal(isStale(new Date(NOW - 50 * 60000), NOW), true);
  assert.equal(isStale(null, NOW), true);
});

test('fundingBand matches the PRD §5 thresholds', () => {
  assert.equal(fundingBand(0.0006), 'red'); // 0.06% overheated longs
  assert.equal(fundingBand(0.0003), 'amber'); // mildly bullish
  assert.equal(fundingBand(0), 'gray'); // neutral
  assert.equal(fundingBand(-0.0003), 'amber'); // mildly bearish
  assert.equal(fundingBand(-0.0006), 'green'); // overheated shorts
});

test('fundingBarPct clamps at ±0.1% and scales linearly', () => {
  assert.equal(fundingBarPct(0.001), 100); // 0.1% → full bar
  assert.equal(fundingBarPct(0.005), 100); // beyond clamp stays full
  assert.equal(fundingBarPct(0.0005), 50); // 0.05% → half bar
  assert.equal(fundingBarPct(0), 0);
});

test('fngTone spans red to green', () => {
  assert.equal(fngTone(10), 'red');
  assert.equal(fngTone(35), 'amber');
  assert.equal(fngTone(50), 'gray');
  assert.equal(fngTone(70), 'lime');
  assert.equal(fngTone(90), 'green');
});

test('sparklinePoints needs 2+ finite values and spans the width', () => {
  assert.equal(sparklinePoints([50]), '');
  assert.equal(sparklinePoints([]), '');
  const pts = sparklinePoints([10, 20, 30], 240, 48).split(' ');
  assert.equal(pts.length, 3);
  assert.ok(pts[0].startsWith('3.0,')); // left pad
  assert.ok(pts[2].startsWith('237.0,')); // width - pad
});

test('buildAssetRows computes same-source OI delta and funding read', () => {
  const assets = [{ symbol: 'BTC' }, { symbol: 'ETH' }];
  const latest = {
    derivatives: {
      BTC: { fundingRate: 0.0006, openInterest: 110, source: 'binance' },
      ETH: { fundingRate: 0.0001, openInterest: 100, source: 'okx' },
    },
    prices: { BTC: { usd: 100000, change24hPct: 2.5 }, ETH: { usd: 4000, change24hPct: -1.2 } },
  };
  const dayAgo = {
    derivatives: {
      BTC: { fundingRate: 0.0004, openInterest: 100, source: 'binance' },
      ETH: { fundingRate: 0.0001, openInterest: 90, source: 'binance' }, // source flipped
    },
  };
  const [btc, eth] = buildAssetRows(latest, dayAgo, assets);
  assert.equal(btc.band, 'red');
  assert.equal(btc.fundingLabel, 'Overheated longs');
  assert.ok(Math.abs(btc.oiChangePct - 10) < 1e-9);
  assert.equal(btc.oiCombo, 'New money entering longs — trend confirmation');
  assert.equal(eth.oiChangePct, null); // cross-source delta suppressed
});

test('buildAssetRows degrades per-asset when data is missing', () => {
  const rows = buildAssetRows(null, null, [{ symbol: 'SOL' }]);
  assert.equal(rows[0].fundingRate, null);
  assert.equal(rows[0].price, null);
  assert.equal(rows[0].barPct, 0);
});

test('shapeHeadlines dedupes by normalized title and caps', () => {
  const input = [
    { title: 'Bitcoin ETF sees record inflow', url: 'a' },
    { title: '  bitcoin  etf sees record inflow ', url: 'b' }, // dupe
    { title: 'ETH staking update', url: 'c' },
    { title: '', url: 'd' }, // dropped
  ];
  const out = shapeHeadlines(input, 10);
  assert.deepEqual(out.map((h) => h.url), ['a', 'c']);
  assert.equal(shapeHeadlines(input, 1).length, 1);
});

test('shapeFearGreed reverses history to oldest-first and attaches guidance', () => {
  const shaped = shapeFearGreed({
    value: 15,
    classification: 'Extreme Fear',
    history: [{ value: 15 }, { value: 25 }, { value: 40 }], // newest first
  });
  assert.deepEqual(shaped.history, [40, 25, 15]);
  assert.equal(shaped.tone, 'red');
  assert.match(shaped.guidance, /Extreme Fear/);
  assert.equal(shapeFearGreed(null), null);
  assert.equal(shapeFearGreed({ value: 'n/a' }), null);
});
