// Daily cron: pull the Binance-futures universe, compute the screener, and
// store it in screener/latest. No AI, no Telegram — pure data. Protected by
// CRON_SECRET like the other cron endpoints. A near-real-time price refresh
// for the same universe piggybacks on /api/ingest every 15 min (see
// refreshScreenerPrices in lib/screener-live.js).
import { NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth.js';
import { getDb } from '../../../lib/firestore.js';
import { buildScreener } from '../../../lib/screener.js';
import sources from '../../../config/sources.json';
import { withCors } from '../../../lib/cors.js';

export const dynamic = 'force-dynamic';
// ~30–36 coins × (klines + funding + OI), fetched in parallel but courteous
// to Binance rate limits; 300s gives comfortable headroom.
export const maxDuration = 300;

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
  }

  const now = new Date();
  const cfg = sources.screener;
  if (!cfg) {
    return withCors(NextResponse.json({ error: 'screener not configured' }, { status: 500 }));
  }

  try {
    const doc = await buildScreener(cfg, sources.assets, now);
    await getDb().collection('screener').doc('latest').set(doc);
    return withCors(NextResponse.json({
      ok: true,
      generatedAt: doc.generatedAt,
      coins: doc.universeSize,
      errors: doc.errors.length,
    }));
  } catch (err) {
    return withCors(NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 502 }));
  }
}
