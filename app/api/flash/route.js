// On-demand flash briefing, triggered by the button on /flash. Unlike the
// cron endpoints this is PUBLIC (a browser form can't hold CRON_SECRET) —
// abuse is bounded instead by a server-enforced 10-minute cooldown claimed
// atomically before any Claude call happens. Same-origin form POST → 303
// redirect back to the page, so the whole flow stays zero-client-JS.
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/firestore.js';
import { acquireFlashSlot, runFlash } from '../../../lib/flash.js';
import sources from '../../../config/sources.json';
import macroCalendar from '../../../config/macro-events.json';
import follows from '../../../config/follows.json';

export const dynamic = 'force-dynamic';
// Lean ingest (a few seconds) + one Claude call (≤60s). 120s is ample.
export const maxDuration = 120;

function back(request, params) {
  const url = new URL('/flash', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(request) {
  const db = getDb();
  const now = new Date();

  let slot;
  try {
    slot = await acquireFlashSlot(db, now);
  } catch (err) {
    return back(request, { error: String(err?.message || err).slice(0, 120) });
  }
  if (!slot.acquired) {
    return back(request, { cooldown: String(slot.remainingSec) });
  }

  try {
    const { degraded } = await runFlash(db, sources, macroCalendar.events, now, follows);
    return back(request, degraded ? { degraded: '1' } : { ran: '1' });
  } catch (err) {
    return back(request, { error: String(err?.message || err).slice(0, 120) });
  }
}
