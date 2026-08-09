// Digest assembly + formatting. Pure functions where possible so the
// fallback path is testable without Firestore or the network.
import { escapeHtml } from './telegram.js';
import { interpretFunding, oiPriceTag, formatFundingPct } from './interpret.js';
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

// Gather a window of stored data into the input object the Claude call
// (and the raw fallback) consumes. macroEvents comes from
// config/macro-events.json (the caller imports it — keeps this module
// free of JSON imports for the offline tests).
//
// opts tunes the time horizon without forking the pipeline:
//   windowHours  — how far back to pull data (default 24h)
//   recentHours  — the "lead with these" cutoff for headlines (default 12h)
//   mode         — 'scheduled' (twice-daily digest) or 'flash' (on-demand,
//                  live-reaction run). Passed through to the prompt so the
//                  briefing is framed for its horizon.
// The defaults reproduce the scheduled digest exactly — the twice-daily
// cron calls this with no opts and its behavior is unchanged.
export async function assembleDigestInputs(db, assets, macroEvents = [], opts = {}) {
  const { windowHours = 24, recentHours = 12, mode = 'scheduled' } = opts;
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const recentCutoff = new Date(now.getTime() - recentHours * 60 * 60 * 1000);

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
      // true = within the recency window (lead with these), false = older
      // (background context only).
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
    mode,
    // Hours that the "recent" flag covers — the prompt reads this so it
    // knows how tight the reaction window is (12h scheduled, 4h flash).
    recentWindowHours: recentHours,
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

// --- Positioning snapshot -------------------------------------------------
// Funding/OI/price used to be written out coin-by-coin by Claude. It is
// pure arithmetic that the dashboard already renders as a grid, so the
// briefing now shows the same thing as a scannable monospace grid built
// straight from the data: emoji = funding band (color), ▲/▼ = direction,
// last column = what the price/OI combo means. No AI tokens, no drift
// between what Telegram says and what the dashboard shows.

function arrowPct(pct, digits = 1) {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const arrow = Math.abs(pct) < 0.05 ? '·' : pct > 0 ? '▲' : '▼';
  return `${arrow}${Math.abs(pct).toFixed(digits)}%`;
}

// Returns plain (unescaped) grid lines — caller escapes before embedding.
export function buildPositioningGrid(inputs) {
  const entries = Object.entries(inputs.derivatives || {}).filter(([, d]) => d);
  if (!entries.length) return [];

  const header =
    '   ' + 'COIN'.padEnd(5) + '24H'.padStart(7) + 'FUND'.padStart(9) + 'OI'.padStart(7) + '  FLOW';
  const rows = entries.map(([symbol, d]) => {
    const priceChange = inputs.prices?.[symbol]?.change24hPct ?? null;
    const { emoji } = interpretFunding(d.fundingRate);
    const funding = `${d.fundingRate >= 0 ? '+' : '-'}${Math.abs(d.fundingRate * 100).toFixed(3)}%`;
    const flow = oiPriceTag(priceChange, d.oiChange24hPct) || 'needs 24h';
    return (
      `${emoji} ` +
      symbol.padEnd(5) +
      arrowPct(priceChange).padStart(7) +
      funding.padStart(9) +
      arrowPct(d.oiChange24hPct, 0).padStart(7) +
      `  ${flow}`
    );
  });
  return [header, ...rows];
}

function pushPositioningBlock(lines, inputs) {
  const grid = buildPositioningGrid(inputs);
  if (!grid.length) return;
  lines.push('<b>📊 Positioning — funding / OI / price</b>');
  lines.push(`<pre>${escapeHtml(grid.join('\n'))}</pre>`);
  lines.push(
    '<i>🔴 crowded longs · 🟡 mild · ⚪ balanced · 🟢 crowded shorts</i>'
  );
  lines.push('');
}

const CONVICTION_CHIP = { high: '🟩 high conviction', medium: '🟨 medium conviction', low: '🟥 low conviction — thin/mixed data' };

// Render the structured digest JSON into the Telegram message (HTML mode).
// `inputs` (optional) supplies the raw numbers for the positioning grid and
// the one-line sentiment/macro rows — the parts that are arithmetic, not
// judgement. Without it those blocks are simply skipped.
export function formatDigestMessage(digest, date = new Date(), inputs = null) {
  const lines = [];
  lines.push(`<b>☀️ SignalDesk — ${escapeHtml(istDisplayDate(date))}</b>`);
  lines.push('');
  lines.push(escapeHtml(digest.market_pulse));
  lines.push('');

  const n = digest.narrative;
  if (n) {
    if (n.headline) lines.push(`<b>🧭 ${escapeHtml(n.headline)}</b>`);
    if (n.synthesis) lines.push(escapeHtml(n.synthesis));
    if (n.market_reaction) {
      lines.push('');
      lines.push(`<b>Market check.</b> ${escapeHtml(n.market_reaction)}`);
    }
    if (n.tension) lines.push(`<b>Counterpoint.</b> ${escapeHtml(n.tension)}`);
    if (n.conviction && CONVICTION_CHIP[n.conviction]) {
      lines.push(`<i>${CONVICTION_CHIP[n.conviction]}</i>`);
    }
    lines.push('');
  }

  if (digest.top_stories?.length) {
    lines.push(`<b>📰 What moved the tape</b>`);
    digest.top_stories.slice(0, 5).forEach((story, i) => {
      const tags = [story.category, story.impact && `${story.impact} impact`]
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `${i + 1}. ${escapeHtml(story.summary)} <i>(${escapeHtml(story.source)})</i>` +
          (tags ? ` <i>[${escapeHtml(tags)}]</i>` : '')
      );
      lines.push(`   ↳ ${escapeHtml(story.why_it_matters)}`);
    });
    lines.push('');
  }

  if (inputs) pushPositioningBlock(lines, inputs);

  // Sentiment is now one line, not a paragraph — the number is the point.
  const fng = inputs?.fearGreed;
  if (fng) {
    lines.push(`🌡 <b>Fear &amp; Greed ${fng.value}</b> · ${escapeHtml(fng.classification)}`);
  }
  if (inputs?.upcomingMacroEvents?.length) {
    const ev = inputs.upcomingMacroEvents
      .map((e) => `${e.name} ${e.dates}`)
      .join(' · ');
    lines.push(`📅 ${escapeHtml(ev)}`);
  }
  if (fng || inputs?.upcomingMacroEvents?.length) lines.push('');

  if (digest.watch_next?.length) {
    lines.push('<b>👀 What to watch next</b>');
    for (const w of digest.watch_next.slice(0, 3)) lines.push(`• ${escapeHtml(w)}`);
    lines.push('');
  }

  if (digest.learn_today) {
    lines.push(`<b>🎓 One thing to learn today</b>`);
    lines.push(escapeHtml(digest.learn_today));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

  pushPositioningBlock(lines, inputs);

  if (inputs.fearGreed) {
    lines.push(
      `🌡 <b>Fear &amp; Greed ${inputs.fearGreed.value}</b> · ${escapeHtml(inputs.fearGreed.classification)}`
    );
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
