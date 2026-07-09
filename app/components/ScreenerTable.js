// The ALL COINS table. Sortable by any numeric column with ZERO client JS:
// a hidden radio group + a generated stylesheet that sets each row's CSS
// `order` per sort key (same trick as the news filter). Wide, so it scrolls
// horizontally inside its own container on small screens.
import { TONE_TEXT } from './ui.js';
import { CoinTag, RelSpark } from './ScreenerCards.js';

// rank | coin | price | 24h | 7d | 30d | 2m | vs-market | trend | vs-btc | cost | note
const GRID = '2.2rem 9rem 5.5rem 4rem 4rem 4rem 4.4rem 5rem 5.5rem 5.5rem 5rem 4.5rem';

const SORT_KEYS = [
  { id: 'r24h', get: (r) => r.r24h },
  { id: 'r7d', get: (r) => r.r7d },
  { id: 'r30d', get: (r) => r.r30d },
  { id: 'r60d', get: (r) => r.r60d },
];

// One stylesheet: per sort key, order every row by that key (desc, nulls
// last); also light up the active column header. Default = size (DOM order).
function buildSortCss(rows) {
  let css = '#sk-size:checked~.thead .th-size,';
  css += SORT_KEYS.map((k) => `#sk-${k.id}:checked~.thead .th-${k.id}`).join(',');
  css += '{color:var(--color-zinc-200)!important}';
  css += '#sk-size:checked~.thead .th-size .ar,';
  css += SORT_KEYS.map((k) => `#sk-${k.id}:checked~.thead .th-${k.id} .ar`).join(',');
  css += '{opacity:1}';
  for (const k of SORT_KEYS) {
    const ordered = rows
      .map((r, i) => ({ i, v: k.get(r) }))
      .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
    ordered.forEach((o, pos) => {
      css += `#sk-${k.id}:checked~.stbl .row-r${o.i}{order:${pos}}`;
    });
  }
  return css;
}

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

function SortTh({ id, label }) {
  return (
    <label htmlFor={`sk-${id}`} className={`th-${id} flex cursor-pointer items-center justify-end gap-0.5 text-right text-zinc-500 hover:text-zinc-300`}>
      {label}
      <span className="ar text-[8px] opacity-0">▼</span>
    </label>
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

  const css = buildSortCss(rows);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 p-4 sm:px-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-300">All coins</h2>
        <span className="text-[11px] text-zinc-600">{rows.length} coins · click a column to sort</span>
      </div>

      {/* Radios first so the `~` selectors reach the header + table. */}
      <input type="radio" name="sk" id="sk-size" defaultChecked className="hidden" />
      {SORT_KEYS.map((k) => (
        <input key={k.id} type="radio" name="sk" id={`sk-${k.id}`} className="hidden" />
      ))}
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="overflow-x-auto p-2 sm:p-3">
        <div className="min-w-[58rem]">
          {/* header */}
          <div
            className="thead grid items-center gap-2 border-b border-zinc-800 px-2 pb-2 text-[10px] font-medium uppercase tracking-wider"
            style={{ gridTemplateColumns: GRID }}
          >
            <label htmlFor="sk-size" className="th-size flex cursor-pointer items-center gap-0.5 text-zinc-500 hover:text-zinc-300">
              # <span className="ar text-[8px] opacity-0">▼</span>
            </label>
            <span className="text-zinc-500">coin</span>
            <span className="text-right text-zinc-500">price</span>
            <SortTh id="r24h" label="24h" />
            <SortTh id="r7d" label="1w" />
            <SortTh id="r30d" label="1m" />
            <SortTh id="r60d" label="2m" />
            <span className="text-zinc-500">vs mkt</span>
            <span className="text-zinc-500">trend</span>
            <span className="text-zinc-500">vs BTC</span>
            <span className="text-zinc-500">cost to hold</span>
            <span className="text-zinc-500">note</span>
          </div>

          {/* rows (flex column so CSS `order` reflows them) */}
          <div className="stbl flex flex-col">
            {rows.map((r, i) => (
              <div
                key={r.symbol}
                className={`row-r${i} grid items-center gap-2 border-b border-zinc-800/50 px-2 py-2 text-xs ${
                  r.tracked ? 'bg-sky-500/[0.04]' : ''
                }`}
                style={{ gridTemplateColumns: GRID }}
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
