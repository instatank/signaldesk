// Shared presentational atoms. All server components — the whole
// dashboard ships zero client JS; disclosure uses native <details>.
import { sparklinePoints } from '../../lib/dashboard.js';

export const TONE_TEXT = {
  red: 'text-red-400',
  amber: 'text-amber-400',
  gray: 'text-zinc-400',
  lime: 'text-lime-400',
  green: 'text-emerald-400',
};

export const TONE_BG = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  gray: 'bg-zinc-600',
  lime: 'bg-lime-500',
  green: 'bg-emerald-500',
};

// Tinted chip per tone — the crowding strip's cells. Background carries
// the band; the symbol text stays readable on it.
export const TONE_CHIP = {
  red: 'bg-red-500/15 text-red-300',
  amber: 'bg-amber-500/15 text-amber-300',
  gray: 'bg-zinc-800 text-zinc-500',
  lime: 'bg-lime-500/15 text-lime-300',
  green: 'bg-emerald-500/15 text-emerald-300',
};

// Every card is a native <details>: click the header to fold the whole
// section to one row. `stat` is the snapshot value that keeps
// communicating while folded — the page scales by adding cards, and the
// reader scales by collapsing the ones they're done with.
// `open={false}` starts a card folded: for reference material that should
// be one row until it's wanted, never for live data (which must be
// readable without a click).
export function Card({ title, stat = null, open = true, children }) {
  return (
    <details open={open} className="group/card rounded-2xl border border-zinc-800 bg-zinc-900">
      {/* The header is a tinted "tab" with a chevron chip — a clear signal
          the whole bar is clickable to fold/unfold the card. */}
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl bg-zinc-800/50 p-4 transition-colors hover:bg-zinc-800/80 group-open/card:rounded-b-none group-open/card:border-b group-open/card:border-zinc-800 sm:p-5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-300">{title}</h2>
        <span className="flex shrink-0 items-center gap-2.5">
          {stat && <span className="text-xs tabular-nums text-zinc-400">{stat}</span>}
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700/70 text-[10px] leading-none text-zinc-200 transition-transform group-open/card:rotate-180"
          >
            ▼
          </span>
        </span>
      </summary>
      <div className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">{children}</div>
    </details>
  );
}

export function Unavailable({ what }) {
  return <p className="py-6 text-center text-sm text-zinc-600">{what} unavailable right now.</p>;
}

// The second disclosure layer: an expand row inside a card body. The whole
// row is the click target with a hover tint and a chevron chip — the same
// contract as the Card header, one level quieter. (It used to be just the
// small blue label, which was an easy target to miss.)
// Named group so it never cross-triggers nested group styles.
export function Disclose({ label, closeLabel = 'Collapse', className = '', children }) {
  return (
    <details className={`group/d ${className}`}>
      <summary className={`${ROW_TAB} text-sky-400 hover:text-sky-300 [&::-webkit-details-marker]:hidden`}>
        <span>
          <span className="group-open/d:hidden">{label}</span>
          <span className="hidden group-open/d:inline">{closeLabel}</span>
        </span>
        <Chevron className="group-open/d:rotate-180" />
      </summary>
      {children}
    </details>
  );
}

// Shared look for every full-width "click anywhere on this row" control:
// the Disclose summary and the news card's show-more/less/clear labels.
// The negative margin lets the hover tint bleed to the card's padding edge
// so the highlight reads as a full row, not a floating pill.
export const ROW_TAB =
  '-mx-2 flex cursor-pointer list-none select-none items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-zinc-800/60';

export function Chevron({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] leading-none text-zinc-300 transition-transform ${className}`}
    >
      ▼
    </span>
  );
}

// A quiet one-or-two-line refresher pinned to the bottom of a card: what
// the stat is and how to read it. Advanced numbers are useless to a
// beginner without this, and it should be readable without clicking
// anything — the full version lives in the card's ⓘ and the page guide.
export function Footnote({ children }) {
  return (
    <p className="mt-3 border-t border-zinc-800/70 pt-2.5 text-[11px] leading-relaxed text-zinc-500">
      {children}
    </p>
  );
}

// Signed, colored 24h percentage chip. Green up, red down, gray flat.
export function ChangeChip({ pct }) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span className="text-xs text-zinc-600">—</span>;
  }
  const tone = pct > 0.05 ? 'text-emerald-400' : pct < -0.05 ? 'text-red-400' : 'text-zinc-400';
  return (
    <span className={`text-xs font-medium tabular-nums ${tone}`}>
      {pct >= 0 ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

// "ⓘ" that discloses a plain-language explainer — every number teaches.
export function Explainer({ label, children }) {
  return (
    <details className="group inline-block align-middle">
      <summary
        aria-label={`What is ${label}?`}
        className="inline-flex h-4 w-4 cursor-pointer list-none items-center justify-center rounded-full border border-zinc-700 text-[10px] leading-none text-zinc-500 hover:border-sky-500 hover:text-sky-400 [&::-webkit-details-marker]:hidden"
      >
        i
      </summary>
      <div className="absolute left-4 right-4 z-10 mt-2 rounded-xl border border-zinc-700 bg-zinc-800 p-3 text-left text-xs normal-case leading-relaxed tracking-normal text-zinc-300 shadow-xl sm:left-auto sm:right-auto sm:max-w-sm">
        {children}
      </div>
    </details>
  );
}

// Horizontal diverging bar centered on zero — makes leverage crowding
// visible at a glance. Direction: longs paying → bar grows right,
// shorts paying → bar grows left.
export function FundingBar({ fundingRate, band, barPct }) {
  const positive = fundingRate >= 0;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-600" />
      <div
        className={`absolute inset-y-0 ${TONE_BG[band] || 'bg-zinc-600'} ${
          positive ? 'left-1/2 rounded-r-full' : 'right-1/2 rounded-l-full'
        }`}
        style={{ width: `${Math.max(barPct, 2) / 2}%` }}
      />
    </div>
  );
}

// Inline-SVG sparkline; optionally shades the F&G extreme zones.
export function Sparkline({
  values,
  width = 240,
  height = 48,
  stroke = 'var(--color-zinc-400)',
  extremes = null,
  className = 'h-12 w-full',
  label = '30-day trend',
}) {
  const points = sparklinePoints(values, width, height);
  if (!points) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const yFor = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {extremes && max > extremes.high && (
        <rect x="0" y="0" width={width} height={Math.max(0, yFor(extremes.high))} style={{ fill: 'var(--color-emerald-500)' }} opacity="0.08" />
      )}
      {extremes && min < extremes.low && (
        <rect
          x="0"
          y={Math.min(height, yFor(extremes.low))}
          width={width}
          height={Math.max(0, height - yFor(extremes.low))}
          style={{ fill: 'var(--color-red-500)' }}
          opacity="0.08"
        />
      )}
      <polyline points={points} fill="none" style={{ stroke }} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
