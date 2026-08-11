// Live check of every external data source. Run from a machine with
// normal internet access (your laptop, or `vercel dev`):
//
//   npm run verify:sources
//
// Exits non-zero if any source fails, so you can also wire it into CI.
// Note: Binance failing with 451/403 from a US IP is EXPECTED and fine —
// production runs from Singapore (sin1) and falls over to OKX anyway.
import { readFileSync } from 'node:fs';
import Parser from 'rss-parser';
import { fetchTreeNews } from '../lib/tree-news.js';

const sources = JSON.parse(readFileSync(new URL('../config/sources.json', import.meta.url)));
const follows = JSON.parse(readFileSync(new URL('../config/follows.json', import.meta.url)));
const parser = new Parser();

let failures = 0;
const ok = (name, detail) => console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
const bad = (name, err, fatal = true) => {
  console.log(`  ${fatal ? '❌' : '⚠️ '} ${name} — ${err}`);
  if (fatal) failures += 1;
};

async function get(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'SignalDesk/1.0 (source verification)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

console.log('\nRSS feeds:');
for (const feed of sources.feeds) {
  try {
    const xml = await (await get(feed.url)).text();
    const parsed = await parser.parseString(xml);
    const count = parsed.items?.length || 0;
    if (count === 0) throw new Error('parsed but zero items');
    ok(feed.name, `${count} items`);
  } catch (err) {
    bad(feed.name, err.message);
  }
}

console.log('\nTree News (JSON, not RSS):');
if (!sources.treeNews?.url) {
  console.log('  – not configured');
} else {
  try {
    // Run the real fetcher, not just a status check: what matters is how many
    // items survive parsing AND the follow-list filter, since that is what
    // actually reaches the briefing.
    const { items, errors } = await fetchTreeNews(sources.treeNews, follows, sources.feeds);
    for (const e of errors) bad(sources.treeNews.name, e.error);
    if (!errors.length) {
      if (items.length === 0) throw new Error('fetched but nothing survived parsing/filtering');
      const bySource = items.reduce((acc, i) => ({ ...acc, [i.source]: (acc[i.source] || 0) + 1 }), {});
      const newest = items.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
      const ageMin = Math.round((Date.now() - newest.publishedAt) / 60000);
      ok(sources.treeNews.name, `${items.length} items kept, newest ${ageMin}m old`);
      console.log(`     by source: ${Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
      console.log(`     newest: ${newest.title.slice(0, 90)}`);
    }
  } catch (err) {
    bad(sources.treeNews.name, err.message);
  }
}

console.log('\nFear & Greed:');
try {
  const json = await (await get(sources.fearGreedUrl)).json();
  const v = json.data?.[0]?.value;
  if (v == null) throw new Error('no data[0].value in response');
  ok('alternative.me', `current value ${v}`);
} catch (err) {
  bad('alternative.me', err.message);
}

console.log('\nDerivatives (per asset):');
for (const asset of sources.assets) {
  try {
    const json = await (
      await get(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${asset.binance}`)
    ).json();
    ok(`Binance ${asset.symbol}`, `funding ${json.lastFundingRate}`);
  } catch (err) {
    // Binance geo-blocks US IPs; OKX below is the fallback that matters.
    bad(`Binance ${asset.symbol}`, `${err.message} (expected from US IPs — OKX covers this)`, false);
  }
  try {
    const json = await (
      await get(`https://www.okx.com/api/v5/public/funding-rate?instId=${asset.okx}`)
    ).json();
    if (json.code !== '0') throw new Error(`code ${json.code}: ${json.msg}`);
    ok(`OKX ${asset.symbol}`, `funding ${json.data[0].fundingRate}`);
  } catch (err) {
    bad(`OKX ${asset.symbol}`, err.message);
  }
}

console.log('\nPrices:');
try {
  const ids = sources.assets.map((a) => a.coingecko).join(',');
  const json = await (
    await get(`${sources.coingeckoPriceUrl}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`)
  ).json();
  const btc = json.bitcoin?.usd;
  if (btc == null) throw new Error('no bitcoin.usd in response');
  ok('CoinGecko', `BTC $${btc}`);
} catch (err) {
  bad('CoinGecko', err.message);
}

const adv = sources.advanced;
if (adv) {
  console.log('\nAdvanced — long/short & depth (BTC as canary):');
  const btc = sources.assets.find((a) => a.symbol === 'BTC');
  try {
    const json = await (
      await get(`${adv.binanceLongShortUrl}?symbol=${btc.binance}&period=1h&limit=1`)
    ).json();
    ok('Binance long/short', `ratio ${json[0]?.longShortRatio}`);
  } catch (err) {
    bad('Binance long/short', `${err.message} (expected from US IPs — OKX covers this)`, false);
  }
  try {
    const json = await (
      await get(`${adv.okxLongShortUrl}?ccy=BTC&period=1H`)
    ).json();
    if (json.code !== '0') throw new Error(`code ${json.code}: ${json.msg}`);
    ok('OKX long/short', `ratio ${json.data?.[0]?.[1]}`);
  } catch (err) {
    bad('OKX long/short', err.message);
  }
  try {
    const json = await (await get(`${adv.okxBooksUrl}?instId=BTC-USDT&sz=5`)).json();
    if (json.code !== '0') throw new Error(`code ${json.code}: ${json.msg}`);
    ok('OKX spot book', `best bid ${json.data?.[0]?.bids?.[0]?.[0]}`);
  } catch (err) {
    bad('OKX spot book', err.message);
  }

  console.log('\nAdvanced — Deribit options:');
  try {
    const json = await (
      await get(`${adv.deribitBaseUrl}/public/get_volatility_index_data?currency=BTC&start_timestamp=${Date.now() - 7200000}&end_timestamp=${Date.now()}&resolution=3600`)
    ).json();
    const candles = json.result?.data;
    if (!candles?.length) throw new Error('no DVOL candles');
    ok('Deribit DVOL', `BTC ${candles[candles.length - 1][4]}`);
  } catch (err) {
    bad('Deribit DVOL', err.message);
  }

  console.log('\nAdvanced — CoinGecko flows & history:');
  try {
    const ids = adv.stablecoins.map((s) => s.coingecko).join(',');
    const json = await (await get(`${adv.coingeckoMarketsUrl}?vs_currency=usd&ids=${ids}`)).json();
    if (!Array.isArray(json) || !json.length) throw new Error('no markets rows');
    ok('CoinGecko stablecoins', `${json.length} coins, USDT mcap $${json[0]?.market_cap}`);
  } catch (err) {
    bad('CoinGecko stablecoins', err.message);
  }
  try {
    const json = await (await get(adv.coingeckoGlobalUrl)).json();
    const dom = json.data?.market_cap_percentage?.btc;
    if (dom == null) throw new Error('no BTC dominance in response');
    ok('CoinGecko global', `BTC dominance ${dom.toFixed(1)}%`);
  } catch (err) {
    bad('CoinGecko global', err.message);
  }
  try {
    const json = await (
      await get(`${adv.coingeckoMarketChartBaseUrl}/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily`)
    ).json();
    if (!json.prices?.length) throw new Error('no price history');
    ok('CoinGecko market_chart', `${json.prices.length} daily closes`);
  } catch (err) {
    bad('CoinGecko market_chart', err.message);
  }
}

console.log(failures ? `\n${failures} source(s) FAILED.` : '\nAll critical sources healthy.');
process.exit(failures ? 1 : 0);
