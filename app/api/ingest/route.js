// Runs every 15 minutes via Vercel Cron. Fetches all three data streams
// plus prices and stores them in Firestore. Every stream is independently
// fault-tolerant: a dead feed or blocked API degrades that slice of data,
// never the whole run.
import { NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth.js';
import { getDb } from '../../../lib/firestore.js';
import { fetchAllFeeds } from '../../../lib/rss.js';
import { fetchAllDerivatives } from '../../../lib/derivatives.js';
import { fetchFearGreed } from '../../../lib/fng.js';
import { fetchPrices } from '../../../lib/prices.js';
import sources from '../../../config/sources.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  const errors = [];

  // All four fetch groups run in parallel; each failure is contained.
  const [rssResult, derivResult, fngResult, pricesResult] = await Promise.allSettled([
    fetchAllFeeds(sources.feeds),
    fetchAllDerivatives(sources.assets),
    fetchFearGreed(sources.fearGreedUrl),
    fetchPrices(sources.coingeckoPriceUrl, sources.assets),
  ]);

  const db = getDb();

  // --- Headlines: dedupe by URL hash (doc id = sha256 of canonical URL).
  let newHeadlines = 0;
  let duplicateHeadlines = 0;
  if (rssResult.status === 'fulfilled') {
    errors.push(...rssResult.value.errors.map((e) => ({ stream: 'rss', ...e })));
    const writes = rssResult.value.items.map(async (item) => {
      try {
        // create() fails if the doc exists — that IS the dedupe.
        await db.collection('headlines').doc(item.id).create({
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
          ingestedAt: startedAt,
        });
        newHeadlines += 1;
      } catch (err) {
        if (err.code === 6 /* ALREADY_EXISTS */) {
          duplicateHeadlines += 1;
        } else {
          errors.push({ stream: 'rss-write', error: String(err.message || err) });
        }
      }
    });
    await Promise.all(writes);
  } else {
    errors.push({ stream: 'rss', error: String(rssResult.reason?.message || rssResult.reason) });
  }

  // --- Metrics snapshot: one doc per run with whatever streams succeeded.
  const derivatives = derivResult.status === 'fulfilled' ? derivResult.value.data : null;
  if (derivResult.status === 'fulfilled') {
    errors.push(...derivResult.value.errors.map((e) => ({ stream: 'derivatives', ...e })));
  } else {
    errors.push({ stream: 'derivatives', error: String(derivResult.reason?.message || derivResult.reason) });
  }

  const fng = fngResult.status === 'fulfilled' ? fngResult.value : null;
  if (fngResult.status === 'rejected') {
    errors.push({ stream: 'fng', error: String(fngResult.reason?.message || fngResult.reason) });
  }

  const prices = pricesResult.status === 'fulfilled' ? pricesResult.value : null;
  if (pricesResult.status === 'rejected') {
    errors.push({ stream: 'prices', error: String(pricesResult.reason?.message || pricesResult.reason) });
  }

  await db.collection('metrics').add({
    ts: startedAt,
    derivatives,
    fng,
    prices,
    errors,
  });

  return NextResponse.json({
    ok: true,
    ranAt: startedAt.toISOString(),
    headlines: { new: newHeadlines, duplicates: duplicateHeadlines },
    derivatives: derivatives
      ? Object.fromEntries(Object.entries(derivatives).map(([k, v]) => [k, v ? v.source : null]))
      : null,
    fng: fng ? fng.value : null,
    prices: prices ? Object.keys(prices) : null,
    errors,
  });
}
