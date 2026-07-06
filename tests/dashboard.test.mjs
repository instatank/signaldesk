// Offline tests for the dashboard's pure data-shaping helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHeadline,
  topicBreakdown,
  hourlyNewsVolume,
  relativeTime,
  isStale,
  fundingBand,
  fundingBarPct,
  fngTone,
  sparklinePoints,
  buildAssetRows,
  positioningSummary,
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

test('positioningSummary counts payers and picks the most crowded coin', () => {
  const rows = [
    { symbol: 'BTC', fundingRate: 0.0006, band: 'red' },
    { symbol: 'ETH', fundingRate: 0.0002, band: 'amber' },
    { symbol: 'SOL', fundingRate: 0.00005, band: 'gray' },
    { symbol: 'ZEC', fundingRate: -0.0008, band: 'green' },
    { symbol: 'HYPE', fundingRate: null, band: null }, // no data → excluded
  ];
  const s = positioningSummary(rows);
  assert.equal(s.total, 4);
  assert.equal(s.longsPaying, 3);
  assert.equal(s.shortsPaying, 1);
  assert.equal(s.mostCrowded.symbol, 'ZEC'); // |−0.08%| beats |+0.06%|
});

test('positioningSummary has no most-crowded coin when everything is gray', () => {
  const rows = [
    { symbol: 'BTC', fundingRate: 0.00005, band: 'gray' },
    { symbol: 'ETH', fundingRate: -0.00002, band: 'gray' },
  ];
  const s = positioningSummary(rows);
  assert.equal(s.total, 2);
  assert.equal(s.mostCrowded, null);
  assert.deepEqual(positioningSummary([]), {
    total: 0,
    longsPaying: 0,
    shortsPaying: 0,
    mostCrowded: null,
  });
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

const ASSETS = [{ symbol: 'BTC' }, { symbol: 'ETH' }, { symbol: 'HYPE' }];

test('classifyHeadline tags coins and themes by word boundary', () => {
  const c = classifyHeadline('Bitcoin ETF sees record inflow as SEC delays ruling', ASSETS);
  assert.deepEqual(c.coins, ['BTC']);
  assert.deepEqual(c.topics, ['regulation', 'etf']);
  // 'hyped' must not match HYPE; 'Tether' must match stablecoins
  const d = classifyHeadline('Traders hyped about Tether expansion', ASSETS);
  assert.deepEqual(d.coins, []);
  assert.deepEqual(d.topics, ['stablecoins']);
});

test('topicBreakdown counts, sorts, and flags rising narratives', () => {
  const mk = (title, hoursAgo) => ({
    ...classifyHeadline(title, ASSETS),
    publishedAt: new Date(NOW - hoursAgo * 3600000),
  });
  const headlines = [
    mk('Bitcoin rallies', 1),
    mk('Bitcoin ETF inflow', 2),
    mk('Bitcoin miners', 3),
    mk('Ethereum upgrade', 20),
  ];
  const { entries, maxCount } = topicBreakdown(headlines, ASSETS, NOW);
  assert.equal(entries[0].key, 'BTC');
  assert.equal(entries[0].count, 3);
  assert.equal(entries[0].rising, true); // all 3 within last 6h
  assert.equal(maxCount, 3);
  const eth = entries.find((e) => e.key === 'ETH');
  assert.equal(eth.rising, false); // count below the rising threshold
});

test('hourlyNewsVolume buckets 24h oldest-first', () => {
  const headlines = [
    { publishedAt: new Date(NOW - 30 * 60000) }, // last hour → bucket 23
    { publishedAt: new Date(NOW - 23.5 * 3600000) }, // → bucket 0
    { publishedAt: new Date(NOW - 30 * 3600000) }, // out of window → dropped
    { publishedAt: null },
  ];
  const buckets = hourlyNewsVolume(headlines, NOW);
  assert.equal(buckets.length, 24);
  assert.equal(buckets[23], 1);
  assert.equal(buckets[0], 1);
  assert.equal(buckets.reduce((a, b) => a + b, 0), 2);
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
