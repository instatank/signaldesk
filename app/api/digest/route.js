// Runs daily at 01:30 UTC (07:00 IST) via Vercel Cron. Assembles the last
// 24h of stored data, asks Claude for the structured briefing, stores it,
// and pushes it to Telegram. If the Claude call fails (after one retry),
// a raw-data fallback message is sent instead — degraded, never broken.
import { NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth.js';
import { getDb } from '../../../lib/firestore.js';
import { generateDigest, MODEL } from '../../../lib/claude.js';
import { sendTelegramMessage } from '../../../lib/telegram.js';
import {
  assembleDigestInputs,
  formatDigestMessage,
  buildRawFallbackMessage,
  istDateString,
} from '../../../lib/digest.js';
import sources from '../../../config/sources.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const db = getDb();
  const inputs = await assembleDigestInputs(db, sources.assets);

  // AI is an optional layer: one retry, then fall back to raw data.
  let digest = null;
  let aiError = null;
  for (let attempt = 0; attempt < 2 && !digest; attempt += 1) {
    try {
      digest = await generateDigest(inputs);
    } catch (err) {
      aiError = String(err.message || err);
    }
  }

  const degraded = !digest;
  const message = degraded
    ? buildRawFallbackMessage(inputs, now)
    : formatDigestMessage(digest, now);

  await db.collection('digests').doc(istDateString(now)).set({
    generatedAt: now,
    model: degraded ? null : MODEL,
    degraded,
    aiError: degraded ? aiError : null,
    digest: digest || null,
    message,
    inputsSummary: {
      headlineCount: inputs.headlines.length,
      hasDerivatives: Object.values(inputs.derivatives || {}).some(Boolean),
      hasFearGreed: Boolean(inputs.fearGreed),
      hasPrices: Boolean(inputs.prices),
    },
  });

  // Telegram failure shouldn't lose the digest — it's already stored.
  let telegram = 'sent';
  try {
    await sendTelegramMessage(message);
  } catch (err) {
    telegram = `failed: ${String(err.message || err)}`;
  }

  return NextResponse.json({
    ok: true,
    date: istDateString(now),
    degraded,
    aiError: degraded ? aiError : null,
    telegram,
  });
}
