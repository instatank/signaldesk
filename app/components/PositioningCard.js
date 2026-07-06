// Funding + OI per asset. The diverging bar is the page's most important
// visual: leverage crowding you can see without reading a number.
import { Card, ChangeChip, Explainer, FundingBar, TONE_TEXT, Unavailable } from './ui.js';

const FUNDING_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Funding rate — who&rsquo;s paying to hold?</p>
    <p>
      Every 8 hours, perp traders on the crowded side pay the other side. Positive = longs paying
      (crowded long), negative = shorts paying (crowded short). Extremes are contrarian: crowded
      trades unwind violently. The bar grows right when longs pay, left when shorts pay.
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

export default function PositioningCard({ rows }) {
  const live = rows.filter((r) => r.fundingRate != null);
  return (
    <Card
      title="Positioning — Funding & OI"
      right={<Explainer label="funding rate">{FUNDING_EXPLAINER}</Explainer>}
    >
      {live.length === 0 ? (
        <Unavailable what="Derivatives data" />
      ) : (
        <ul className="divide-y divide-zinc-800">
          {live.map((r) => (
            <li key={r.symbol} className="py-3 first:pt-0 last:pb-0">
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
          ))}
        </ul>
      )}
    </Card>
  );
}
