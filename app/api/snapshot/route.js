// The TradeGenie bridge endpoint (see TRADEGENIE_BRIDGE.md).
//
// TradeGenie calls this once when a trade is saved and freezes the answer
// onto the trade forever. It reads only data already in Firestore — no
// upstream fetching — so it is fast and free, and it can serve any past
// slot, which is what makes a failed capture recoverable later.
//
// Three properties this route must keep:
//   1. Its own secret. SNAPSHOT_TOKEN, never CRON_SECRET — TradeGenie must
//      not hold the key that can trigger digests.
//   2. It never throws. Any internal failure returns 200 with null sections:
//      a half-empty snapshot beats none, and the trade is already saving.
//   3. Slot resolution happens HERE, from the trade's timestamp, so the
//      at-or-before rule lives in exactly one tested place (lib/snapshot.js)
//      rather than being reimplemented in the other repo.
//
// Query params (all optional):
//   at=<ISO instant>   the trade's entry time — the preferred form; the slot
//                      is resolved server-side, at or before that instant
//   date=&slot=        an explicit slot (YYYY-MM-DD + "07"|"19")
//   instrument=        the traded symbol, for the per-coin section
// With none of them, it serves the slot currently in effect.
import { NextResponse } from 'next/server';
import { isSnapshotAuthorized } from '../../../lib/auth.js';
import { getDb } from '../../../lib/firestore.js';
import { getSnapshot, resolveSlot, slotFromParts } from '../../../lib/snapshot.js';
import sources from '../../../config/sources.json';
import macroCalendar from '../../../config/macro-events.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(request) {
  if (!isSnapshotAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const at = params.get('at');
  const date = params.get('date');
  const slotParam = params.get('slot');
  const instrument = params.get('instrument');

  // A malformed parameter is a caller bug, not a data outage, so it gets a
  // real 400 — guessing (silently falling back to "now") would stamp a trade
  // with confidently wrong context, which is worse than no context at all.
  let slot;
  if (at) {
    slot = resolveSlot(at);
    if (!slot) return NextResponse.json({ error: 'invalid at (expected an ISO instant)' }, { status: 400 });
  } else if (date || slotParam) {
    slot = slotFromParts(date, slotParam);
    if (!slot) return NextResponse.json({ error: 'invalid date/slot (expected YYYY-MM-DD and 07 or 19)' }, { status: 400 });
  } else {
    slot = resolveSlot(new Date());
  }

  try {
    const snapshot = await getSnapshot(getDb(), {
      slot,
      instrument,
      assets: sources.assets,
      macroEvents: macroCalendar.events,
    });
    return NextResponse.json(snapshot);
  } catch (err) {
    // Firestore down, credentials missing, anything. Still a valid, honest
    // snapshot: the slot key is real (it came from the trade's own time), the
    // data sections are null, and Phase B's backfill can fill them in later.
    return NextResponse.json(
      {
        marketDate: slot.date,
        slot: slot.slot,
        slotAt: slot.slotAt.toISOString(),
        capturedAt: new Date().toISOString(),
        source: 'signaldesk',
        version: 1,
        instrument: instrument || null,
        fearGreed: null,
        coin: null,
        btc: null,
        topHeadline: null,
        briefingHeadline: null,
        briefingSlot: null,
        macroNext: null,
        error: String(err?.message || err),
      },
      { status: 200 }
    );
  }
}
