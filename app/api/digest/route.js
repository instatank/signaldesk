// Runs at 07:00 and 19:00 IST via Vercel Cron. Assembles the last 24h of
// stored data (weighted toward the last 12h), asks Claude for the
// structured briefing, stores it, and pushes it to Telegram. If the
// Claude call fails (after one retry), a raw-data fallback message is
// sent instead — degraded, never broken.
import { NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth.js';
import { getDb } from '../../../lib/firestore.js';
import { generateDigest, MODEL } from '../../../lib/claude.js';
import { sendTelegramMessage } from '../../../lib/telegram.js';
import {
  assembleDigestInputs,
  attachStoryLinks,
  buildProvenance,
  formatDigestMessage,
  buildRawFallbackMessage,
  istDateString,
  istSlotId,
} from '../../../lib/digest.js';
import sources from '../../../config/sources.json';
import macroCalendar from '../../../config/macro-events.json';
import { verifyFigures } from '../../../lib/verify.js';
import { withCors } from '../../../lib/cors.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return withCors(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
  }

  const now = new Date();
  const db = getDb();
  const inputs = await assembleDigestInputs(db, sources.assets, macroCalendar.events);

  // AI is an optional layer: one retry, then fall back to raw data.
  let digest = null;
  let aiError = null;
  for (let attempt = 0; attempt < 2 && !digest; attempt += 1) {
    try {
      digest = attachStoryLinks(await generateDigest(inputs), inputs);
      // Advisory only — annotates the briefing, never blocks it.
      digest.check = verifyFigures(digest, inputs);
      // Cutoff + evidence base, stored with the digest so the archive shows
      // the same provenance the reader saw on the day.
      digest.meta = buildProvenance(inputs, now);
    } catch (err) {
      aiError = String(err.message || err);
    }
  }

  const degraded = !digest;
  const message = degraded
    ? buildRawFallbackMessage(inputs, now)
    : formatDigestMessage(digest, now, inputs);

  // Telegram failure shouldn't lose the digest — it's stored either way.
  let telegram = 'sent';
  try {
    await sendTelegramMessage(message);
  } catch (err) {
    telegram = `failed: ${String(err.message || err)}`;
  }

  await db.collection('digests').doc(istSlotId(now)).set({
    generatedAt: now,
    model: degraded ? null : MODEL,
    degraded,
    aiError: degraded ? aiError : null,
    telegram,
    digest: digest || null,
    message,
    inputsSummary: {
      headlineCount: inputs.headlines.length,
      hasDerivatives: Object.values(inputs.derivatives || {}).some(Boolean),
      hasFearGreed: Boolean(inputs.fearGreed),
      hasPrices: Boolean(inputs.prices),
    },
  });

  return withCors(NextResponse.json({
    ok: true,
    date: istDateString(now),
    degraded,
    aiError: degraded ? aiError : null,
    telegram,
  }));
}
