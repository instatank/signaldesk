// Sort model for the screener's ALL COINS table. Pure — no React — so the
// ordering can be tested offline; the component only renders what's here.
//
// The table sorts with ZERO client JS: a hidden radio per (column, direction)
// plus a stylesheet that reads each row's precomputed CSS `order` from custom
// properties set inline on the row. Two rules per column, not one rule per
// (column, direction, row) — that shape would be 12 x 2 x 30 = 720 selectors.

// Rank orders for the categorical columns, best-first when sorted descending.
const TREND_RANK = { uptrend: 4, bounce: 3, cooling: 2, downtrend: 1 };
const VSBTC_RANK = { 'ahead of BTC': 2, 'tracks BTC': 1, 'behind BTC': 0 };
const NOTE_RANK = { 'big move': 3, crowded: 2, flushed: 1 };

const last = (a) => (Array.isArray(a) && a.length ? a[a.length - 1] : null);

// The single source for the grid track, the header cells and the sort keys, so
// the three can never drift. `primary` = the direction one click gives you (the
// reading that's actually worth seeing first); a second click reverses it.
export const SORT_COLS = [
  { id: 'size', label: '#', w: '2.2rem', primary: 'asc', get: (r) => r.sizeRank },
  { id: 'coin', label: 'coin', w: '9rem', primary: 'asc', get: (r) => r.base },
  { id: 'price', label: 'price', w: '5.5rem', right: true, primary: 'desc', get: (r) => r.price },
  { id: 'r24h', label: '24h', w: '4rem', right: true, primary: 'desc', get: (r) => r.r24h },
  { id: 'r7d', label: '1w', w: '4rem', right: true, primary: 'desc', get: (r) => r.r7d },
  { id: 'r30d', label: '1m', w: '4rem', right: true, primary: 'desc', get: (r) => r.r30d },
  { id: 'r60d', label: '2m', w: '4.4rem', right: true, primary: 'desc', get: (r) => r.r60d },
  { id: 'rel', label: 'vs mkt', w: '5rem', primary: 'desc', get: (r) => last(r.relSpark) },
  { id: 'trend', label: 'trend', w: '5.5rem', primary: 'desc', get: (r) => TREND_RANK[r.trend?.label] ?? null },
  { id: 'vsbtc', label: 'vs BTC', w: '5.5rem', primary: 'desc', get: (r) => VSBTC_RANK[r.vsBtc] ?? null },
  { id: 'cost', label: 'cost to hold', w: '5rem', primary: 'desc', get: (r) => r.detail?.annualFunding ?? null },
  { id: 'note', label: 'note', w: '4.5rem', primary: 'desc', get: (r) => NOTE_RANK[r.worthNoting] ?? null },
];

export const GRID = SORT_COLS.map((c) => c.w).join(' ');
export const DIR = { asc: 'a', desc: 'd' };
export const GLYPH = { a: '▲', d: '▼' };
export const flipDir = (d) => (d === 'a' ? 'd' : 'a');

const isMissing = (v) => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));

// Per row, the position it takes under every (column, direction) pair, as CSS
// custom properties. Missing values sort LAST in BOTH directions — a coin with
// no 60-day history shouldn't lead the ascending column. Ties keep the row's
// incoming (by-size) order.
export function buildOrderVars(rows) {
  const vars = rows.map(() => ({}));
  for (const col of SORT_COLS) {
    const all = rows.map((r, i) => ({ i, v: col.get(r) }));
    const known = all.filter((x) => !isMissing(x.v));
    const missing = all.filter((x) => isMissing(x.v));
    const desc = [...known].sort((a, b) =>
      typeof a.v === 'string' || typeof b.v === 'string'
        ? String(b.v).localeCompare(String(a.v)) || a.i - b.i
        : b.v - a.v || a.i - b.i,
    );
    const asc = [...desc].reverse();
    desc.forEach((o, pos) => { vars[o.i][`--d-${col.id}`] = String(pos); });
    asc.forEach((o, pos) => { vars[o.i][`--a-${col.id}`] = String(pos); });
    missing.forEach((o, k) => {
      vars[o.i][`--d-${col.id}`] = String(known.length + k);
      vars[o.i][`--a-${col.id}`] = String(known.length + k);
    });
  }
  return vars;
}

// Two rules per column drive the ordering; three more drive the header state:
// the active column brightens, its label swaps to the one that flips direction,
// and the arrow shows the direction currently APPLIED (not the one on offer).
export function buildSortCss() {
  // A faint arrow on hover is the only affordance that an inactive column is
  // clickable — the active column's own arrow (opacity 1) outranks it.
  let css = '.sth:hover .lp .ar{opacity:.45}';
  for (const c of SORT_COLS) {
    const pri = DIR[c.primary];
    const sec = flipDir(pri);
    css += `#sk-${c.id}-d:checked~.thead .th-${c.id},#sk-${c.id}-a:checked~.thead .th-${c.id}{color:var(--color-zinc-100)}`;
    css += `#sk-${c.id}-${pri}:checked~.thead .th-${c.id} .lp{display:none}`;
    css += `#sk-${c.id}-${pri}:checked~.thead .th-${c.id} .ls{display:block}`;
    css += `#sk-${c.id}-${sec}:checked~.thead .th-${c.id} .ar{opacity:1}`;
    css += `#sk-${c.id}-d:checked~.stbl>.srow{order:var(--d-${c.id})}`;
    css += `#sk-${c.id}-a:checked~.stbl>.srow{order:var(--a-${c.id})}`;
  }
  return css;
}
