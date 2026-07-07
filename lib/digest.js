// Digest assembly + formatting. Pure functions where possible so the
// fallback path is testable without Firestore or the network.
import { escapeHtml } from './telegram.js';
import {
  interpretFunding,
  interpretOiPrice,
  interpretFearGreed,
  formatFundingPct,
} from './interpret.js';
import { upcomingMacroEvents, formatEventDates } from './macro.js';

const IST_TIME_ZONE = 'Asia/Kolkata';

export function istDateString(date = new Date()) {
  // YYYY-MM-DD in IST — used as the digest doc id (one per day).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function istSlotId(date = new Date()) {
  // One doc per run, not per day — digest can run more than once daily.
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return `${istDateString(date)}-${hour}`;
}

function istDisplayDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

// Gather the last 24h of stored data into the input object the Claude
// call (and the raw fallback) consumes. macroEvents comes from
// config/macro-events.json (the caller imports it — keeps this module
// free of JSON imports for the offline tests).
export async function assembleDigestInputs(db, assets, macroEvents = []) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  const headlinesSnap = await db
    .collection('headlines')
    .where('ingestedAt', '>=', cutoff)
    .orderBy('ingestedAt', 'desc')
    .limit(60)
    .get();
  const headlines = headlinesSnap.docs.map((doc) => {
    const d = doc.data();
    const ingestedAt = d.ingestedAt?.toDate?.() || null;
    return {
      title: d.title,
      source: d.source,
      publishedAt: d.publishedAt?.toDate?.()?.toISOString?.() || null,
      // true = last 12h (lead with these), false = 12-24h old (background only)
      recent: ingestedAt ? ingestedAt >= recentCutoff : true,
    };
  });

  const latestSnap = await db.collection('metrics').orderBy('ts', 'desc').limit(1).get();
  const latest = latestSnap.empty ? null : latestSnap.docs[0].data();

  const oldSnap = await db
    .collection('metrics')
    .where('ts', '<=', cutoff)
    .orderBy('ts', 'desc')
    .limit(1)
    .get();
  const dayAgo = oldSnap.empty ? null : oldSnap.docs[0].data();

  const derivatives = {};
  for (const asset of assets) {
    const symbol = asset.symbol;
    const current = latest?.derivatives?.[symbol] || null;
    const previous = dayAgo?.derivatives?.[symbol] || null;
    let oiChangePct = null;
    // Only compare OI across the same source — Binance and OKX measure
    // different pools, so a cross-source delta would be misleading.
    if (current && previous && current.source === previous.source && previous.openInterest > 0) {
      oiChangePct = ((current.openInterest - previous.openInterest) / previous.openInterest) * 100;
    }
    derivatives[symbol] = current
      ? {
          fundingRate: current.fundingRate,
          fundingRatePct: formatFundingPct(current.fundingRate),
          fundingLabel: interpretFunding(current.fundingRate).label,
          openInterest: current.openInterest,
          oiChange24hPct: oiChangePct,
          source: current.source,
        }
      : null;
  }

  const fng = latest?.fng
    ? {
        value: latest.fng.value,
        classification: latest.fng.classification,
        last7Days: (latest.fng.history || []).slice(0, 7).map((d) => d.value),
      }
    : null;

  return {
    generatedAt: now.toISOString(),
    headlines,
    derivatives,
    fearGreed: fng,
    prices: latest?.prices || null,
    upcomingMacroEvents: upcomingMacroEvents(macroEvents, now).map((e) => ({
      name: e.name,
      dates: formatEventDates(e),
      daysAway: e.daysAway,
    })),
  };
}

// Render the structured digest JSON into the Telegram message (HTML mode).
export function formatDigestMessage(digest, date = new Date()) {
  const lines = [];
  lines.push(`<b>☀️ SignalDesk — ${escapeHtml(istDisplayDate(date))}</b>`);
  lines.push('');
  lines.push(`<b>Market pulse</b>`);
  lines.push(escapeHtml(digest.market_pulse));
  lines.push('');
  if (digest.top_stories?.length) {
    lines.push(`<b>📰 Top stories</b>`);
    digest.top_stories.slice(0, 5).forEach((story, i) => {
      lines.push(`${i + 1}. ${escapeHtml(story.summary)} <i>(${escapeHtml(story.source)})</i>`);
      lines.push(`   ↳ ${escapeHtml(story.why_it_matters)}`);
    });
    lines.push('');
  }
  if (digest.positioning?.length) {
    lines.push(`<b>📊 Positioning check</b>`);
    for (const p of digest.positioning) {
      lines.push(`• <b>${escapeHtml(p.asset)}</b>: ${escapeHtml(p.read)}`);
    }
    lines.push('');
  }
  lines.push(`<b>🌡 Sentiment</b>`);
  lines.push(escapeHtml(digest.sentiment_note));
  lines.push('');
  lines.push(`<b>🎓 One thing to learn today</b>`);
  lines.push(escapeHtml(digest.learn_today));
  return lines.join('\n');
}

// Degraded-mode message built purely from raw stored data + the
// interpretation tables. Sent when the Claude call fails — the pipeline
// still delivers value, just without the synthesis.
export function buildRawFallbackMessage(inputs, date = new Date()) {
  const lines = [];
  lines.push(`<b>☀️ SignalDesk — ${escapeHtml(istDisplayDate(date))}</b>`);
  lines.push('<i>AI summary unavailable today — here is the raw data.</i>');
  lines.push('');

  if (inputs.prices && Object.keys(inputs.prices).length) {
    lines.push('<b>💵 Prices (24h)</b>');
    for (const [symbol, p] of Object.entries(inputs.prices)) {
      const change = p.change24hPct == null ? '' : ` (${p.change24hPct >= 0 ? '+' : ''}${p.change24hPct.toFixed(1)}%)`;
      lines.push(`• ${symbol}: $${Number(p.usd).toLocaleString('en-US')}${escapeHtml(change)}`);
    }
    lines.push('');
  }

  const derivEntries = Object.entries(inputs.derivatives || {}).filter(([, d]) => d);
  if (derivEntries.length) {
    lines.push('<b>📊 Funding / OI</b>');
    for (const [symbol, d] of derivEntries) {
      const label = interpretFunding(d.fundingRate);
      lines.push(`• ${symbol}: ${escapeHtml(d.fundingRatePct)} ${label.emoji} ${escapeHtml(label.label)}`);
      const combo = interpretOiPrice(inputs.prices?.[symbol]?.change24hPct ?? null, d.oiChange24hPct);
      if (combo) lines.push(`   ↳ ${escapeHtml(combo)}`);
    }
    lines.push('');
  }

  if (inputs.fearGreed) {
    lines.push(`<b>🌡 Fear &amp; Greed: ${inputs.fearGreed.value} (${escapeHtml(inputs.fearGreed.classification)})</b>`);
    lines.push(escapeHtml(interpretFearGreed(inputs.fearGreed.value)));
    lines.push('');
  }

  if (inputs.upcomingMacroEvents?.length) {
    lines.push('<b>📅 Macro ahead</b>');
    for (const e of inputs.upcomingMacroEvents) {
      lines.push(`• ${escapeHtml(e.name)} — ${escapeHtml(e.dates)}`);
    }
    lines.push('');
  }

  if (inputs.headlines?.length) {
    lines.push('<b>📰 Latest headlines</b>');
    for (const h of inputs.headlines.slice(0, 5)) {
      lines.push(`• ${escapeHtml(h.title)} <i>(${escapeHtml(h.source)})</i>`);
    }
  }

  return lines.join('\n');
}
