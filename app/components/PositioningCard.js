// Funding + OI, snapshot-first — now interactive, still zero client JS.
//
// Two native mechanisms, no dedicated arrow line:
//   • The crowding strip is a coin SELECTOR — each pill is a <label> tied
//     to a hidden radio (name="pf"). Click a pill and the detail bar below
//     swaps to that coin (default = most crowded). Same idea as the news
//     narrative-pulse filter: a generated `:checked ~` stylesheet does it.
//   • The snapshot bar itself is the expand target: it's the <summary> of a
//     native <details>, so clicking anywhere on it opens/closes the full
//     per-coin table (price + bar + OI). No "show more ↓" row.
// The card header (in <Card>) still folds the whole card — three layers,
// each with its own obvious click target.
import { positioningSummary } from '../../lib/dashboard.js';
import {
  Card,
  ChangeChip,
  Explainer,
  FundingBar,
  TONE_CHIP,
  TONE_TEXT,
  Unavailable,
} from './ui.js';

const FUNDING_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Funding rate — who&rsquo;s paying to hold?</p>
    <p>
      Every 8 hours, perp traders on the crowded side pay the other side. Positive = longs paying
      (crowded long), negative = shorts paying (crowded short). Extremes are contrarian: crowded
      trades unwind violently. The bar grows right when longs pay, left when shorts pay. Cell
      colors: red = crowded long, green = crowded short, amber = mild, gray = balanced. Tap a coin
      to see its bar.
    </p>
  </>
);

const OI_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Open interest — is money entering or leaving?</p>
    <p>
      OI is the number of open contracts. Read it with price: rising price + rising OI = new longs
      (conviction); rising price + falling OI = shorts covering (weaker fuel); falling price +
      rising OI = new shorts; falling price + falling OI = longs bailing.
    </p>
  </>
);

// One cell of the crowding strip, now a <label> that selects its coin.
function Pill({ r, hot }) {
  return (
    <label
      htmlFor={`pf-${r.symbol}`}
      title={`${r.symbol} ${r.fundingRatePct} — ${r.fundingLabel}${hot ? ' · most crowded' : ''}`}
      className={`pcpill flex-1 cursor-pointer rounded-md px-1 py-1.5 text-center text-[11px] font-semibold transition hover:brightness-110 ${TONE_CHIP[r.band] || TONE_CHIP.gray}`}
    >
      {r.symbol}
      {hot && <span className="ml-0.5 align-top text-[8px] opacity-70">●</span>}
    </label>
  );
}

// The snapshot detail for one coin — the selected coin's crowding read.
// Rendered once per coin; CSS shows only the selected one. Lives inside
// the <summary>, so it must contain no interactive controls of its own.
function SnapshotBar({ r }) {
  return (
    <div className={`pcbar pcbar-${r.symbol}`}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          <span className="font-semibold text-zinc-200">{r.symbol}</span>
          {r.price != null && (
            <span className="ml-1.5 tabular-nums text-zinc-400">
              ${Number(r.price).toLocaleString('en-US')}
            </span>
          )}
        </span>
        <span className={`font-medium ${TONE_TEXT[r.band] || 'text-zinc-400'}`}>
          {r.fundingEmoji} {r.fundingLabel}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <FundingBar fundingRate={r.fundingRate} band={r.band} barPct={r.barPct} />
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-400">
          {r.fundingRatePct}
        </span>
      </div>
      <div className="mt-1.5 text-xs text-zinc-500">
        {r.oiChangePct != null && (
          <span className="tabular-nums">
            OI {r.oiChangePct >= 0 ? '▲' : '▼'} {Math.abs(r.oiChangePct).toFixed(1)}% ·{' '}
          </span>
        )}
        {r.oiCombo || 'OI trend needs 24h of data.'}
      </div>
    </div>
  );
}

// The deep dive: every coin at once, price + bar + OI. Behind the expand.
function AssetRow({ r }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-zinc-100">{r.symbol}</span>
          {r.price != null && (
            <span className="text-sm tabular-nums text-zinc-300">
              ${Number(r.price).toLocaleString('en-US')}
            </span>
          )}
          <ChangeChip pct={r.change24hPct} />
        </div>
        <span className={`text-xs font-medium ${TONE_TEXT[r.band] || 'text-zinc-400'}`}>
          {r.fundingEmoji} {r.fundingLabel}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <FundingBar fundingRate={r.fundingRate} band={r.band} barPct={r.barPct} />
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-400">
          {r.fundingRatePct}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
        {r.oiChangePct != null && (
          <span className="tabular-nums">
            OI {r.oiChangePct >= 0 ? '▲' : '▼'} {Math.abs(r.oiChangePct).toFixed(1)}% ·
          </span>
        )}
        <span>{r.oiCombo || 'OI trend needs 24h of data.'}</span>
      </div>
    </li>
  );
}

// Wire each coin radio to its pill highlight + snapshot bar. Radios must be
// siblings of `.pcstrip` and `.pcdeep` for these `~` selectors to reach.
function filterCss(keys) {
  const rules = [`.pcbar{display:none}`];
  for (const k of keys) {
    rules.push(`#pf-${k}:checked ~ .pcdeep summary .pcbar-${k}{display:block}`);
    rules.push(
      `#pf-${k}:checked ~ .pcstrip label[for="pf-${k}"]{box-shadow:inset 0 0 0 1.5px rgb(228 228 231 / .7)}`
    );
  }
  return rules.join('\n');
}

export default function PositioningCard({ rows }) {
  const live = rows.filter((r) => r.fundingRate != null);
  const s = positioningSummary(rows);
  const stat = live.length > 0 ? `${s.longsPaying}/${s.total} longs paying` : null;

  // Single coin: nothing to select or compare — just show its detail.
  if (live.length === 1) {
    return (
      <Card title="Positioning — Funding & OI" stat={stat}>
        <ul>
          <AssetRow r={live[0]} />
        </ul>
      </Card>
    );
  }

  const keys = live.map((r) => r.symbol);
  const defaultKey = s.mostCrowded?.symbol || live[0]?.symbol;

  return (
    <Card title="Positioning — Funding & OI" stat={stat}>
      {live.length === 0 ? (
        <Unavailable what="Derivatives data" />
      ) : (
        <>
          {live.map((r) => (
            <input
              key={r.symbol}
              type="radio"
              name="pf"
              id={`pf-${r.symbol}`}
              defaultChecked={r.symbol === defaultKey}
              className="sr-only"
              aria-label={`Show ${r.symbol} funding & OI`}
            />
          ))}

          <div className="pcstrip flex items-center gap-1.5">
            <div className="flex flex-1 gap-1">
              {live.map((r) => (
                <Pill key={r.symbol} r={r} hot={r.symbol === s.mostCrowded?.symbol} />
              ))}
            </div>
            <Explainer label="funding rate">{FUNDING_EXPLAINER}</Explainer>
            <Explainer label="open interest">{OI_EXPLAINER}</Explainer>
          </div>

          <details className="pcdeep group/deep mt-3 border-t border-zinc-800 pt-3">
            <summary className="cursor-pointer list-none rounded-lg transition-colors hover:bg-zinc-800/30 [&::-webkit-details-marker]:hidden">
              {live.map((r) => (
                <SnapshotBar key={r.symbol} r={r} />
              ))}
              <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-zinc-500">
                <span className="group-open/deep:hidden">all {live.length} coins &amp; OI</span>
                <span className="hidden group-open/deep:inline">hide details</span>
                <span
                  aria-hidden="true"
                  className="text-[9px] transition-transform group-open/deep:rotate-180"
                >
                  ▼
                </span>
              </div>
            </summary>
            <ul className="mt-2 divide-y divide-zinc-800 border-t border-zinc-800/60 pt-1">
              {live.map((r) => (
                <AssetRow key={r.symbol} r={r} />
              ))}
            </ul>
          </details>

          <style dangerouslySetInnerHTML={{ __html: filterCss(keys) }} />
        </>
      )}
    </Card>
  );
}
