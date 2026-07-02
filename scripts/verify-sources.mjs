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

const sources = JSON.parse(readFileSync(new URL('../config/sources.json', import.meta.url)));
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

console.log(failures ? `\n${failures} source(s) FAILED.` : '\nAll critical sources healthy.');
process.exit(failures ? 1 : 0);
