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

export function istTimeString(date = new Date()) {
  // HH:MM in IST — the briefing's data cutoff, shown to the reader.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

// Weekday (0=Sun) and hour in IST, for cadence decisions that must not
// drift with the server's timezone.
function istWeekdayHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return { weekday, hour: Number.isFinite(hour) ? hour : 0 };
}

// The "common beginner trap" is deliberately occasional — a callout that
// appears in every briefing stops being read. Twice a week, on the morning
// run only, and never on a flash (a flash is a market reaction, not a
// lesson). Decided here rather than asked of the model: cadence is
// arithmetic, and a model asked "is it time?" answers inconsistently.
export function shouldIncludeTrap(date = new Date(), mode = 'scheduled') {
  if (mode === 'flash') return false;
  const { weekday, hour } = istWeekdayHour(date);
  return (weekday === 'Mon' || weekday === 'Thu') && hour < 12;
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
      // Not sent to Claude (see toPromptPayload in lib/claude.js) — kept
      // here so a story's headline_index can be resolved back to a link.
      url: d.url || null,
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

  // How much evidence actually exists this window, counted rather than
  // left to the model's impression of it. The prompt keys "high
  // conviction" and the thin-day escape hatch off these numbers, so a
  // sparse window can't be written up as though it were a busy one.
  const recentCount = headlines.filter((h) => h.recent).length;
  const distinctSources = new Set(headlines.map((h) => h.source).filter(Boolean)).size;
  const dataQuality = {
    headlineCount: headlines.length,
    recentHeadlineCount: recentCount,
    distinctSources,
    windowHours,
    recentWindowHours: recentHours,
    hasPrices: Boolean(latest?.prices),
    hasDerivatives: Object.values(derivatives).some(Boolean),
    hasFearGreed: Boolean(fng),
    // Deliberately generous: better to under-claim on a middling day than
    // to let a handful of syndicated headlines read as a trend.
    thin: recentCount < 8 || distinctSources < 3,
  };

  return {
    generatedAt: now.toISOString(),
    mode,
    dataQuality,
    // Cadence for the occasional teaching extras. The model is told to
    // emit beginner_trap only when this is true.
    teaching: { includeTrap: shouldIncludeTrap(now, mode) },
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

// --- Provenance -----------------------------------------------------------
// "Data as of 07:02 IST · last 24h · 42 headlines from 6 sources · funding/OI
// via Binance". Every briefing states its own cutoff and evidence base, so a
// confident read on thin data is visibly a confident read on thin data.
//
// Counted from what was actually assembled, never asked of the model: a
// self-reported confidence is exactly the thing that cannot be trusted. If a
// stream failed upstream it shows up here as missing, not as silence.
export function buildProvenance(inputs, date = new Date()) {
  if (!inputs) return null;
  const dq = inputs.dataQuality || {};
  const derivatives = Object.values(inputs.derivatives || {}).filter(Boolean);
  const asOf = inputs.generatedAt ? new Date(inputs.generatedAt) : date;

  const headlineCount = dq.headlineCount ?? (inputs.headlines || []).length;
  const missing = [];
  if (!inputs.prices || !Object.keys(inputs.prices).length) missing.push('prices');
  if (!derivatives.length) missing.push('funding/OI');
  if (!inputs.fearGreed) missing.push('Fear & Greed');
  if (!headlineCount) missing.push('news');

  return {
    asOf: asOf.toISOString(),
    asOfIst: istTimeString(asOf),
    windowHours: dq.windowHours ?? 24,
    recentWindowHours: dq.recentWindowHours ?? inputs.recentWindowHours ?? null,
    headlineCount,
    recentHeadlineCount: dq.recentHeadlineCount ?? null,
    sourceCount: dq.distinctSources ?? null,
    // Which exchange the funding/OI actually came from — the Binance→OKX
    // failover means this is not a constant, and the two measure different
    // pools (see lib/derivatives.js).
    derivativeSources: [...new Set(derivatives.map((d) => d.source).filter(Boolean))],
    missing,
    thin: Boolean(dq.thin),
    mode: inputs.mode || 'scheduled',
  };
}

// One line, used verbatim by Telegram and the dashboard so the stated
// cutoff can never differ between them.
export function provenanceText(meta) {
  if (!meta) return null;
  const bits = [`Data as of ${meta.asOfIst} IST`, `last ${meta.windowHours}h`];
  if (meta.headlineCount) {
    const sources = meta.sourceCount ? ` from ${meta.sourceCount} source${meta.sourceCount === 1 ? '' : 's'}` : '';
    bits.push(`${meta.headlineCount} headlines${sources}`);
  }
  if (meta.derivativeSources?.length) bits.push(`funding/OI via ${meta.derivativeSources.join(' + ')}`);
  if (meta.missing?.length) bits.push(`no ${meta.missing.join(', ')} data`);
  if (meta.thin) bits.push('thin flow — read the conviction note');
  return bits.join(' · ');
}

// Resolve each story's headline_index back to the source article URL and
// stamp it on the story, so the dashboard can link out. Done here rather
// than asking Claude for URLs: the model only ever sees an index, so it
// cannot invent a link. An index that is missing, out of range, or points
// at a headline with no URL simply yields no link — never a wrong one.
// Returns a new digest; the original is not mutated.
export function attachStoryLinks(digest, inputs) {
  if (!digest?.top_stories?.length) return digest;
  const headlines = inputs?.headlines || [];
  return {
    ...digest,
    top_stories: digest.top_stories.map((story) => {
      const i = story.headline_index;
      const h = Number.isInteger(i) && i >= 0 && i < headlines.length ? headlines[i] : null;
      if (!h?.url) return story;
      // A link to the wrong article is worse than none: the reader clicks
      // through, finds something unrelated, and stops trusting the whole
      // briefing. Require the story and the headline to share at least one
      // substantive word before linking them.
      if (!sharesSubstance(story.summary, h.title)) return story;
      return { ...story, url: h.url, sourceTitle: h.title };
    }),
  };
}

// Words too common to prove two texts are about the same thing.
const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'amid', 'another', 'because', 'been', 'before', 'being',
  'between', 'could', 'crypto', 'from', 'have', 'into', 'market', 'markets', 'more', 'most',
  'over', 'said', 'says', 'that', 'their', 'them', 'they', 'this', 'through', 'under', 'were',
  'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your',
]);

function substantiveWords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  );
}

export function sharesSubstance(a, b) {
  const wa = substantiveWords(a);
  if (wa.size === 0) return true; // nothing to compare — don't punish
  for (const w of substantiveWords(b)) if (wa.has(w)) return true;
  return false;
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

// learn_today used to be a plain string and became { concept, question }.
// Archived digests still carry the string, so every renderer goes through
// here rather than each one growing its own fallback.
export function normalizeLearn(learn) {
  if (!learn) return null;
  if (typeof learn === 'string') return { concept: learn, question: null };
  if (!learn.concept) return null;
  return { concept: learn.concept, question: learn.question || null };
}

const CONVICTION_CHIP = { high: '🟩 high conviction', medium: '🟨 medium conviction', low: '🟥 low conviction — thin/mixed data' };

// Tone is the model's judgement (what a story implies for the market);
// the tally over it is arithmetic, so we count here rather than asking
// Claude for numbers it would have to estimate.
export const TONE_EMOJI = { bullish: '🟢', bearish: '🔴', neutral: '⚪', mixed: '🟡' };

// How settled a story is (model judgement, per the prompt's three tiers).
// Shown on every story so a single-source claim never reads like a fact.
export const STATUS_LABEL = {
  confirmed: 'confirmed',
  reported: 'reported — not confirmed',
  developing: 'developing',
};

export function toneTally(stories = []) {
  const counts = { bullish: 0, bearish: 0, neutral: 0, mixed: 0 };
  for (const s of stories) if (s?.tone in counts) counts[s.tone] += 1;
  return counts;
}

function toneTallyText(stories) {
  const counts = toneTally(stories);
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([tone, n]) => `${TONE_EMOJI[tone]}${n}`)
    .join(' ');
}

// Render the structured digest JSON into the Telegram message (HTML mode).
// `inputs` (optional) supplies the raw numbers for the positioning grid and
// the one-line sentiment/macro rows — the parts that are arithmetic, not
// judgement. Without it those blocks are simply skipped.
export function formatDigestMessage(digest, date = new Date(), inputs = null) {
  const lines = [];
  lines.push(`<b>☀️ SignalDesk — ${escapeHtml(istDisplayDate(date))}</b>`);
  // The cutoff and evidence base, before anything interpretive is read.
  const meta = digest.meta || (inputs ? buildProvenance(inputs, date) : null);
  const prov = provenanceText(meta);
  if (prov) lines.push(`<i>${escapeHtml(prov)}</i>`);
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
    // The off-switch: what the reader should watch for that would make this
    // read wrong. Kept adjacent to the counterpoint — argument, then trigger.
    if (n.invalidation) {
      lines.push(`<b>What would change this.</b> ${escapeHtml(n.invalidation)}`);
    }
    if (n.conviction && CONVICTION_CHIP[n.conviction]) {
      lines.push(`<i>${CONVICTION_CHIP[n.conviction]}</i>`);
    }
    lines.push('');
  }

  if (digest.top_stories?.length) {
    const stories = digest.top_stories.slice(0, 5);
    const toneBits = [
      n?.news_tone && `news tone: ${n.news_tone}`,
      toneTallyText(stories) || null,
    ].filter(Boolean);
    lines.push(
      `<b>📰 What moved the tape</b>` +
        (toneBits.length ? ` <i>— ${escapeHtml(toneBits.join(' · '))}</i>` : '')
    );
    stories.forEach((story, i) => {
      const tags = [
        STATUS_LABEL[story.status],
        story.category,
        story.impact && `${story.impact} impact`,
        story.assets?.length && story.assets.slice(0, 2).join('/'),
      ]
        .filter(Boolean)
        .join(' · ');
      const dot = TONE_EMOJI[story.tone] ? `${TONE_EMOJI[story.tone]} ` : '';
      // Same link the dashboard shows, resolved server-side from
      // headline_index (attachStoryLinks) — the model never sees a URL.
      // Verifying against the original reporting is the habit worth building.
      const summary = story.url
        ? `<a href="${escapeHtml(story.url)}">${escapeHtml(story.summary)}</a>`
        : escapeHtml(story.summary);
      lines.push(
        `${i + 1}. ${dot}${summary} <i>(${escapeHtml(story.source)})</i>` +
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

  const learn = normalizeLearn(digest.learn_today);
  if (learn) {
    lines.push(`<b>🎓 One thing to learn today</b>`);
    lines.push(escapeHtml(learn.concept));
    // The question is the part that makes it stick — recall beats re-reading.
    if (learn.question) lines.push(`<b>Your turn:</b> <i>${escapeHtml(learn.question)}</i>`);
  }

  if (digest.beginner_trap) {
    lines.push('');
    lines.push(`<b>🪤 Common beginner trap</b>`);
    lines.push(escapeHtml(digest.beginner_trap));
  }

  // Grounding flag. Quiet when everything checks out; when it isn't, the
  // reader should know before he trusts a figure.
  const unverified = digest.check?.unverified || [];
  if (unverified.length) {
    const one = unverified.length === 1;
    lines.push('');
    lines.push(
      `<i>⚠️ ${unverified.length} figure${one ? '' : 's'} above (${escapeHtml(
        unverified.join(', ')
      )}) could not be matched to the source data — treat ${one ? 'it' : 'them'} as unverified.</i>`
    );
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
  const prov = provenanceText(buildProvenance(inputs, date));
  if (prov) lines.push(`<i>${escapeHtml(prov)}</i>`);
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
