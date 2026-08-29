// Dashboard data shaping. Pure functions (testable offline) plus one
// Firestore reader. The dashboard is a read-only presentation layer over
// the same data + interpretation tables the Telegram digest uses — one
// source of truth, never a second opinion.
import {
  interpretFunding,
  interpretOiPrice,
  interpretFearGreed,
  formatFundingPct,
} from './interpret.js';

const IST_TIME_ZONE = 'Asia/Kolkata';

export function istDisplayDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function istTimeString(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function relativeTime(date, now = new Date()) {
  if (!date) return '';
  const mins = Math.max(0, Math.round((now - date) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Latest metrics snapshot older than 45 min means the ingest cron is
// misbehaving — surface that instead of quietly showing stale numbers.
export function isStale(latestTs, now = new Date()) {
  if (!latestTs) return true;
  return now - latestTs > 45 * 60 * 1000;
}

// Funding band drives the diverging bar's color. Red = crowded longs
// (danger for a long-biased beginner), green = crowded shorts (squeeze
// fuel), amber = mild crowding either way, gray = nothing to see.
export function fundingBand(fundingRate) {
  const pct = fundingRate * 100;
  if (pct > 0.05) return 'red';
  if (pct >= 0.01) return 'amber';
  if (pct > -0.01) return 'gray';
  if (pct >= -0.05) return 'amber';
  return 'green';
}

// Bar length as a percentage of the half-width, clamped at ±0.1% funding
// so one extreme print doesn't flatten every other bar's resolution.
export function fundingBarPct(fundingRate) {
  const pct = fundingRate * 100;
  const clamped = Math.max(-0.1, Math.min(0.1, pct));
  return Math.round((Math.abs(clamped) / 0.1) * 100);
}

export function fngTone(value) {
  if (value < 25) return 'red';
  if (value < 45) return 'amber';
  if (value <= 60) return 'gray';
  if (value <= 75) return 'lime';
  return 'green';
}

// SVG polyline points for a sparkline. values are oldest → newest,
// left → right. Returns '' when there's nothing worth drawing.
export function sparklinePoints(values, width = 240, height = 48, pad = 3) {
  const nums = (values || []).filter((v) => Number.isFinite(v));
  if (nums.length < 2) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = (width - pad * 2) / (nums.length - 1);
  return nums
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// One display row per asset: price + change + funding read + OI combo.
// Mirrors assembleDigestInputs()' derivatives logic (same-source-only OI
// delta) so dashboard and digest never disagree. fundingHistory (from
// advanced/latest) adds the 7-day sparkline values when available.
export function buildAssetRows(latest, dayAgo, assets, fundingHistory = null) {
  return assets.map((asset) => {
    const symbol = asset.symbol;
    const current = latest?.derivatives?.[symbol] || null;
    const previous = dayAgo?.derivatives?.[symbol] || null;
    const price = latest?.prices?.[symbol] || null;
    // Funding history as percent values, oldest → newest, for sparklines.
    const fundingSpark = (fundingHistory?.[symbol]?.history || [])
      .map((h) => Number(h.rate) * 100)
      .filter(Number.isFinite);

    let oiChangePct = null;
    if (current && previous && current.source === previous.source && previous.openInterest > 0) {
      oiChangePct = ((current.openInterest - previous.openInterest) / previous.openInterest) * 100;
    }

    const funding = current ? interpretFunding(current.fundingRate) : null;
    return {
      symbol,
      price: price?.usd ?? null,
      change24hPct: price?.change24hPct ?? null,
      fundingRate: current?.fundingRate ?? null,
      fundingRatePct: current ? formatFundingPct(current.fundingRate) : null,
      fundingLabel: funding?.label ?? null,
      fundingEmoji: funding?.emoji ?? null,
      fundingExplanation: funding?.explanation ?? null,
      band: current ? fundingBand(current.fundingRate) : null,
      barPct: current ? fundingBarPct(current.fundingRate) : 0,
      fundingSpark,
      oiChangePct,
      oiCombo: current ? interpretOiPrice(price?.change24hPct ?? null, oiChangePct) : null,
      source: current?.source ?? null,
    };
  });
}

// Aggregate crowding read for the positioning snapshot: how many coins
// have longs vs shorts paying, and which coin is most crowded (largest
// |funding| outside the gray band). Counting only — per-coin
// interpretation stays in interpret.js.
export function positioningSummary(rows) {
  const live = (rows || []).filter((r) => r.fundingRate != null);
  const longsPaying = live.filter((r) => r.fundingRate > 0).length;
  const shortsPaying = live.filter((r) => r.fundingRate < 0).length;
  const hot = live.filter((r) => r.band && r.band !== 'gray');
  const mostCrowded = hot.length
    ? hot.reduce((a, b) => (Math.abs(b.fundingRate) > Math.abs(a.fundingRate) ? b : a))
    : null;
  return { total: live.length, longsPaying, shortsPaying, mostCrowded };
}

// THE title-identity function: when do two headlines count as one story?
// URL-hash dedupe (lib/rss.js) catches the same article republished; this
// catches the same story carried by different outlets or relayed with a
// different link. ONE implementation, used by both the dashboard and the
// digest — two of these quietly diverging is exactly how you end up with a
// news card and a briefing that disagree about what happened today.
export function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Dedupe by normalized title (different feeds syndicate the same story)
// and keep newest first. Input docs already carry JS Dates.
export function shapeHeadlines(headlines, cap = 60) {
  const seen = new Set();
  const out = [];
  for (const h of headlines) {
    const key = titleKey(h.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= cap) break;
  }
  return out;
}

// --- News visualization: turn a wall of headlines into shape ---------
// The news is text; its *distribution* is a picture. We classify every
// headline by coin + theme (keyword match, deliberately dumb — this is
// counting, not sentiment; the honesty rules forbid fake sentiment).

const COIN_ALIASES = {
  BTC: ['btc', 'bitcoin'],
  ETH: ['eth', 'ethereum', 'ether'],
  SOL: ['sol', 'solana'],
  ZEC: ['zec', 'zcash'],
  HYPE: ['hype', 'hyperliquid'],
  VVV: ['vvv', 'venice'],
};

export const NEWS_TOPICS = [
  { key: 'security', label: 'Hacks & security', words: ['hack', 'hacked', 'exploit', 'breach', 'stolen', 'drained', 'scam', 'phishing', 'vulnerability'] },
  { key: 'regulation', label: 'Regulation & law', words: ['sec', 'cftc', 'regulator', 'regulation', 'lawsuit', 'court', 'judge', 'ban', 'bill', 'senate', 'congress', 'legal', 'fine', 'settlement', 'license'] },
  { key: 'etf', label: 'ETFs & flows', words: ['etf', 'etp', 'inflow', 'outflow', 'blackrock', 'fidelity', 'grayscale', 'treasury company', 'accumulation'] },
  { key: 'macro', label: 'Macro & Fed', words: ['fed', 'fomc', 'rate cut', 'rate hike', 'inflation', 'cpi', 'jobs report', 'tariff', 'recession', 'dollar', 'yields'] },
  { key: 'stablecoins', label: 'Stablecoins', words: ['stablecoin', 'usdt', 'usdc', 'tether', 'circle'] },
  { key: 'defi', label: 'DeFi & protocols', words: ['defi', 'protocol', 'staking', 'yield', 'liquidity', 'dex', 'lending', 'tvl'] },
];

function matchesAny(lower, words) {
  return words.some((w) =>
    new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower)
  );
}

// → { coins: ['BTC'], topics: ['etf'] } for one headline title.
export function classifyHeadline(title, assets) {
  const lower = (title || '').toLowerCase();
  const coins = assets
    .map((a) => a.symbol)
    .filter((sym) => matchesAny(lower, COIN_ALIASES[sym] || [sym.toLowerCase()]));
  const topics = NEWS_TOPICS.filter((t) => matchesAny(lower, t.words)).map((t) => t.key);
  return { coins, topics };
}

// What is the market talking about, and is each narrative rising?
// Counts per coin/theme over 24h, split into recent (<6h) vs older.
// Returns top entries sorted by count, with maxCount for bar scaling.
export function topicBreakdown(headlines, assets, now = new Date(), top = 7) {
  const recentCutoff = now.getTime() - 6 * 60 * 60 * 1000;
  const counts = new Map();
  const bump = (key, label, kind, isRecent) => {
    const e = counts.get(key) || { key, label, kind, count: 0, recentCount: 0 };
    e.count += 1;
    if (isRecent) e.recentCount += 1;
    counts.set(key, e);
  };
  const topicLabels = Object.fromEntries(NEWS_TOPICS.map((t) => [t.key, t.label]));
  for (const h of headlines) {
    const when = h.publishedAt || h.ingestedAt;
    const isRecent = when ? when.getTime() >= recentCutoff : false;
    for (const c of h.coins || []) bump(c, c, 'coin', isRecent);
    for (const t of h.topics || []) bump(t, topicLabels[t], 'topic', isRecent);
  }
  const entries = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, top);
  const maxCount = entries.length ? entries[0].count : 0;
  // "Rising" = most of this narrative's 24h coverage landed in the last 6h.
  for (const e of entries) e.rising = e.count >= 3 && e.recentCount / e.count >= 0.5;
  return { entries, maxCount };
}

// Headline count per hour, oldest → newest (24 buckets), for the
// news-flow histogram. Quiet vs erupting, visible at a glance.
export function hourlyNewsVolume(headlines, now = new Date()) {
  const buckets = new Array(24).fill(0);
  const start = now.getTime() - 24 * 60 * 60 * 1000;
  for (const h of headlines) {
    const when = h.publishedAt || h.ingestedAt;
    if (!when) continue;
    const idx = Math.floor((when.getTime() - start) / (60 * 60 * 1000));
    if (idx >= 0 && idx < 24) buckets[idx] += 1;
  }
  return buckets;
}

export function shapeFearGreed(fng) {
  if (!fng || !Number.isFinite(fng.value)) return null;
  // history is stored newest-first; sparkline wants oldest → newest.
  const history = (fng.history || [])
    .map((d) => Number(d.value))
    .filter(Number.isFinite)
    .reverse();
  return {
    value: fng.value,
    classification: fng.classification,
    tone: fngTone(fng.value),
    guidance: interpretFearGreed(fng.value),
    history,
  };
}

// Past digests, newest first, for the archive page. Doc ids are IST
// slots ("2026-07-03-07"); the hour suffix labels morning vs evening
// (legacy per-day docs have no suffix and count as morning). Since
// 2026-08-29 the digest runs once daily at 07:00 IST, so new entries are
// always "morning" — the evening label is kept for the archived twice-daily
// runs (and for any manual afternoon re-run).
export async function getDigestArchive(db, limit = 30) {
  const snap = await db.collection('digests').orderBy('generatedAt', 'desc').limit(limit).get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    const hour = Number(doc.id.split('-')[3]);
    return {
      id: doc.id,
      slot: Number.isFinite(hour) && hour >= 12 ? 'evening' : 'morning',
      generatedAt: d.generatedAt?.toDate?.() || null,
      degraded: Boolean(d.degraded),
      digest: d.digest || null,
    };
  });
}

// The single Firestore read for the whole page. db is injected so tests
// can mock it; every downstream consumer gets plain JS values.
export async function getDashboardData(db, assets, now = new Date()) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [latestSnap, oldSnap, headlinesSnap, digestSnap, advancedSnap] = await Promise.all([
    db.collection('metrics').orderBy('ts', 'desc').limit(1).get(),
    db.collection('metrics').where('ts', '<=', cutoff).orderBy('ts', 'desc').limit(1).get(),
    db
      .collection('headlines')
      .where('ingestedAt', '>=', cutoff)
      .orderBy('ingestedAt', 'desc')
      .limit(80)
      .get(),
    db.collection('digests').orderBy('generatedAt', 'desc').limit(1).get(),
    db.collection('advanced').doc('latest').get(),
  ]);

  const latest = latestSnap.empty ? null : latestSnap.docs[0].data();
  const dayAgo = oldSnap.empty ? null : oldSnap.docs[0].data();
  const latestTs = latest?.ts?.toDate?.() || null;
  const fundingHistory = advancedSnap.exists
    ? advancedSnap.data()?.fundingHistory?.data || null
    : null;

  const headlines = shapeHeadlines(
    headlinesSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        title: d.title,
        source: d.source,
        url: d.url,
        publishedAt: d.publishedAt?.toDate?.() || null,
        ingestedAt: d.ingestedAt?.toDate?.() || null,
      };
    })
  ).map((h) => ({ ...h, ...classifyHeadline(h.title, assets) }));

  const digestDoc = digestSnap.empty ? null : digestSnap.docs[0].data();

  return {
    latestTs,
    stale: isStale(latestTs, now),
    rows: buildAssetRows(latest, dayAgo, assets, fundingHistory),
    fearGreed: shapeFearGreed(latest?.fng || null),
    prices: latest?.prices || null,
    headlines,
    briefing: digestDoc
      ? {
          generatedAt: digestDoc.generatedAt?.toDate?.() || null,
          degraded: Boolean(digestDoc.degraded),
          digest: digestDoc.digest || null,
        }
      : null,
  };
}
