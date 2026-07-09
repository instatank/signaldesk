// Public REFRESH for the screener (the button on /screener). Like /api/flash
// it's PUBLIC — a browser form can't hold CRON_SECRET — so abuse is bounded
// by a 5-minute cooldown claimed in a Firestore transaction before the build
// runs. No AI; the build is just free Binance calls + math. Same-origin form
// POST → 303 redirect back to the page (zero client JS).
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/firestore.js';
import { acquireScreenerRefresh, buildScreener } from '../../../../lib/screener.js';
import sources from '../../../../config/sources.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function back(request, params) {
  const url = new URL('/screener', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(request) {
  const db = getDb();
  const now = new Date();

  let slot;
  try {
    slot = await acquireScreenerRefresh(db, now);
  } catch (err) {
    return back(request, { error: String(err?.message || err).slice(0, 120) });
  }
  if (!slot.acquired) return back(request, { cooldown: String(slot.remainingSec) });

  try {
    const doc = await buildScreener(sources.screener, sources.assets, now);
    await db.collection('screener').doc('latest').set(doc); // full replace; ingest re-adds livePrices
    return back(request, { refreshed: '1' });
  } catch (err) {
    return back(request, { error: String(err?.message || err).slice(0, 120) });
  }
}
