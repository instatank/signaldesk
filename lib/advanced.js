// Advanced (free-tier) data: long/short account ratios, spot order-book
// depth, stablecoin supply + market dominance, Deribit options read, and
// a daily correlation/realized-vol rollup. Same rules as the core three
// streams: public no-key APIs only, Binance primary with OKX fallback
// where both exist, every fetch independently fault-tolerant. Everything
// lands in one Firestore doc (advanced/latest, merge-written) so the
// Advance page costs a single read.
import { fetchJson } from './http.js';
import {
  interpretLongShort,
  interpretDepth,
  interpretStablecoins,
  interpretPutCall,
  interpretVolGap,
  interpretCorrelation,
} from './interpret.js';

// ---------------------------------------------------------------------
// Long/short account ratio (perps). Counts accounts, not position size —
// retail-skewed by construction, which is exactly why extremes read
// contrarian. Normalized shape per asset:
//   { ratio, longPct, history: [{ts, ratio} oldest→newest], source }

const binanceLongShort = {
  name: 'binance',
  async fetch(cfg, asset) {
    const rows = await fetchJson(
      `${cfg.binanceLongShortUrl}?symbol=${asset.binance}&period=1h&limit=25`
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`Binance long/short empty for ${asset.binance}`);
    }
    const history = rows
      .map((r) => ({ ts: Number(r.timestamp), ratio: Number(r.longShortRatio) }))
      .filter((r) => Number.isFinite(r.ratio))
      .sort((a, b) => a.ts - b.ts);
    const last = history[history.length - 1];
    return {
      ratio: last.ratio,
      longPct: Number(rows[rows.length - 1].longAccount) * 100,
      history,
    };
  },
};

const okxLongShort = {
  name: 'okx',
  async fetch(cfg, asset) {
    const ccy = asset.okx.split('-')[0];
    const json = await fetchJson(`${cfg.okxLongShortUrl}?ccy=${ccy}&period=1H`);
    if (json.code !== '0' || !Array.isArray(json.data) || json.data.length === 0) {
      throw new Error(`OKX long/short error for ${ccy}: ${json.msg || json.code}`);
    }
    const history = json.data
      .map(([ts, ratio]) => ({ ts: Number(ts), ratio: Number(ratio) }))
      .filter((r) => Number.isFinite(r.ratio))
      .sort((a, b) => a.ts - b.ts)
      .slice(-25);
    const last = history[history.length - 1];
    return { ratio: last.ratio, longPct: (last.ratio / (1 + last.ratio)) * 100, history };
  },
};

// ---------------------------------------------------------------------
// 7-day funding history (P1 sparklines). 21 points = 7 days × 3 prints.
//   [{ts, rate} oldest→newest]

const binanceFundingHistory = {
  name: 'binance',
  async fetch(cfg, asset) {
    const rows = await fetchJson(`${cfg.binanceFundingHistoryUrl}?symbol=${asset.binance}&limit=21`);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`Binance funding history empty for ${asset.binance}`);
    }
    return rows
      .map((r) => ({ ts: Number(r.fundingTime), rate: Number(r.fundingRate) }))
      .filter((r) => Number.isFinite(r.rate))
      .sort((a, b) => a.ts - b.ts);
  },
};

const okxFundingHistory = {
  name: 'okx',
  async fetch(cfg, asset) {
    const json = await fetchJson(`${cfg.okxFundingHistoryUrl}?instId=${asset.okx}&limit=21`);
    if (json.code !== '0' || !Array.isArray(json.data) || json.data.length === 0) {
      throw new Error(`OKX funding history error for ${asset.okx}: ${json.msg || json.code}`);
    }
    return json.data
      .map((r) => ({ ts: Number(r.fundingTime), rate: Number(r.fundingRate) }))
      .filter((r) => Number.isFinite(r.rate))
      .sort((a, b) => a.ts - b.ts);
  },
};

// ---------------------------------------------------------------------
// Spot order-book depth. USD resting liquidity within ±rangePct of mid;
// bidSharePct > 50 means bids are thicker. A 15-min snapshot of a book
// that repaints in milliseconds — a texture read, never a signal, and
// the explainer says so.

// Pure: [ [price, qty], ... ] rows (extra columns tolerated, OKX has 4).
export function depthImbalance(bids, asks, rangePct = 2) {
  const num = (rows) =>
    (rows || [])
      .map((r) => [Number(r[0]), Number(r[1])])
      .filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0);
  const b = num(bids);
  const a = num(asks);
  if (b.length === 0 || a.length === 0) return null;
  const mid = (b[0][0] + a[0][0]) / 2;
  const lo = mid * (1 - rangePct / 100);
  const hi = mid * (1 + rangePct / 100);
  const bidUsd = b.filter(([p]) => p >= lo).reduce((s, [p, q]) => s + p * q, 0);
  const askUsd = a.filter(([p]) => p <= hi).reduce((s, [p, q]) => s + p * q, 0);
  if (bidUsd + askUsd === 0) return null;
  return { mid, bidUsd, askUsd, bidSharePct: (bidUsd / (bidUsd + askUsd)) * 100 };
}

const binanceDepth = {
  name: 'binance',
  async fetch(cfg, asset) {
    const book = await fetchJson(`${cfg.binanceDepthUrl}?symbol=${asset.binance}&limit=500`);
    const result = depthImbalance(book.bids, book.asks);
    if (!result) throw new Error(`Binance depth empty for ${asset.binance}`);
    return result;
  },
};

const okxDepth = {
  name: 'okx',
  async fetch(cfg, asset) {
    const instId = asset.okx.replace('-SWAP', '');
    const json = await fetchJson(`${cfg.okxBooksUrl}?instId=${instId}&sz=400`);
    if (json.code !== '0' || !json.data?.[0]) {
      throw new Error(`OKX books error for ${instId}: ${json.msg || json.code}`);
    }
    const result = depthImbalance(json.data[0].bids, json.data[0].asks);
    if (!result) throw new Error(`OKX depth empty for ${instId}`);
    return result;
  },
};

// Shared per-asset failover runner, same contract as fetchAllDerivatives:
// { data: {SYM: {...}|null}, errors: [...] }.
async function fetchAllPerAsset(cfg, assets, sources) {
  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      let lastError;
      for (const source of sources) {
        try {
          const data = await source.fetch(cfg, asset);
          return Array.isArray(data) ? { history: data, source: source.name } : { ...data, source: source.name };
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    })
  );
  const data = {};
  const errors = [];
  results.forEach((result, i) => {
    const symbol = assets[i].symbol;
    if (result.status === 'fulfilled') {
      data[symbol] = result.value;
    } else {
      data[symbol] = null;
      errors.push({ asset: symbol, error: String(result.reason?.message || result.reason) });
    }
  });
  return { data, errors };
}

export const LONG_SHORT_SOURCES = [binanceLongShort, okxLongShort];
export const FUNDING_HISTORY_SOURCES = [binanceFundingHistory, okxFundingHistory];
export const DEPTH_SOURCES = [binanceDepth, okxDepth];

export function fetchAllLongShort(cfg, assets, sources = LONG_SHORT_SOURCES) {
  return fetchAllPerAsset(cfg, assets, sources);
}
export function fetchAllFundingHistory(cfg, assets, sources = FUNDING_HISTORY_SOURCES) {
  return fetchAllPerAsset(cfg, assets, sources);
}
export function fetchAllDepth(cfg, assets, sources = DEPTH_SOURCES) {
  return fetchAllPerAsset(cfg, assets, sources);
}

// ---------------------------------------------------------------------
// Stablecoin supply (dry powder) + global market cap / dominance —
// CoinGecko free endpoints, the spot-liquidity counterpart to the
// perps-side positioning data.

export function totalMcapChangePct(coins) {
  let current = 0;
  let previous = 0;
  for (const c of coins) {
    if (!Number.isFinite(c.marketCap)) continue;
    current += c.marketCap;
    const pct = Number.isFinite(c.mcapChange24hPct) ? c.mcapChange24hPct : 0;
    previous += c.marketCap / (1 + pct / 100);
  }
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function fetchStablecoinAndGlobal(cfg) {
  const ids = cfg.stablecoins.map((s) => s.coingecko).join(',');
  const [marketsResult, globalResult] = await Promise.allSettled([
    fetchJson(`${cfg.coingeckoMarketsUrl}?vs_currency=usd&ids=${ids}`, {
      headers: { accept: 'application/json' },
    }),
    fetchJson(cfg.coingeckoGlobalUrl, { headers: { accept: 'application/json' } }),
  ]);

  const errors = [];
  let stablecoins = null;
  if (marketsResult.status === 'fulfilled' && Array.isArray(marketsResult.value)) {
    const byId = new Map(marketsResult.value.map((c) => [c.id, c]));
    const coins = cfg.stablecoins
      .map((s) => {
        const c = byId.get(s.coingecko);
        return c
          ? {
              symbol: s.symbol,
              marketCap: Number(c.market_cap),
              mcapChange24hPct: c.market_cap_change_percentage_24h ?? null,
              price: Number(c.current_price),
            }
          : null;
      })
      .filter(Boolean);
    if (coins.length) {
      stablecoins = {
        coins,
        totalMcap: coins.reduce((s, c) => s + (c.marketCap || 0), 0),
        totalChange24hPct: totalMcapChangePct(coins),
      };
    }
  } else {
    errors.push({ what: 'stablecoins', error: String(marketsResult.reason?.message || marketsResult.reason) });
  }

  let global = null;
  if (globalResult.status === 'fulfilled' && globalResult.value?.data) {
    const g = globalResult.value.data;
    global = {
      totalMcapUsd: g.total_market_cap?.usd ?? null,
      mcapChange24hPct: g.market_cap_change_percentage_24h_usd ?? null,
      btcDominancePct: g.market_cap_percentage?.btc ?? null,
      ethDominancePct: g.market_cap_percentage?.eth ?? null,
    };
  } else {
    errors.push({ what: 'global', error: String(globalResult.reason?.message || globalResult.reason) });
  }

  return { stablecoins, global, errors };
}

// ---------------------------------------------------------------------
// Options read (Deribit public API, BTC/ETH only — the coins with a
// liquid listed options market). DVOL = implied 30-day annualized vol;
// put/call open-interest ratio = hedging vs speculation balance.

// Pure: aggregate open interest by instrument suffix (-C / -P).
export function aggregateOptionOi(summaries) {
  let callOi = 0;
  let putOi = 0;
  for (const s of summaries || []) {
    const oi = Number(s.open_interest);
    if (!Number.isFinite(oi)) continue;
    if (String(s.instrument_name).endsWith('-C')) callOi += oi;
    else if (String(s.instrument_name).endsWith('-P')) putOi += oi;
  }
  if (callOi + putOi === 0) return null;
  return { callOi, putOi, putCallRatio: callOi > 0 ? putOi / callOi : null };
}

async function fetchOptionsForCurrency(cfg, currency, now) {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const [summary, dvol] = await Promise.allSettled([
    fetchJson(
      `${cfg.deribitBaseUrl}/public/get_book_summary_by_currency?currency=${currency}&kind=option`,
      { timeoutMs: 20_000 }
    ),
    fetchJson(
      `${cfg.deribitBaseUrl}/public/get_volatility_index_data?currency=${currency}&start_timestamp=${dayAgo}&end_timestamp=${now}&resolution=3600`
    ),
  ]);

  const oi = summary.status === 'fulfilled' ? aggregateOptionOi(summary.value?.result) : null;

  let dvolNow = null;
  let dvolChange24h = null;
  if (dvol.status === 'fulfilled') {
    // Candles are [ts, open, high, low, close], oldest → newest.
    const candles = dvol.value?.result?.data || [];
    if (candles.length) {
      dvolNow = Number(candles[candles.length - 1][4]);
      const first = Number(candles[0][4]);
      if (Number.isFinite(dvolNow) && Number.isFinite(first)) dvolChange24h = dvolNow - first;
    }
  }

  if (!oi && dvolNow == null) {
    const reason = summary.reason || dvol.reason;
    throw new Error(`Deribit ${currency}: ${String(reason?.message || reason || 'no data')}`);
  }
  return { ...oi, dvol: dvolNow, dvolChange24h };
}

export async function fetchAllOptions(cfg, now = Date.now()) {
  const currencies = cfg.optionsCurrencies || [];
  const results = await Promise.allSettled(
    currencies.map((c) => fetchOptionsForCurrency(cfg, c, now))
  );
  const data = {};
  const errors = [];
  results.forEach((result, i) => {
    const currency = currencies[i];
    if (result.status === 'fulfilled') data[currency] = result.value;
    else {
      data[currency] = null;
      errors.push({ asset: currency, error: String(result.reason?.message || result.reason) });
    }
  });
  return { data, errors };
}

// ---------------------------------------------------------------------
// Daily rollup: 30-day correlation vs BTC + realized volatility, from
// CoinGecko daily closes. Fetched once a day (the ingest route gates on
// the stored rollup's age) and serially, to stay friendly to the free
// tier's rate limit.

export function logReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i += 1) {
    const a = Number(prices[i - 1]);
    const b = Number(prices[i]);
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null; // too few points to mean anything
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / n;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

// Annualized realized volatility in percent, from daily log returns.
export function realizedVolPct(returns) {
  if (!returns || returns.length < 10) return null;
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

export async function fetchDailyRollup(cfg, assets) {
  const errors = [];
  const returnsBySymbol = {};
  // Serial on purpose: six burst requests trip CoinGecko's free tier.
  for (const asset of assets) {
    try {
      const json = await fetchJson(
        `${cfg.coingeckoMarketChartBaseUrl}/${asset.coingecko}/market_chart?vs_currency=usd&days=30&interval=daily`,
        { headers: { accept: 'application/json' } }
      );
      const closes = (json.prices || []).map((p) => Number(p[1]));
      returnsBySymbol[asset.symbol] = logReturns(closes);
    } catch (err) {
      errors.push({ asset: asset.symbol, error: String(err.message || err) });
    }
  }

  const btcReturns = returnsBySymbol.BTC || null;
  const data = {};
  for (const asset of assets) {
    const returns = returnsBySymbol[asset.symbol];
    if (!returns || returns.length === 0) {
      data[asset.symbol] = null;
      continue;
    }
    data[asset.symbol] = {
      realizedVolPct: realizedVolPct(returns),
      correlationToBtc:
        asset.symbol === 'BTC' || !btcReturns ? null : pearson(returns, btcReturns),
    };
  }
  return { data, errors };
}

// ---------------------------------------------------------------------
// Advance-page shaping: one Firestore read, plain JS out, interpretation
// text from interpret.js (same contract as lib/dashboard.js).

export function compactUsd(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Band colors mirror the interpretation thresholds (same tone language
// as the funding strip: red = crowded long, green = crowded short).
export function longShortBand(ratio) {
  if (!Number.isFinite(ratio)) return 'gray';
  if (ratio >= 3) return 'red';
  if (ratio >= 1.5) return 'amber';
  if (ratio >= 0.67) return 'gray';
  return 'green';
}

export function depthBand(bidSharePct) {
  if (!Number.isFinite(bidSharePct)) return 'gray';
  if (bidSharePct >= 60) return 'green';
  if (bidSharePct <= 40) return 'red';
  return 'gray';
}

export function shapeLongShort(section, assets) {
  if (!section?.data) return null;
  const rows = assets
    .map((a) => {
      const d = section.data[a.symbol];
      if (!d || !Number.isFinite(d.ratio)) return null;
      const read = interpretLongShort(d.ratio);
      return {
        symbol: a.symbol,
        ratio: d.ratio,
        longPct: Number.isFinite(d.longPct) ? d.longPct : null,
        spark: (d.history || []).map((h) => Number(h.ratio)).filter(Number.isFinite),
        band: longShortBand(d.ratio),
        source: d.source,
        ...read,
      };
    })
    .filter(Boolean);
  if (!rows.length) return null;
  const leaningLong = rows.filter((r) => r.ratio > 1).length;
  const mostExtreme = rows.reduce((a, b) =>
    Math.abs(Math.log(b.ratio)) > Math.abs(Math.log(a.ratio)) ? b : a
  );
  return { rows, leaningLong, total: rows.length, mostExtreme, ts: section.ts || null };
}

export function shapeDepth(section, assets) {
  if (!section?.data) return null;
  const rows = assets
    .map((a) => {
      const d = section.data[a.symbol];
      if (!d || !Number.isFinite(d.bidSharePct)) return null;
      return {
        symbol: a.symbol,
        bidSharePct: d.bidSharePct,
        bidUsd: d.bidUsd,
        askUsd: d.askUsd,
        band: depthBand(d.bidSharePct),
        read: interpretDepth(d.bidSharePct),
        source: d.source,
      };
    })
    .filter(Boolean);
  if (!rows.length) return null;
  const mostImbalanced = rows.reduce((a, b) =>
    Math.abs(b.bidSharePct - 50) > Math.abs(a.bidSharePct - 50) ? b : a
  );
  return { rows, mostImbalanced, ts: section.ts || null };
}

export function shapeStables(section) {
  if (!section) return null;
  const s = section.stablecoins;
  const g = section.global;
  if (!s && !g) return null;
  return {
    totalMcap: s?.totalMcap ?? null,
    totalChange24hPct: s?.totalChange24hPct ?? null,
    read: s ? interpretStablecoins(s.totalChange24hPct) : null,
    coins: s?.coins || [],
    global: g || null,
    ts: section.ts || null,
  };
}

// Options + the daily rollup pair up: DVOL (implied) reads against the
// same coin's realized vol, the implied-vs-realized gap being the lesson.
export function shapeOptions(section, rollup) {
  if (!section?.data) return null;
  const rows = Object.entries(section.data)
    .filter(([, d]) => d)
    .map(([currency, d]) => {
      const realized = rollup?.data?.[currency]?.realizedVolPct ?? null;
      return {
        currency,
        dvol: Number.isFinite(d.dvol) ? d.dvol : null,
        dvolChange24h: Number.isFinite(d.dvolChange24h) ? d.dvolChange24h : null,
        putCallRatio: Number.isFinite(d.putCallRatio) ? d.putCallRatio : null,
        callOi: d.callOi ?? null,
        putOi: d.putOi ?? null,
        pcRead: interpretPutCall(d.putCallRatio),
        realizedVolPct: realized,
        volGapRead: interpretVolGap(d.dvol, realized),
      };
    });
  if (!rows.length) return null;
  return { rows, ts: section.ts || null };
}

export function shapeRollup(section, assets) {
  if (!section?.data) return null;
  const rows = assets
    .map((a) => {
      const d = section.data[a.symbol];
      if (!d) return null;
      return {
        symbol: a.symbol,
        realizedVolPct: Number.isFinite(d.realizedVolPct) ? d.realizedVolPct : null,
        correlationToBtc: Number.isFinite(d.correlationToBtc) ? d.correlationToBtc : null,
        corrRead: interpretCorrelation(d.correlationToBtc),
      };
    })
    .filter(Boolean);
  if (!rows.length) return null;
  const wildest = rows.reduce((a, b) =>
    (b.realizedVolPct ?? -1) > (a.realizedVolPct ?? -1) ? b : a
  );
  return { rows, wildest, ts: section.ts || null };
}

function toDate(ts) {
  return ts?.toDate?.() || (ts instanceof Date ? ts : null);
}

export async function getAdvancedData(db) {
  const snap = await db.collection('advanced').doc('latest').get();
  if (!snap.exists) return null;
  const doc = snap.data();
  const section = (key) => {
    const s = doc[key];
    if (!s) return null;
    return { ...s, ts: toDate(s.ts) };
  };
  return {
    longShort: section('longShort'),
    depth: section('depth'),
    stables: section('stables'),
    options: section('options'),
    rollup: section('rollup'),
    fundingHistory: section('fundingHistory'),
  };
}
