// Near-real-time price refresh for the screener. The heavy compute (returns,
// trend, charts) runs once daily; this lighter job runs every 15 min from
// /api/ingest to keep the price + 24h column fresh. One ticker call + one
// merge write — it stores only a compact livePrices map, never rewriting the
// full rows array. Zero client JS: the page overlays these on next render.
import { fetchTickers } from './screener.js';

const num = (v) => Number(v);

export async function refreshScreenerPrices(db, cfg, now = new Date()) {
  const ref = db.collection('screener').doc('latest');
  const snap = await ref.get();
  if (!snap.exists) return { updated: 0 }; // no universe computed yet — nothing to overlay

  const universe = new Set((snap.data().rows || []).map((r) => r.symbol));
  if (universe.size === 0) return { updated: 0 };

  const tickers = await fetchTickers(cfg);
  const livePrices = {};
  for (const t of tickers) {
    if (universe.has(t.symbol)) {
      const price = num(t.lastPrice);
      const r24h = num(t.priceChangePercent);
      if (Number.isFinite(price)) {
        livePrices[t.symbol] = {
          price,
          r24h: Number.isFinite(r24h) ? Math.round(r24h * 10) / 10 : null,
        };
      }
    }
  }

  await ref.set({ livePrices, livePricesAt: now.toISOString() }, { merge: true });
  return { updated: Object.keys(livePrices).length };
}
