// Offline tests for the failure paths that matter, with global.fetch
// mocked — no network, no Firestore, no secrets needed.
// Run with: npm test
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchDerivatives, fetchAllDerivatives, SOURCES } from '../lib/derivatives.js';
import { fetchAllFeeds, urlHash, canonicalUrl } from '../lib/rss.js';
import { interpretFunding, interpretOiPrice } from '../lib/interpret.js';
import { isAuthorized } from '../lib/auth.js';
import { buildRawFallbackMessage, formatDigestMessage } from '../lib/digest.js';

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

describe('derivatives adapter', () => {
  test('falls back to OKX when Binance returns 451 (geo-block)', async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('binance.com')) return new Response('blocked', { status: 451 });
      if (u.includes('funding-rate')) {
        return jsonResponse({ code: '0', data: [{ fundingRate: '0.0001' }] });
      }
      if (u.includes('open-interest')) {
        return jsonResponse({ code: '0', data: [{ oi: '1000000', oiCcy: '85000' }] });
      }
      throw new Error(`unexpected url ${u}`);
    };
    const result = await fetchDerivatives(BTC, SOURCES);
    assert.equal(result.source, 'okx');
    assert.equal(result.fundingRate, 0.0001);
    assert.equal(result.openInterest, 85000);
  });

  test('uses Binance when available and records the source', async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('premiumIndex')) {
        return jsonResponse({ lastFundingRate: '0.00025', markPrice: '95000.1' });
      }
      if (u.includes('openInterest')) {
        return jsonResponse({ openInterest: '81234.5' });
      }
      throw new Error(`unexpected url ${u}`);
    };
    const result = await fetchDerivatives(BTC, SOURCES);
    assert.equal(result.source, 'binance');
    assert.equal(result.fundingRate, 0.00025);
  });

  test('one asset failing does not sink the others', async () => {
    const ETH = { ...BTC, symbol: 'ETH', binance: 'ETHUSDT', okx: 'ETH-USDT-SWAP' };
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('ETH')) return new Response('down', { status: 500 });
      if (u.includes('premiumIndex')) return jsonResponse({ lastFundingRate: '0.0001', markPrice: '1' });
      if (u.includes('openInterest')) return jsonResponse({ openInterest: '1' });
      return new Response('down', { status: 500 });
    };
    const { data, errors } = await fetchAllDerivatives([BTC, ETH], SOURCES);
    assert.ok(data.BTC);
    assert.equal(data.ETH, null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].asset, 'ETH');
  });
});

describe('rss ingestion', () => {
  const FEED_XML = (title) => `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>${title}</title>
      <item><title>Story A</title><link>https://example.com/a?utm_source=rss</link>
        <pubDate>Wed, 01 Jul 2026 10:00:00 GMT</pubDate></item>
      <item><title>Story B</title><link>https://example.com/b</link>
        <pubDate>Wed, 01 Jul 2026 11:00:00 GMT</pubDate></item>
    </channel></rss>`;

  test('a dead feed is skipped, the rest still ingest', async () => {
    const feeds = [
      { name: 'Good Feed', url: 'https://good.example/rss' },
      { name: 'Dead Feed', url: 'https://dead.example/rss' },
    ];
    global.fetch = async (url) => {
      if (String(url).includes('dead.example')) return new Response('gone', { status: 404 });
      return new Response(FEED_XML('Good'), { status: 200 });
    };
    const { items, errors } = await fetchAllFeeds(feeds);
    assert.equal(items.length, 2);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].feed, 'Dead Feed');
  });

  test('duplicate stories across feeds dedupe by canonical URL hash', async () => {
    const feeds = [
      { name: 'Feed 1', url: 'https://one.example/rss' },
      { name: 'Feed 2', url: 'https://two.example/rss' },
    ];
    global.fetch = async () => new Response(FEED_XML('X'), { status: 200 });
    const { items } = await fetchAllFeeds(feeds);
    // Same two stories from both feeds -> only two unique items.
    assert.equal(items.length, 2);
  });

  test('tracking params do not change the URL hash', () => {
    assert.equal(
      urlHash('https://example.com/story?utm_source=rss&utm_medium=feed'),
      urlHash('https://example.com/story'),
    );
    assert.equal(canonicalUrl('https://Example.com/story/'), 'https://example.com/story');
  });
});

describe('interpretation layer (PRD §5 table)', () => {
  test('funding rate labels match the thresholds', () => {
    assert.equal(interpretFunding(0.0006).label, 'Overheated longs'); // > +0.05%
    assert.equal(interpretFunding(0.0002).label, 'Mildly bullish'); // +0.01..0.05%
    assert.equal(interpretFunding(0).label, 'Neutral');
    assert.equal(interpretFunding(-0.0002).label, 'Mildly bearish');
    assert.equal(interpretFunding(-0.0006).label, 'Overheated shorts'); // < -0.05%
  });

  test('OI + price combos', () => {
    assert.match(interpretOiPrice(3, 5), /trend confirmation/);
    assert.match(interpretOiPrice(3, -5), /Shorts closing/);
    assert.match(interpretOiPrice(-3, 5), /New shorts/);
    assert.match(interpretOiPrice(-3, -5), /Longs closing/);
    assert.equal(interpretOiPrice(null, 5), null);
  });
});

describe('cron auth', () => {
  const makeRequest = (auth) =>
    new Request('https://x.example/api/ingest', {
      headers: auth ? { authorization: auth } : {},
    });

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
  });

  test('rejects missing or wrong secret', () => {
    assert.equal(isAuthorized(makeRequest(null)), false);
    assert.equal(isAuthorized(makeRequest('Bearer wrong')), false);
  });

  test('accepts the correct bearer token', () => {
    assert.equal(isAuthorized(makeRequest('Bearer test-secret')), true);
  });

  test('rejects everything when no secret is configured', () => {
    delete process.env.CRON_SECRET;
    assert.equal(isAuthorized(makeRequest('Bearer anything')), false);
  });
});

describe('digest degradation (AI as optional layer)', () => {
  const inputs = {
    generatedAt: new Date().toISOString(),
    headlines: [
      { title: 'BTC ETF sees record inflows', source: 'CoinDesk', publishedAt: null },
      { title: 'SOL upgrade ships', source: 'The Block', publishedAt: null },
    ],
    derivatives: {
      BTC: { fundingRate: 0.0007, fundingRatePct: '0.0700%', fundingLabel: 'Overheated longs', openInterest: 85000, oiChange24hPct: 4.2, source: 'okx' },
      ETH: null,
    },
    fearGreed: { value: 12, classification: 'Extreme Fear', last7Days: [12, 15, 18, 20, 22, 25, 30] },
    prices: { BTC: { usd: 95000, change24hPct: 2.4 } },
  };

  test('raw fallback message renders from stored data alone', () => {
    const msg = buildRawFallbackMessage(inputs, new Date('2026-07-02T02:00:00Z'));
    assert.match(msg, /AI summary unavailable/);
    assert.match(msg, /Overheated longs/);
    assert.match(msg, /Fear &amp; Greed: 12/);
    assert.match(msg, /historically better buying zones/);
    assert.match(msg, /BTC ETF sees record inflows/);
    // OI+price combo: price up + OI up
    assert.match(msg, /trend confirmation/);
  });

  test('structured digest renders to a Telegram HTML message', () => {
    const digest = {
      market_pulse: 'Choppy day, low conviction. <test>',
      top_stories: [{ summary: 'ETF inflows', why_it_matters: 'Spot demand', source: 'CoinDesk' }],
      positioning: [{ asset: 'BTC', read: 'Funding overheated, squeeze risk.' }],
      sentiment_note: 'Extreme Fear at 12.',
      learn_today: 'Funding flipping negative while price holds often precedes squeezes.',
    };
    const msg = formatDigestMessage(digest, new Date('2026-07-02T02:00:00Z'));
    assert.match(msg, /Market pulse/);
    assert.match(msg, /&lt;test&gt;/); // HTML is escaped
    assert.match(msg, /One thing to learn today/);
    assert.ok(msg.length < 4096, 'must fit a single Telegram message');
  });
});
