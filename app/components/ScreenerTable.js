// The ALL COINS table. EVERY column is sortable, with ZERO client JS: a hidden
// radio group (one radio per column per direction) plus a generated stylesheet
// that reads each row's precomputed `order` from CSS custom properties set
// inline on the row. Same `:checked ~` trick as the news filter.
//
// The sort model itself (columns, grid track, ordering, stylesheet) lives in
// `lib/screener-sort.js` so it can be tested offline — this file only renders.
//
// NOTE the radios must be DIRECT SIBLINGS of `.thead` / `.stbl`: `~` is the
// sibling combinator and does not reach into a wrapper. They live inside the
// min-width track for that reason.
import { TONE_TEXT } from './ui.js';
import { CoinTag, RelSpark } from './ScreenerCards.js';
import { SORT_COLS, GRID, DIR, GLYPH, flipDir, buildOrderVars, buildSortCss } from '../../lib/screener-sort.js';

function compactPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

function Pct({ v }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-zinc-600">—</span>;
  const tone = v > 0.05 ? TONE_TEXT.green : v < -0.05 ? TONE_TEXT.red : 'text-zinc-400';
  return (
    <span className={`tabular-nums ${tone}`}>
      {v >= 0 ? '+' : ''}
      {v.toFixed(1)}%
    </span>
  );
}

// One header cell = two stacked labels, exactly one displayed at a time. `.lp`
// (visible by default) points at the primary radio; once that's checked the CSS
// swaps in `.ls`, which points at the opposite direction — so a click on the
// same header reverses the sort with no JS.
function SortTh({ col }) {
  const pri = DIR[col.primary];
  const sec = flipDir(pri);
  const align = col.right ? 'text-right' : '';
  return (
    <span className={`sth th-${col.id} ${align} text-zinc-500 transition-colors hover:text-zinc-300`}>
      <label htmlFor={`sk-${col.id}-${sec}`} className="ls hidden cursor-pointer">
        {col.label} <span className="ar text-[8px]">{GLYPH[pri]}</span>
      </label>
      <label htmlFor={`sk-${col.id}-${pri}`} className="lp block cursor-pointer">
        {col.label} <span className="ar text-[8px] opacity-0">{GLYPH[sec]}</span>
      </label>
    </span>
  );
}

export default function ScreenerTable({ rows, generatedAt, livePricesAt }) {
  if (!rows || rows.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-sm text-zinc-400">
          No screener data yet — it builds on the next daily run (00:45 UTC), prices refresh every 15
          min after that.
        </p>
      </section>
    );
  }

  const css = buildSortCss();
  const orderVars = buildOrderVars(rows);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 p-4 sm:px-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-300">All coins</h2>
        <span className="text-[11px] text-zinc-600">
          {rows.length} coins · click a column to sort, click it again to reverse
        </span>
      </div>

      <div className="overflow-x-auto p-2 sm:p-3">
        <div className="min-w-[58rem]">
          {/* Radios first, and at THIS level, so `~` reaches .thead and .stbl. */}
          {SORT_COLS.flatMap((c) =>
            ['d', 'a'].map((d) => (
              <input
                key={`${c.id}-${d}`}
                type="radio"
                name="sk"
                id={`sk-${c.id}-${d}`}
                defaultChecked={c.id === 'size' && d === 'a'}
                className="hidden"
              />
            )),
          )}
          <style dangerouslySetInnerHTML={{ __html: css }} />

          {/* header */}
          <div
            className="thead grid items-center gap-2 border-b border-zinc-800 px-2 pb-2 text-[10px] font-medium uppercase tracking-wider"
            style={{ gridTemplateColumns: GRID }}
          >
            {SORT_COLS.map((c) => (
              <SortTh key={c.id} col={c} />
            ))}
          </div>

          {/* rows (flex column so CSS `order` reflows them) */}
          <div className="stbl flex flex-col">
            {rows.map((r, i) => (
              <div
                key={r.symbol}
                className={`srow grid items-center gap-2 border-b border-zinc-800/50 px-2 py-2 text-xs ${
                  r.tracked ? 'bg-sky-500/[0.04]' : ''
                }`}
                style={{ gridTemplateColumns: GRID, ...orderVars[i] }}
              >
                <span className="tabular-nums text-zinc-600">{r.sizeRank ?? '—'}</span>
                <CoinTag base={r.base} name={r.name} tracked={r.tracked} />
                <span className="text-right tabular-nums text-zinc-300">
                  {compactPrice(r.price)}
                  {r.live && <span className="ml-1 inline-block h-1 w-1 rounded-full bg-emerald-400 align-middle" title="live" />}
                </span>
                <span className="text-right"><Pct v={r.r24h} /></span>
                <span className="text-right"><Pct v={r.r7d} /></span>
                <span className="text-right"><Pct v={r.r30d} /></span>
                <span className="text-right"><Pct v={r.r60d} /></span>
                <RelSpark values={r.relSpark} className="h-5 w-16" />
                <span className={`${TONE_TEXT[r.trend?.tone] || 'text-zinc-500'}`}>{r.trend?.label || '—'}</span>
                <span className="text-zinc-500">{r.vsBtc || '—'}</span>
                <span className={`${TONE_TEXT[r.cost?.tone] || 'text-zinc-500'}`}>{r.cost?.label || '—'}</span>
                <span>
                  {r.worthNoting ? (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                      {r.worthNoting}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="px-4 pb-3 text-[10px] text-zinc-700 sm:px-5">
        Measured daily from Binance futures. Prices refresh every ~15 min
        {livePricesAt ? '' : ' (pending first refresh)'}.
      </p>
    </section>
  );
}
