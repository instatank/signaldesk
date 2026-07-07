// Offline tests for the advanced (free-tier) data layer: pure math,
// shaping, macro calendar, and the Binance→OKX failover paths — fetch
// mocked, no network.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  depthImbalance,
  aggregateOptionOi,
  logReturns,
  pearson,
  realizedVolPct,
  totalMcapChangePct,
  compactUsd,
  longShortBand,
  depthBand,
  fetchAllLongShort,
  fetchAllFundingHistory,
  fetchAllDepth,
  shapeLongShort,
  shapeDepth,
  shapeStables,
  shapeOptions,
  shapeRollup,
} from '../lib/advanced.js';
import {
  interpretLongShort,
  interpretDepth,
  interpretStablecoins,
  interpretPutCall,
  interpretVolGap,
  interpretCorrelation,
} from '../lib/interpret.js';
import { upcomingMacroEvents, formatEventDates } from '../lib/macro.js';
import { buildAssetRows } from '../lib/dashboard.js';

const CFG = {
  binanceLongShortUrl: 'https://fapi.binance.example/longshort',
  okxLongShortUrl: 'https://okx.example/rubik',
  binanceFundingHistoryUrl: 'https://fapi.binance.example/fundingRate',
  okxFundingHistoryUrl: 'https://okx.example/funding-rate-history',
  binanceDepthUrl: 'https://api.binance.example/depth',
  okxBooksUrl: 'https://okx.example/books',
};
const BTC = { symbol: 'BTC', binance: 'BTCUSDT', okx: 'BTC-USDT-SWAP', coingecko: 'bitcoin' };

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('depth imbalance math', () => {
  test('sums USD notional within ±2% of mid and splits bid share', () => {
    // mid = 100; window [98, 102]
    const bids = [['99', '10'], ['98', '10'], ['90', '100']]; // 990 + 980 in range
    const asks = [['101', '10'], ['102', '10'], ['110', '100']]; // 1010 + 1020 in range
    const r = depthImbalance(bids, asks);
    assert.equal(r.mid, 100);
    assert.equal(r.bidUsd, 990 + 980);
    assert.equal(r.askUsd, 1010 + 1020);
    assert.ok(Math.abs(r.bidSharePct - (1970 / 4000) * 100) < 1e-9);
  });

  test('tolerates OKX-style 4-column rows and rejects empty books', () => {
    const r = depthImbalance([['99', '1', '0', '1']], [['101', '1', '0', '1']]);
    assert.ok(r.bidSharePct > 0);
    assert.equal(depthImbalance([], [['101', '1']]), null);
  });
});

describe('options aggregation', () => {
  test('splits open interest by -C/-P suffix', () => {
    const r = aggregateOptionOi([
      { instrument_name: 'BTC-25SEP26-100000-C', open_interest: 30 },
      { instrument_name: 'BTC-25SEP26-100000-P', open_interest: 15 },
      { instrument_name: 'BTC-25SEP26-90000-C', open_interest: 10 },
      { instrument_name: 'BTC-PERPETUAL', open_interest: 999 }, // ignored
    ]);
    assert.equal(r.callOi, 40);
    assert.equal(r.putOi, 15);
    assert.ok(Math.abs(r.putCallRatio - 0.375) < 1e-9);
    assert.equal(aggregateOptionOi([]), null);
  });
});

describe('correlation & volatility math', () => {
  test('logReturns drops non-positive prices', () => {
    assert.equal(logReturns([100, 110, 121]).length, 2);
    assert.equal(logReturns([100, 0, 121]).length, 0);
  });

  test('pearson is 1 for identical series, -1 for inverted, null when short', () => {
    const a = Array.from({ length: 30 }, (_, i) => Math.sin(i) + i * 0.01);
    assert.ok(Math.abs(pearson(a, a) - 1) < 1e-9);
    assert.ok(Math.abs(pearson(a, a.map((x) => -x)) + 1) < 1e-9);
    assert.equal(pearson([1, 2], [1, 2]), null); // < 10 points
  });

  test('realizedVolPct annualizes daily stdev', () => {
    // Alternating ±1% daily log returns → stdev ≈ 0.01, vol ≈ 19.1%
    const returns = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.01 : -0.01));
    const vol = realizedVolPct(returns);
    assert.ok(vol > 18 && vol < 20.5, `got ${vol}`);
    assert.equal(realizedVolPct([0.01]), null);
  });
});

describe('stablecoin math', () => {
  test('totalMcapChangePct weights by market cap', () => {
    // 100B at +1% and 100B at -1% → net ~0
    const flat = totalMcapChangePct([
      { marketCap: 100e9, mcapChange24hPct: 1 },
      { marketCap: 100e9, mcapChange24hPct: -1 },
    ]);
    assert.ok(Math.abs(flat) < 0.01);
    // One coin dominating drags the total toward its change
    const skewed = totalMcapChangePct([
      { marketCap: 190e9, mcapChange24hPct: 2 },
      { marketCap: 10e9, mcapChange24hPct: -2 },
    ]);
    assert.ok(skewed > 1.5);
    assert.equal(totalMcapChangePct([]), null);
  });

  test('compactUsd scales through M/B/T', () => {
    assert.equal(compactUsd(1.23e12), '$1.23T');
    assert.equal(compactUsd(4.56e9), '$4.6B');
    assert.equal(compactUsd(7.89e6), '$7.9M');
    assert.equal(compactUsd(NaN), null);
  });
});

describe('advanced interpretation bands', () => {
  test('long/short thresholds', () => {
    assert.equal(interpretLongShort(3.5).label, 'Heavily long-skewed');
    assert.equal(interpretLongShort(2).label, 'Long-leaning');
    assert.equal(interpretLongShort(1).label, 'Balanced');
    assert.equal(interpretLongShort(0.5).label, 'Short-skewed');
    assert.equal(interpretLongShort(null), null);
    assert.equal(longShortBand(3.5), 'red');
    assert.equal(longShortBand(0.5), 'green');
  });

  test('depth, stablecoin, put/call, vol-gap, correlation reads', () => {
    assert.match(interpretDepth(65), /Bids thicker/);
    assert.match(interpretDepth(35), /Asks thicker/);
    assert.match(interpretDepth(50), /balanced/);
    assert.equal(depthBand(65), 'green');
    assert.match(interpretStablecoins(0.5), /dry powder/);
    assert.match(interpretStablecoins(-0.5), /leaving/);
    assert.match(interpretPutCall(0.3), /Call-heavy/);
    assert.match(interpretPutCall(1.5), /downside protection/);
    assert.match(interpretVolGap(70, 40), /expects a catalyst/);
    assert.match(interpretVolGap(30, 45), /complacency/);
    assert.match(interpretCorrelation(0.9), /lockstep/);
    assert.match(interpretCorrelation(0.1), /own story/);
  });
});

describe('advanced fetchers fail over Binance → OKX', () => {
  test('long/short falls back to OKX and normalizes newest-first data', async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('binance')) return new Response('blocked', { status: 451 });
      if (u.includes('rubik')) {
        return jsonResponse({
          code: '0',
          data: [
            ['2000', '2.0'], // newest first, as OKX returns it
            ['1000', '1.5'],
          ],
        });
      }
      throw new Error(`unexpected url ${u}`);
    };
    const { data, errors } = await fetchAllLongShort(CFG, [BTC]);
    assert.equal(errors.length, 0);
    assert.equal(data.BTC.source, 'okx');
    assert.equal(data.BTC.ratio, 2.0); // latest after re-sort
    assert.deepEqual(data.BTC.history.map((h) => h.ratio), [1.5, 2.0]); // oldest → newest
  });

  test('funding history uses Binance when available, ascending', async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('binance')) {
        return jsonResponse([
          { fundingTime: 1000, fundingRate: '0.0001' },
          { fundingTime: 2000, fundingRate: '0.0002' },
        ]);
      }
      throw new Error(`unexpected url ${u}`);
    };
    const { data } = await fetchAllFundingHistory(CFG, [BTC]);
    assert.equal(data.BTC.source, 'binance');
    assert.deepEqual(data.BTC.history.map((h) => h.rate), [0.0001, 0.0002]);
  });

  test('depth failure on both sources nulls that asset without sinking others', async () => {
    const ETH = { ...BTC, symbol: 'ETH', binance: 'ETHUSDT', okx: 'ETH-USDT-SWAP' };
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('ETH')) return new Response('down', { status: 500 });
      if (u.includes('binance')) {
        return jsonResponse({ bids: [['99', '1']], asks: [['101', '1']] });
      }
      return new Response('down', { status: 500 });
    };
    const { data, errors } = await fetchAllDepth(CFG, [BTC, ETH]);
    assert.ok(data.BTC.bidSharePct > 0);
    assert.equal(data.BTC.source, 'binance');
    assert.equal(data.ETH, null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].asset, 'ETH');
  });
});

describe('advance-page shaping', () => {
  const ASSETS = [BTC, { symbol: 'ETH' }, { symbol: 'HYPE' }];

  test('shapeLongShort finds the log-symmetric most extreme coin', () => {
    const section = {
      data: {
        BTC: { ratio: 1.8, longPct: 64, history: [{ ratio: 1.7 }, { ratio: 1.8 }], source: 'binance' },
        ETH: { ratio: 0.4, longPct: 28, history: [], source: 'okx' }, // |log 0.4| > |log 1.8|
        HYPE: null,
      },
    };
    const s = shapeLongShort(section, ASSETS);
    assert.equal(s.total, 2);
    assert.equal(s.leaningLong, 1);
    assert.equal(s.mostExtreme.symbol, 'ETH');
    assert.equal(s.rows[0].band, 'amber');
    assert.equal(shapeLongShort(null, ASSETS), null);
  });

  test('shapeDepth picks the most lopsided book', () => {
    const section = {
      data: {
        BTC: { bidSharePct: 52, bidUsd: 5.2e6, askUsd: 4.8e6, source: 'binance' },
        ETH: { bidSharePct: 30, bidUsd: 3e6, askUsd: 7e6, source: 'okx' },
      },
    };
    const s = shapeDepth(section, ASSETS);
    assert.equal(s.mostImbalanced.symbol, 'ETH');
    assert.equal(s.mostImbalanced.band, 'red');
    assert.match(s.mostImbalanced.read, /Asks thicker/);
  });

  test('shapeStables and shapeOptions surface reads; missing sections stay null', () => {
    const flows = shapeStables({
      stablecoins: {
        coins: [{ symbol: 'USDT', marketCap: 150e9, mcapChange24hPct: 0.3 }],
        totalMcap: 150e9,
        totalChange24hPct: 0.3,
      },
      global: { totalMcapUsd: 3.2e12, btcDominancePct: 55.1, mcapChange24hPct: 1.2 },
    });
    assert.match(flows.read, /dry powder/);
    assert.equal(shapeStables(null), null);

    const options = shapeOptions(
      { data: { BTC: { dvol: 60, dvolChange24h: 2, putCallRatio: 0.9, callOi: 100, putOi: 90 } } },
      { data: { BTC: { realizedVolPct: 40 } } }
    );
    assert.equal(options.rows[0].realizedVolPct, 40);
    assert.match(options.rows[0].volGapRead, /catalyst/);
    assert.match(options.rows[0].pcRead, /hedging/);
  });

  test('shapeRollup finds the wildest coin and skips BTC self-correlation', () => {
    const s = shapeRollup(
      {
        data: {
          BTC: { realizedVolPct: 40, correlationToBtc: null },
          ETH: { realizedVolPct: 65, correlationToBtc: 0.85 },
          HYPE: null,
        },
      },
      ASSETS
    );
    assert.equal(s.wildest.symbol, 'ETH');
    assert.equal(s.rows.length, 2);
    assert.match(s.rows[1].corrRead, /lockstep/);
  });
});

describe('macro calendar', () => {
  const EVENTS = [
    { date: '2026-07-14', name: 'US CPI (June data)', kind: 'cpi' },
    { date: '2026-07-28', endDate: '2026-07-29', name: 'FOMC meeting', kind: 'fomc' },
  ];

  test('window includes events within 7 days, sorted, with daysAway', () => {
    const now = new Date('2026-07-10T05:00:00Z');
    const upcoming = upcomingMacroEvents(EVENTS, now);
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0].kind, 'cpi');
    assert.equal(upcoming[0].daysAway, 4);
  });

  test('a running multi-day event still shows; long-past events do not', () => {
    const during = upcomingMacroEvents(EVENTS, new Date('2026-07-29T05:00:00Z'));
    assert.equal(during.length, 1);
    assert.equal(during[0].kind, 'fomc');
    assert.equal(during[0].daysAway, 0);
    assert.equal(upcomingMacroEvents(EVENTS, new Date('2026-08-15T00:00:00Z')).length, 0);
  });

  test('formatEventDates renders single days and same-month ranges', () => {
    assert.equal(formatEventDates(EVENTS[0]), 'Jul 14');
    assert.equal(formatEventDates(EVENTS[1]), 'Jul 28–29');
  });
});

test('buildAssetRows attaches funding sparkline values as percents', () => {
  const fundingHistory = {
    BTC: { history: [{ ts: 1, rate: 0.0001 }, { ts: 2, rate: -0.0002 }], source: 'binance' },
  };
  const [btc, eth] = buildAssetRows(null, null, [{ symbol: 'BTC' }, { symbol: 'ETH' }], fundingHistory);
  assert.deepEqual(btc.fundingSpark, [0.01, -0.02]);
  assert.deepEqual(eth.fundingSpark, []);
});
