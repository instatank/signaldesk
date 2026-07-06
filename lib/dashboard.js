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
// delta) so dashboard and digest never disagree.
export function buildAssetRows(latest, dayAgo, assets) {
  return assets.map((asset) => {
    const symbol = asset.symbol;
    const current = latest?.derivatives?.[symbol] || null;
    const previous = dayAgo?.derivatives?.[symbol] || null;
    const price = latest?.prices?.[symbol] || null;

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
      oiChangePct,
      oiCombo: current ? interpretOiPrice(price?.change24hPct ?? null, oiChangePct) : null,
      source: current?.source ?? null,
    };
  });
}

// Dedupe by normalized title (different feeds syndicate the same story)
// and keep newest first. Input docs already carry JS Dates.
export function shapeHeadlines(headlines, cap = 60) {
  const seen = new Set();
  const out = [];
  for (const h of headlines) {
    const key = (h.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= cap) break;
  }
  return out;
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

// The single Firestore read for the whole page. db is injected so tests
// can mock it; every downstream consumer gets plain JS values.
export async function getDashboardData(db, assets, now = new Date()) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [latestSnap, oldSnap, headlinesSnap, digestSnap] = await Promise.all([
    db.collection('metrics').orderBy('ts', 'desc').limit(1).get(),
    db.collection('metrics').where('ts', '<=', cutoff).orderBy('ts', 'desc').limit(1).get(),
    db
      .collection('headlines')
      .where('ingestedAt', '>=', cutoff)
      .orderBy('ingestedAt', 'desc')
      .limit(80)
      .get(),
    db.collection('digests').orderBy('generatedAt', 'desc').limit(1).get(),
  ]);

  const latest = latestSnap.empty ? null : latestSnap.docs[0].data();
  const dayAgo = oldSnap.empty ? null : oldSnap.docs[0].data();
  const latestTs = latest?.ts?.toDate?.() || null;

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
  );

  const digestDoc = digestSnap.empty ? null : digestSnap.docs[0].data();

  return {
    latestTs,
    stale: isStale(latestTs, now),
    rows: buildAssetRows(latest, dayAgo, assets),
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
