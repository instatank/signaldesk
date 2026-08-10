// Post-generation grounding check: does every figure the model wrote
// actually trace back to a number we gave it?
//
// The briefing's value is subjective synthesis, which is exactly what
// can't be validated automatically. What CAN be validated is the hard
// part underneath it — a fabricated "$40m" or "down 12%" is both the most
// damaging kind of error and the most mechanically catchable one. So we
// catch those and leave the judgement to the reader.
//
// Deliberately conservative: it only inspects figures that look like
// market claims (percentages and dollar amounts), matches them loosely
// against everything in the input, and skips learn_today, where
// illustrative numbers are legitimate. Flagging is advisory — it annotates
// the digest, it never blocks or edits it.

const PCT_RE = /(-?\d+(?:\.\d+)?)\s*%/g;
const USD_RE = /\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|bn|b|tn|t)?\b/gi;
const MULT = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, t: 1e12, tn: 1e12 };

function pcts(text) {
  return [...String(text || '').matchAll(PCT_RE)].map((m) => ({
    raw: m[0].trim(),
    value: Math.abs(Number(m[1])),
  }));
}

function usds(text) {
  return [...String(text || '').matchAll(USD_RE)].map((m) => {
    const mult = MULT[String(m[2] || '').toLowerCase()] || 1;
    return { raw: m[0].trim(), value: Number(m[1].replace(/,/g, '')) * mult };
  });
}

// Every percentage and dollar figure the model was actually shown.
function allowedFigures(inputs) {
  const pct = [];
  const usd = [];
  const push = (arr, v) => {
    if (v != null && Number.isFinite(Number(v))) arr.push(Math.abs(Number(v)));
  };

  for (const p of Object.values(inputs?.prices || {})) {
    push(usd, p?.usd);
    push(pct, p?.change24hPct);
  }
  for (const d of Object.values(inputs?.derivatives || {})) {
    if (!d) continue;
    push(pct, d.fundingRate == null ? null : d.fundingRate * 100);
    push(pct, d.oiChange24hPct);
  }
  push(pct, inputs?.fearGreed?.value);
  for (const v of inputs?.fearGreed?.last7Days || []) push(pct, v);

  // Figures quoted inside a headline are fair game — that's where a story's
  // "$40m exploit" legitimately comes from.
  for (const h of inputs?.headlines || []) {
    for (const f of pcts(h?.title)) pct.push(f.value);
    for (const f of usds(h?.title)) usd.push(f.value);
  }
  return { pct, usd };
}

// Percentages: absolute tolerance, since the model rounds (0.061% -> 0.06%).
// Dollars: relative, since it compacts ($109,432 -> $109k).
const near = (a, b, absTol, relTol) => Math.abs(a - b) <= Math.max(absTol, Math.abs(b) * relTol);

// The prose fields worth checking. learn_today is excluded on purpose:
// it teaches a concept and may use an illustrative number.
function proseFields(digest) {
  const n = digest?.narrative || {};
  const out = [
    digest?.market_pulse,
    n.headline,
    n.synthesis,
    n.market_reaction,
    n.tension,
    n.conviction_basis,
    ...(digest?.watch_next || []),
  ];
  for (const s of digest?.top_stories || []) {
    out.push(s?.summary, s?.why_it_matters);
  }
  return out.filter(Boolean);
}

// Returns { checked, unverified: [...raw figures] }. An empty unverified
// list means every figure in the briefing traces back to the input.
export function verifyFigures(digest, inputs) {
  if (!digest) return { checked: 0, unverified: [] };
  const allowed = allowedFigures(inputs);
  const unverified = [];
  let checked = 0;

  for (const text of proseFields(digest)) {
    for (const f of pcts(text)) {
      checked += 1;
      if (!allowed.pct.some((a) => near(f.value, a, 0.15, 0.05))) unverified.push(f.raw);
    }
    for (const f of usds(text)) {
      checked += 1;
      if (!allowed.usd.some((a) => near(f.value, a, 0, 0.05))) unverified.push(f.raw);
    }
  }
  // De-dupe: the same invented figure repeated is one problem, not three.
  return { checked, unverified: [...new Set(unverified)] };
}
