// Crypto screener: "what's strong, what's moving, what's crowded" across a
// universe of the largest Binance-futures coins, measured daily. Pure math
// over price/funding/open-interest — NO AI, no paid data. A background cron
// (/api/screener) computes one Firestore doc (screener/latest); the pages
// just read it. Same rules as the rest of the app: public no-key APIs,
// every fetch fault-isolated, all plain-language reads via lib/interpret.js.
import { fetchJson } from './http.js';
import {
  interpretScreenerTrend,
  interpretVsBitcoin,
  interpretCostToHold,
} from './interpret.js';

// ---------------------------------------------------------------------
// Pure math (exported for offline tests). Series are daily CLOSES,
// oldest → newest, unless noted.

// Percent change from `days` ago to the latest price. Uses `now` as the
// current price so the freshest tick counts, not yesterday's close.
export function pctChange(closes, now, days) {
  if (!closes || closes.length === 0 || !Number.isFinite(now)) return null;
  const idx = closes.length - 1 - days;
  if (idx < 0) return null; // not enough history for this window
  const then = closes[idx];
  if (!Number.isFinite(then) || then === 0) return null;
  return (now / then - 1) * 100;
}

export function sma(closes, n) {
  if (!closes || closes.length < n || n <= 0) return null;
  const slice = closes.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

// Average absolute daily move (%), weighted toward recent days — a plain
// "how much does it swing" number, not a forecast. Half-life ~14 days.
export function realizedDailyMove(closes) {
  if (!closes || closes.length < 3) return null;
  let wSum = 0;
  let w = 0;
  for (let i = closes.length - 1; i > 0 && closes.length - i <= 45; i -= 1) {
    if (!Number.isFinite(closes[i]) || !Number.isFinite(closes[i - 1]) || closes[i - 1] === 0) continue;
    const move = Math.abs(closes[i] / closes[i - 1] - 1) * 100;
    const weight = Math.pow(0.95, closes.length - 1 - i);
    wSum += move * weight;
    w += weight;
  }
  return w > 0 ? wSum / w : null;
}

// Distance below the highest price of the past `lookback` days (or all
// history if shorter). Returns { pctBelowHigh, daysListed }.
export function drawdownFromHigh(highs, now, lookback = 365) {
  if (!highs || highs.length === 0 || !Number.isFinite(now)) return null;
  const window = highs.slice(-lookback).filter(Number.isFinite);
  if (window.length === 0) return null;
  const high = Math.max(...window, now);
  const pctBelowHigh = high > 0 ? (1 - now / high) * 100 : 0;
  return { pctBelowHigh, daysListed: highs.length };
}

// Percentile rank of `value` within `all` (0–100): the % of entries it is
// greater than or equal to. Ties count as "at least as good".
export function percentileRank(value, all) {
  const nums = all.filter(Number.isFinite);
  if (nums.length === 0 || !Number.isFinite(value)) return null;
  const below = nums.filter((v) => v <= value).length;
  return (below / nums.length) * 100;
}

// Composite strength = the average of a coin's percentile ranks on three
// axes: 30-day return, trend (distance above/below its 200-day avg), and
// swing-adjusted return (30d return per unit of daily wobble). One number,
// 0–100, "stronger than X% of the market".
export function compositeStrengths(rows) {
  const r30 = rows.map((r) => r.r30d);
  const trend = rows.map((r) => r.ma200Gap);
  const swing = rows.map((r) => (r.r30d != null && r.dailyMove ? r.r30d / r.dailyMove : null));
  return rows.map((r, i) => {
    const parts = [
      percentileRank(r30[i], r30),
      percentileRank(trend[i], trend),
      percentileRank(swing[i], swing),
    ].filter((p) => p != null);
    if (parts.length === 0) return null;
    return parts.reduce((s, v) => s + v, 0) / parts.length;
  });
}

// Index a close series to 100 at its start — for comparing coins of wildly
// different prices on one relative chart.
export function indexed(series) {
  const nums = (series || []).filter(Number.isFinite);
  if (nums.length < 2 || nums[0] === 0) return [];
  return nums.map((v) => (v / nums[0]) * 100);
}

// The average tracked coin's indexed path over the last `days` — the
// "market" line each coin is measured against.
export function marketAverageSeries(allCloses, days = 30) {
  const paths = allCloses
    .map((c) => indexed((c || []).slice(-(days + 1))))
    .filter((p) => p.length >= 2);
  if (paths.length === 0) return [];
  const len = Math.min(...paths.map((p) => p.length));
  const out = [];
  for (let i = 0; i < len; i += 1) {
    out.push(paths.reduce((s, p) => s + p[i], 0) / paths.length);
  }
  return out;
}

// A coin's cumulative-return gap vs the market average, over `days`. Above
// zero = ahead of the average tracked coin.
export function relativeSeries(coinCloses, marketAvg, days = 30) {
  const coin = indexed((coinCloses || []).slice(-(days + 1)));
  if (coin.length < 2 || marketAvg.length < 2) return [];
  const len = Math.min(coin.length, marketAvg.length);
  const out = [];
  for (let i = 0; i < len; i += 1) out.push(coin[i] - marketAvg[i]);
  return out;
}

// Binance funding prints every 8h (3/day). Annualize the past-week average.
export function annualizeFunding(fundingRates) {
  const nums = (fundingRates || []).filter(Number.isFinite);
  if (nums.length === 0) return null;
  const recent = nums.slice(-21); // ~7 days
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  return avg * 3 * 365 * 100; // → annual percent
}

// Collapse 8h funding prints into daily sums for the detail bar chart.
export function dailyFunding(fundingPoints, days = 25) {
  const byDay = new Map();
  for (const p of fundingPoints || []) {
    if (!Number.isFinite(p.ts) || !Number.isFinite(p.rate)) continue;
    const day = Math.floor(p.ts / 86_400_000);
    byDay.set(day, (byDay.get(day) || 0) + p.rate * 100);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).slice(-days).map(([, v]) => v);
}

// Percent change in open interest across a series (window start → now).
export function oiChangePct(oiSeries) {
  const nums = (oiSeries || []).filter(Number.isFinite);
  if (nums.length < 2 || nums[0] === 0) return null;
  return (nums[nums.length - 1] / nums[0] - 1) * 100;
}

// ---------------------------------------------------------------------
// Fetchers. Binance USDⓈ-M futures, public + no key. Each is independently
// awaited by the orchestrator with Promise.allSettled so one dead symbol or
// endpoint degrades a slice, never the whole run.

const num = (v) => Number(v);

// One call returns every symbol's 24h stats. We pick the universe from it.
export async function fetchTickers(cfg) {
  const rows = await fetchJson(cfg.ticker24hUrl, { timeoutMs: 15_000 });
  if (!Array.isArray(rows)) throw new Error('ticker/24hr did not return an array');
  return rows;
}

// Choose the universe: top-N USDT perpetuals by quote volume, always
// unioned with our tracked coins so they never fall out of the table.
export function selectUniverse(tickers, size, trackedBinanceSymbols = []) {
  const usdtPerps = tickers.filter(
    (t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT') && !t.symbol.includes('_')
  );
  const byVol = [...usdtPerps].sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume));
  const chosen = new Map();
  for (const t of byVol.slice(0, size)) chosen.set(t.symbol, t);
  for (const sym of trackedBinanceSymbols) {
    if (!chosen.has(sym)) {
      const t = usdtPerps.find((x) => x.symbol === sym);
      if (t) chosen.set(sym, t);
    }
  }
  return [...chosen.values()];
}

export async function fetchDailyKlines(cfg, symbol, limit = 365) {
  const rows = await fetchJson(
    `${cfg.klinesUrl}?symbol=${symbol}&interval=1d&limit=${limit}`,
    { timeoutMs: 15_000 }
  );
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`klines empty for ${symbol}`);
  return {
    closes: rows.map((r) => num(r[4])).filter(Number.isFinite),
    highs: rows.map((r) => num(r[2])).filter(Number.isFinite),
    volumes: rows.map((r) => num(r[7])).filter(Number.isFinite), // quote volume
  };
}

export async function fetchFundingPoints(cfg, symbol, limit = 75) {
  const rows = await fetchJson(
    `${cfg.fundingHistoryUrl}?symbol=${symbol}&limit=${limit}`,
    { timeoutMs: 12_000 }
  );
  if (!Array.isArray(rows)) throw new Error(`fundingRate not array for ${symbol}`);
  return rows
    .map((r) => ({ ts: num(r.fundingTime), rate: num(r.fundingRate) }))
    .filter((p) => Number.isFinite(p.rate))
    .sort((a, b) => a.ts - b.ts);
}

export async function fetchOiHist(cfg, symbol, limit = 30) {
  const rows = await fetchJson(
    `${cfg.openInterestHistUrl}?symbol=${symbol}&period=1d&limit=${limit}`,
    { timeoutMs: 12_000 }
  );
  if (!Array.isArray(rows)) throw new Error(`openInterestHist not array for ${symbol}`);
  return rows.map((r) => num(r.sumOpenInterest)).filter(Number.isFinite);
}

// ---------------------------------------------------------------------
// Orchestration: fetch everything, compute every derived field, and return
// the full screener document (ready to store). db-free and side-effect-free
// so it stays testable; the route does the Firestore write.

export async function buildScreener(cfg, assets, now = new Date()) {
  const trackedByBinance = new Map(assets.map((a) => [a.binance, a.symbol]));
  const errors = [];

  const tickers = await fetchTickers(cfg); // throws → whole run fails (no universe)
  const universe = selectUniverse(tickers, cfg.universeSize, [...trackedByBinance.keys()]);

  // Per-coin history, fault-isolated and fetched in small batches so we
  // don't fire ~100 requests at Binance at once (rate-limit courtesy).
  const fetchOne = async (t) => {
    const symbol = t.symbol;
    const [kl, fund, oi] = await Promise.allSettled([
      fetchDailyKlines(cfg, symbol),
      fetchFundingPoints(cfg, symbol),
      fetchOiHist(cfg, symbol),
    ]);
    if (kl.status === 'rejected') {
      errors.push({ symbol, error: String(kl.reason?.message || kl.reason) });
      return null;
    }
    return {
      ticker: t,
      klines: kl.value,
      funding: fund.status === 'fulfilled' ? fund.value : [],
      oi: oi.status === 'fulfilled' ? oi.value : [],
    };
  };

  const perCoin = [];
  const BATCH = 6;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    perCoin.push(...(await Promise.all(batch.map(fetchOne))));
  }

  const coins = perCoin.filter(Boolean);
  const btc = coins.find((c) => c.ticker.symbol === 'BTCUSDT');
  const btcR30 = btc ? pctChange(btc.klines.closes, num(btc.ticker.lastPrice), 30) : null;
  const btcMa200 = btc ? sma(btc.klines.closes, 200) : null;
  const btcPrice = btc ? num(btc.ticker.lastPrice) : null;

  const marketAvg = marketAverageSeries(coins.map((c) => c.klines.closes), 30);

  // First pass: raw per-coin fields the composite score needs.
  const base = coins.map((c) => {
    const { symbol, lastPrice, priceChangePercent } = c.ticker;
    const price = num(lastPrice);
    const closes = c.klines.closes;
    const ma200 = sma(closes, 200);
    const dailyMove = realizedDailyMove(closes);
    return {
      symbol,
      base: symbol.replace(/USDT$/, ''),
      name: cfg.names?.[symbol] || symbol.replace(/USDT$/, ''),
      tracked: trackedByBinance.has(symbol),
      price,
      r24h: Number.isFinite(num(priceChangePercent)) ? num(priceChangePercent) : pctChange(closes, price, 1),
      r7d: pctChange(closes, price, 7),
      r30d: pctChange(closes, price, 30),
      r60d: pctChange(closes, price, 60),
      ma200Gap: ma200 ? (price / ma200 - 1) * 100 : null,
      aboveMa200: ma200 ? price > ma200 : null,
      dailyMove,
      annualFunding: annualizeFunding(c.funding.map((f) => f.rate)),
      oiChange: oiChangePct(c.oi),
      closes,
      highs: c.klines.highs,
      volumes: c.klines.volumes,
      fundingPoints: c.funding,
      oiSeries: c.oi,
    };
  });

  const strengths = compositeStrengths(base);

  // Second pass: labels, sparklines, detail. Everything the pages render.
  const rows = base.map((b, i) => {
    const strength = strengths[i];
    const trend = interpretScreenerTrend({ aboveMa200: b.aboveMa200, r7d: b.r7d });
    const isBtc = b.symbol === 'BTCUSDT';
    const cost = interpretCostToHold(b.annualFunding);
    const relSpark = relativeSeries(b.closes, marketAvg, 30);
    const dd = drawdownFromHigh(b.highs, b.price, 365);
    const avgVol = b.volumes.length ? b.volumes.slice(-30).reduce((s, v) => s + v, 0) / Math.min(30, b.volumes.length) : null;
    const lastVol = b.volumes.length ? b.volumes[b.volumes.length - 1] : null;
    return {
      symbol: b.symbol,
      base: b.base,
      name: b.name,
      tracked: b.tracked,
      price: b.price,
      r24h: round(b.r24h),
      r7d: round(b.r7d),
      r30d: round(b.r30d),
      r60d: round(b.r60d),
      strength: round(strength),
      trend,
      vsBtc: interpretVsBitcoin(b.r30d, btcR30, isBtc),
      cost,
      relSpark: relSpark.map(round),
      worthNoting: worthNoting(b),
      detail: {
        rankStrength: round(strength),
        r24h: round(b.r24h),
        r7d: round(b.r7d),
        r30d: round(b.r30d),
        r60d: round(b.r60d),
        vsBtc30: round(btcR30),
        annualFunding: round(b.annualFunding),
        cost,
        drawdown: dd ? { pctBelowHigh: round(dd.pctBelowHigh), daysListed: dd.daysListed } : null,
        dailyMove: round(b.dailyMove),
        aboveMa200: b.aboveMa200,
        trend,
        relSeries: relSpark.map(round),
        fundingBars: dailyFunding(b.fundingPoints, 25).map(round5),
        oiSeries: b.oiSeries.map((v) => round(v, 0)),
        oiChange: round(b.oiChange),
        volumeQuiet: avgVol != null && lastVol != null ? lastVol < avgVol * 0.7 : false,
      },
    };
  });

  // Rank by composite strength (desc) for the "# by size"-style position.
  const byStrength = [...rows].sort((a, b) => (b.strength ?? -1) - (a.strength ?? -1));
  byStrength.forEach((r, i) => {
    r.strengthRank = i + 1;
  });
  // Rank by volume for the "# by size" the reference shows.
  const byVol = [...universe].filter((t) => rows.some((r) => r.symbol === t.symbol));
  const volRank = new Map(byVol.map((t, i) => [t.symbol, i + 1]));
  rows.forEach((r) => {
    r.sizeRank = volRank.get(r.symbol) ?? null;
  });

  return {
    generatedAt: now.toISOString(),
    universeSize: rows.length,
    market: buildMarketSummary(rows, { btcPrice, btcMa200, btcR30 }),
    insights: buildInsights(rows),
    rows: rows.sort((a, b) => (a.sizeRank ?? 999) - (b.sizeRank ?? 999)),
    errors,
  };
}

// ---------------------------------------------------------------------
// Summary + curated lists (pure over the computed rows).

export function buildMarketSummary(rows, btc) {
  const withR7 = rows.filter((r) => r.r7d != null);
  const coinsUp = withR7.filter((r) => r.r7d > 0).length;
  const withR30 = rows.filter((r) => r.r30d != null);
  const avgMonth = withR30.length ? withR30.reduce((s, r) => s + r.r30d, 0) / withR30.length : null;
  const crowded = rows.filter((r) => r.cost.tone === 'amber').length;
  const flushed = rows.filter((r) => r.detail?.oiChange != null && r.detail.oiChange < -30).length;
  const btcDown = btc.btcMa200 != null && btc.btcPrice != null && btc.btcPrice < btc.btcMa200;
  return {
    btcRegime: btc.btcMa200 == null
      ? 'Bitcoin regime unavailable.'
      : btcDown
        ? 'Bitcoin is in a downtrend — trading below its average price of the past 200 days. Strength readings have a weaker record in this state.'
        : 'Bitcoin is in an uptrend — trading above its average price of the past 200 days.',
    breadth: `The market is ${coinsUp > withR7.length / 2 ? 'leaning up' : 'mixed'} — ${coinsUp} of ${withR7.length} coins are up over the past week.`,
    avgMonth: avgMonth == null ? null : `The average coin is ${avgMonth >= 0 ? 'up' : 'down'} ${Math.abs(avgMonth).toFixed(1)}% over the past month.`,
    crowding: crowded === 0
      ? 'The cost of holding positions is normal today — no market-wide crowding.'
      : `${crowded} coin${crowded > 1 ? 's are' : ' is'} showing elevated funding — pockets of crowding.`,
    oiAnomaly: flushed > 0
      ? `${flushed} coin${flushed > 1 ? 's' : ''} just saw an unusually sharp drop in open positions — traders forced out or leaving fast.`
      : null,
  };
}

export function buildInsights(rows, topN = 6) {
  const rated = rows.filter((r) => r.strength != null);

  const strongest = [...rated].sort((a, b) => b.strength - a.strength);

  const speed = rows
    .filter((r) => r.r7d != null && r.r30d != null && r.r7d > 0)
    .map((r) => ({ ...r, accel: r.r7d - r.r30d * (7 / 30) }))
    .filter((r) => r.accel > 3)
    .sort((a, b) => b.accel - a.accel);

  const crowded = rows
    .filter((r) => r.detail?.annualFunding != null && r.detail.annualFunding >= 10)
    .sort((a, b) => b.detail.annualFunding - a.detail.annualFunding);

  const washedOut = rows
    .filter((r) => r.r60d != null && r.r60d < -20)
    .sort((a, b) => a.r60d - b.r60d);

  const bigMoves = rows
    .filter((r) => r.r24h != null)
    .sort((a, b) => Math.abs(b.r24h) - Math.abs(a.r24h))
    .filter((r) => Math.abs(r.r24h) >= 4);

  const pack = (list) => ({
    top: list.slice(0, topN).map(pickCard),
    overflow: list.slice(topN, topN + 12).map((r) => r.base),
  });

  return {
    strongest: pack(strongest),
    speed: pack(speed),
    crowded: pack(crowded),
    washedOut: pack(washedOut),
    bigMoves: pack(bigMoves),
  };
}

function pickCard(r) {
  return {
    symbol: r.symbol,
    base: r.base,
    name: r.name,
    tracked: r.tracked,
    strength: r.strength,
    r7d: r.r7d,
    r30d: r.r30d,
    r60d: r.r60d,
    r24h: r.r24h,
    relSpark: r.relSpark,
    annualFunding: r.detail?.annualFunding ?? null,
    volumeQuiet: r.detail?.volumeQuiet ?? false,
  };
}

function worthNoting(b) {
  if (b.oiChange != null && b.oiChange < -30) return 'flushed';
  if (b.annualFunding != null && b.annualFunding >= 30) return 'crowded';
  if (b.r24h != null && Math.abs(b.r24h) >= 10) return 'big move';
  return null;
}

// Round helpers keep the stored doc small and clean.
function round(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
function round5(v) {
  return round(v, 4);
}

// Overlay the 15-min livePrices map onto the daily rows so the price + 24h
// column reads near-real-time. Returns fresh row objects (no mutation).
export function overlayLivePrices(rows, livePrices) {
  if (!livePrices) return rows;
  return rows.map((r) => {
    const live = livePrices[r.symbol];
    if (!live) return r;
    return {
      ...r,
      price: Number.isFinite(live.price) ? live.price : r.price,
      r24h: live.r24h != null ? live.r24h : r.r24h,
      live: true,
    };
  });
}

// ---------------------------------------------------------------------
// Reader: the single Firestore read for the screener pages.
export async function getScreenerData(db) {
  const snap = await db.collection('screener').doc('latest').get();
  if (!snap.exists) return null;
  const d = snap.data();
  return {
    generatedAt: d.generatedAt || null,
    livePricesAt: d.livePricesAt || null,
    universeSize: d.universeSize || 0,
    market: d.market || null,
    insights: d.insights || null,
    rows: overlayLivePrices(d.rows || [], d.livePrices || null),
  };
}

export function findCoin(data, base) {
  if (!data?.rows) return null;
  const target = String(base || '').toUpperCase();
  return data.rows.find((r) => r.base === target || r.symbol === target) || null;
}

// Manual-refresh cooldown. The screener build is free (no AI) but heavy, so
// the public REFRESH button is rate-limited by a Firestore transaction the
// same way flash is — bounds compute no matter who presses it.
export const SCREENER_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export async function acquireScreenerRefresh(db, now = new Date(), cooldownMs = SCREENER_REFRESH_COOLDOWN_MS) {
  const ref = db.collection('screener').doc('lock');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const startedAt = snap.exists ? snap.data()?.startedAt?.toDate?.() : null;
    if (startedAt && now.getTime() - startedAt.getTime() < cooldownMs) {
      return { acquired: false, remainingSec: Math.ceil((cooldownMs - (now - startedAt)) / 1000) };
    }
    tx.set(ref, { startedAt: now }, { merge: true });
    return { acquired: true, remainingSec: 0 };
  });
}
