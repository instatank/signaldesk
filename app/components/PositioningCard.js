// Funding + OI, snapshot-first. The default view is the crowding strip
// (one band-colored cell per coin) plus the single most crowded coin's
// diverging bar — the full per-coin list with prices and OI sits behind
// an expand, so adding coins never makes the default view taller.
import { positioningSummary } from '../../lib/dashboard.js';
import {
  Card,
  ChangeChip,
  Disclose,
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
      colors: red = crowded long, green = crowded short, amber = mild, gray = balanced.
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

// One cell of the crowding strip: the coin's whole funding read as a
// tinted chip. The title tooltip carries the exact number and label.
function StripCell({ r }) {
  return (
    <span
      title={`${r.symbol} ${r.fundingRatePct} — ${r.fundingLabel}`}
      className={`flex-1 rounded-md px-1 py-1.5 text-center text-[11px] font-semibold ${TONE_CHIP[r.band] || TONE_CHIP.gray}`}
    >
      {r.symbol}
    </span>
  );
}

// The headline read: only the most crowded coin gets a bar by default.
function MostCrowdedRow({ r }) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          Most crowded: <span className="font-semibold text-zinc-200">{r.symbol}</span>
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
    </div>
  );
}

// The deep dive: everything the old card showed, per coin.
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
        {r.oiCombo ? <span>{r.oiCombo}</span> : <span>OI trend needs 24h of data.</span>}
        <Explainer label="open interest">{OI_EXPLAINER}</Explainer>
      </div>
    </li>
  );
}

export default function PositioningCard({ rows }) {
  const live = rows.filter((r) => r.fundingRate != null);
  const s = positioningSummary(rows);
  return (
    <Card
      title="Positioning — Funding & OI"
      stat={live.length > 0 ? `${s.longsPaying}/${s.total} longs paying` : null}
    >
      {live.length === 0 ? (
        <Unavailable what="Derivatives data" />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <div className="flex flex-1 gap-1">
              {live.map((r) => (
                <StripCell key={r.symbol} r={r} />
              ))}
            </div>
            <Explainer label="funding rate">{FUNDING_EXPLAINER}</Explainer>
          </div>

          {s.mostCrowded ? (
            <MostCrowdedRow r={s.mostCrowded} />
          ) : (
            <p className="mt-3 text-xs text-zinc-500">
              Funding is near flat on all {s.total} coins — no crowding either way.
            </p>
          )}

          <Disclose
            label={`All ${live.length} coins & open interest`}
            className="mt-3 border-t border-zinc-800 pt-2.5"
          >
            <ul className="mt-3 divide-y divide-zinc-800">
              {live.map((r) => (
                <AssetRow key={r.symbol} r={r} />
              ))}
            </ul>
          </Disclose>
        </>
      )}
    </Card>
  );
}
