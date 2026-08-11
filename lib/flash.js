// On-demand "flash" briefing: the owner clicks a button and gets a fresh,
// last-4h market-reaction read — for when a war/hack/print just hit and he
// wants to gauge how the market is responding without waiting for the
// 07:00/19:00 digest. It reuses the exact digest pipeline, only pointed at
// a tighter window (see lib/digest.js assembleDigestInputs opts).
//
// Two things keep it cheap and safe on a public URL:
//   1. A server-enforced cooldown (a Firestore transaction on flash/latest)
//      so no one — owner or stranger — can rack up Claude calls.
//   2. A LEAN ingest: only the fast streams (RSS + prices + F&G + funding/OI),
//      never the slow advanced/options/correlation fetches. Seconds, not the
//      full 2-minute cron.
import { collectHeadlines, fetchAllFeeds } from './rss.js';
import { fetchTreeNews } from './tree-news.js';
import { fetchAllDerivatives } from './derivatives.js';
import { fetchFearGreed } from './fng.js';
import { fetchPrices } from './prices.js';
import { assembleDigestInputs, attachStoryLinks } from './digest.js';
import { generateDigest, MODEL } from './claude.js';
import { verifyFigures } from './verify.js';

export const FLASH_COOLDOWN_MS = 10 * 60 * 1000; // one flash per 10 minutes
export const FLASH_WINDOW_HOURS = 12; // pull 12h for continuity...
export const FLASH_RECENT_HOURS = 4; // ...but lead hard on the last 4h
const FLASH_DOC = 'latest';

// Pure cooldown math (tested offline). referenceTs is when the last flash
// STARTED — measuring from the start, not the finish, also blocks a second
// click while the first run is still in flight.
export function flashCooldownState(referenceTs, now = new Date(), cooldownMs = FLASH_COOLDOWN_MS) {
  if (!referenceTs) return { active: false, remainingSec: 0 };
  const remaining = cooldownMs - (now.getTime() - referenceTs.getTime());
  if (remaining <= 0) return { active: false, remainingSec: 0 };
  return { active: true, remainingSec: Math.ceil(remaining / 1000) };
}

// Human "7m 20s" / "45s" from a seconds count — for the button's label.
export function formatCountdown(sec) {
  if (sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Try to claim the next flash slot atomically. Returns { acquired, remainingSec }.
// On success it stamps startedAt=now so concurrent clicks lose the race and
// the cooldown clock starts immediately.
export async function acquireFlashSlot(db, now = new Date(), cooldownMs = FLASH_COOLDOWN_MS) {
  const ref = db.collection('flash').doc(FLASH_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const reference = data?.startedAt?.toDate?.() || data?.generatedAt?.toDate?.() || null;
    const { active, remainingSec } = flashCooldownState(reference, now, cooldownMs);
    if (active) return { acquired: false, remainingSec };
    tx.set(ref, { startedAt: now }, { merge: true });
    return { acquired: true, remainingSec: 0 };
  });
}

// Fetch only the fast streams and write them to Firestore, mirroring the
// cron's dedupe/snapshot logic. Fresh data lands in the same collections the
// dashboard and the next scheduled digest read, so a flash also warms them.
export async function leanIngest(db, sources, startedAt = new Date(), follows = null) {
  const errors = [];
  const [treeResult, rssResult, derivResult, fngResult, pricesResult] = await Promise.allSettled([
    fetchTreeNews(sources.treeNews, follows, sources.feeds),
    fetchAllFeeds(sources.feeds),
    fetchAllDerivatives(sources.assets),
    fetchFearGreed(sources.fearGreedUrl),
    fetchPrices(sources.coingeckoPriceUrl, sources.assets),
  ]);

  // Tree News belongs in a flash more than anywhere else: the whole reason to
  // hit the button is that something just broke, and this is the source that
  // carries it first. Listed first so its earlier copy wins the dedupe.
  let newHeadlines = 0;
  const headlines = collectHeadlines([
    ['tree-news', treeResult],
    ['rss', rssResult],
  ]);
  errors.push(...headlines.errors);
  await Promise.all(
    headlines.items.map(async (item) => {
      try {
        await db.collection('headlines').doc(item.id).create({
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
          ingestedAt: startedAt,
          via: item.via ?? null,
        });
        newHeadlines += 1;
      } catch (err) {
        if (err.code !== 6 /* ALREADY_EXISTS = dedupe */) {
          errors.push({ stream: 'headline-write', error: String(err.message || err) });
        }
      }
    })
  );

  const derivatives = derivResult.status === 'fulfilled' ? derivResult.value.data : null;
  const fng = fngResult.status === 'fulfilled' ? fngResult.value : null;
  const prices = pricesResult.status === 'fulfilled' ? pricesResult.value : null;
  for (const [name, r] of [['derivatives', derivResult], ['fng', fngResult], ['prices', pricesResult]]) {
    if (r.status === 'rejected') errors.push({ stream: name, error: String(r.reason?.message || r.reason) });
  }

  await db.collection('metrics').add({ ts: startedAt, derivatives, fng, prices, errors });
  return { newHeadlines, errors };
}

// The full flash run, assuming the slot is already acquired. Lean-ingests,
// assembles the 4h-lead inputs, asks Claude once (flash mode), and stores the
// result to flash/latest. AI stays optional: on failure it stores a degraded
// marker — the fresh data still landed, so the dashboard reflects it either
// way. Unlike the scheduled digest this does NOT retry Claude (a flash is
// time-sensitive; a second 60s wait is worse than the raw-data fallback) and
// does NOT push to Telegram (the owner is already looking at the screen).
export async function runFlash(db, sources, macroEvents = [], startedAt = new Date(), follows = null) {
  const ingest = await leanIngest(db, sources, startedAt, follows);
  const inputs = await assembleDigestInputs(db, sources.assets, macroEvents, {
    windowHours: FLASH_WINDOW_HOURS,
    recentHours: FLASH_RECENT_HOURS,
    mode: 'flash',
  });

  let digest = null;
  let aiError = null;
  try {
    digest = attachStoryLinks(await generateDigest(inputs), inputs);
    digest.check = verifyFigures(digest, inputs);
  } catch (err) {
    aiError = String(err.message || err);
  }

  const generatedAt = new Date();
  await db.collection('flash').doc(FLASH_DOC).set(
    {
      startedAt,
      generatedAt,
      degraded: !digest,
      aiError,
      model: digest ? MODEL : null,
      windowHours: FLASH_WINDOW_HOURS,
      recentHours: FLASH_RECENT_HOURS,
      digest: digest || null,
      inputsSummary: {
        headlineCount: inputs.headlines.length,
        recentHeadlineCount: inputs.headlines.filter((h) => h.recent).length,
        newHeadlines: ingest.newHeadlines,
      },
    },
    { merge: true }
  );

  return { degraded: !digest, aiError, newHeadlines: ingest.newHeadlines };
}

// Reader for the flash page: the last flash result plus its live cooldown
// state, as plain JS values. Mirrors advanced.js's getAdvancedData shape.
export async function getFlashLatest(db, now = new Date()) {
  const snap = await db.collection('flash').doc(FLASH_DOC).get();
  if (!snap.exists) return { result: null, cooldown: flashCooldownState(null, now) };
  const d = snap.data();
  const startedAt = d.startedAt?.toDate?.() || null;
  const generatedAt = d.generatedAt?.toDate?.() || null;
  return {
    result: {
      startedAt,
      generatedAt,
      degraded: Boolean(d.degraded),
      digest: d.digest || null,
      recentHours: d.recentHours ?? FLASH_RECENT_HOURS,
      inputsSummary: d.inputsSummary || null,
    },
    cooldown: flashCooldownState(startedAt || generatedAt, now),
  };
}
