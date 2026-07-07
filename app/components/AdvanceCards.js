// The Advance page's cards. Same disclosure contract as the main
// dashboard: header stat (visible folded) → visual snapshot (default
// open) → full enumeration behind an inner expand. These are the
// free-tier "advanced" reads: crowd positioning, book depth, money
// flows, options, and 30-day character. Server components, zero JS.
import { relativeTime } from '../../lib/dashboard.js';
import { compactUsd } from '../../lib/advanced.js';
import { Card, ChangeChip, Disclose, Explainer, Sparkline, TONE_CHIP, TONE_TEXT, Unavailable } from './ui.js';

function SectionAge({ ts, now }) {
  if (!ts) return null;
  return <span className="text-[10px] normal-case tracking-normal text-zinc-600">updated {relativeTime(ts, now)}</span>;
}

// ---------------------------------------------------------------- crowd
const CROWD_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Long/short ratio — how is the crowd leaning?</p>
    <p>
      The ratio of accounts long vs short on perps (2.0 = twice as many longs). It counts
      accounts, not position size, so it skews retail — which is the point: retail crowds long
      near tops and capitulates near bottoms, so extremes read contrarian. Compare with funding:
      when both scream &ldquo;crowded long,&rdquo; the squeeze risk is real.
    </p>
  </>
);

export function CrowdCard({ crowd, now }) {
  return (
    <Card
      title="Crowd — Long/Short Accounts"
      stat={crowd ? `${crowd.leaningLong}/${crowd.total} leaning long` : null}
    >
      {!crowd ? (
        <Unavailable what="Long/short data" />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <div className="flex flex-1 gap-1">
              {crowd.rows.map((r) => (
                <span
                  key={r.symbol}
                  title={`${r.symbol} ${r.ratio.toFixed(2)} — ${r.label}`}
                  className={`flex-1 rounded-md px-1 py-1.5 text-center text-[11px] font-semibold ${TONE_CHIP[r.band]}`}
                >
                  {r.symbol}
                </span>
              ))}
            </div>
            <Explainer label="long/short ratio">{CROWD_EXPLAINER}</Explainer>
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-2 text-xs">
            <span className="text-zinc-500">
              Most extreme: <span className="font-semibold text-zinc-200">{crowd.mostExtreme.symbol}</span>{' '}
              <span className="tabular-nums">{crowd.mostExtreme.ratio.toFixed(2)}</span>
            </span>
            <span className={`font-medium ${TONE_TEXT[crowd.mostExtreme.band]}`}>
              {crowd.mostExtreme.emoji} {crowd.mostExtreme.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{crowd.mostExtreme.explanation}</p>

          <Disclose label={`All ${crowd.rows.length} coins`} className="mt-3 border-t border-zinc-800 pt-2.5">
            <ul className="mt-3 divide-y divide-zinc-800">
              {crowd.rows.map((r) => (
                <li key={r.symbol} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="w-12 shrink-0 text-sm font-semibold text-zinc-100">{r.symbol}</span>
                  <span className="w-14 shrink-0 text-sm tabular-nums text-zinc-300">{r.ratio.toFixed(2)}</span>
                  <div className="min-w-0 flex-1">
                    {r.spark.length >= 2 && (
                      <Sparkline
                        values={r.spark}
                        stroke="#71717a"
                        height={20}
                        className="h-5 w-full"
                        label={`${r.symbol} long/short ratio, 24h trend`}
                      />
                    )}
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${TONE_TEXT[r.band]}`}>
                    {r.emoji} {r.label}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
              ratio · 24h trend <SectionAge ts={crowd.ts} now={now} />
            </p>
          </Disclose>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- depth
const DEPTH_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Order-book depth — where is the resting liquidity?</p>
    <p>
      USD sitting on the spot book within ±2% of price. More on the bid side = resting demand
      below; more on the ask side = supply waiting above. Two honest caveats: this is a 15-minute
      snapshot of a book that repaints in milliseconds, and big resting orders can be spoofed —
      treat it as texture, never as a signal on its own.
    </p>
  </>
);

function DepthBar({ bidSharePct }) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-red-500/25">
      <div
        className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-500/60"
        style={{ width: `${Math.min(100, Math.max(0, bidSharePct))}%` }}
      />
      <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-950/60" />
    </div>
  );
}

export function DepthCard({ depth, now }) {
  return (
    <Card
      title="Spot Book — ±2% Depth"
      stat={depth ? `${depth.mostImbalanced.symbol} ${Math.round(depth.mostImbalanced.bidSharePct)}% bid` : null}
    >
      {!depth ? (
        <Unavailable what="Order-book data" />
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <div className="flex flex-1 gap-1">
              {depth.rows.map((r) => (
                <span
                  key={r.symbol}
                  title={`${r.symbol} — ${Math.round(r.bidSharePct)}% of ±2% depth is bids`}
                  className={`flex-1 rounded-md px-1 py-1.5 text-center text-[11px] font-semibold ${TONE_CHIP[r.band]}`}
                >
                  {r.symbol}
                </span>
              ))}
            </div>
            <Explainer label="order-book depth">{DEPTH_EXPLAINER}</Explainer>
          </div>

          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-zinc-500">
                Most lopsided: <span className="font-semibold text-zinc-200">{depth.mostImbalanced.symbol}</span>
              </span>
              <span className="tabular-nums text-zinc-400">
                {Math.round(depth.mostImbalanced.bidSharePct)}% bid / {Math.round(100 - depth.mostImbalanced.bidSharePct)}% ask
              </span>
            </div>
            <div className="mt-1.5">
              <DepthBar bidSharePct={depth.mostImbalanced.bidSharePct} />
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">{depth.mostImbalanced.read}</p>
          </div>

          <Disclose label={`All ${depth.rows.length} books`} className="mt-3 border-t border-zinc-800 pt-2.5">
            <ul className="mt-3 divide-y divide-zinc-800">
              {depth.rows.map((r) => (
                <li key={r.symbol} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-sm font-semibold text-zinc-100">{r.symbol}</span>
                    <span className="tabular-nums text-zinc-500">
                      bids {compactUsd(r.bidUsd)} · asks {compactUsd(r.askUsd)}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <DepthBar bidSharePct={r.bidSharePct} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
              green = bids, red = asks <SectionAge ts={depth.ts} now={now} />
            </p>
          </Disclose>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- flows
const FLOWS_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Money flows — is cash entering crypto rails?</p>
    <p>
      Stablecoins are crypto&rsquo;s cash balance: supply growing means money moved in and is
      waiting to be deployed (&ldquo;dry powder&rdquo;); shrinking means money left entirely.
      BTC dominance is BTC&rsquo;s share of the total market — rising dominance in a down market
      is flight to quality inside crypto; falling dominance while prices rise usually means money
      is rotating into alts.
    </p>
  </>
);

export function FlowsCard({ flows, now }) {
  const changeStat =
    flows?.totalChange24hPct != null
      ? `${flows.totalChange24hPct >= 0 ? '+' : ''}${flows.totalChange24hPct.toFixed(2)}% 24h`
      : null;
  return (
    <Card title="Money Flows — Stablecoins & Dominance" stat={changeStat}>
      {!flows ? (
        <Unavailable what="Flow data" />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="grid flex-1 grid-cols-3 gap-3">
              <div>
                <div className="text-lg font-bold tabular-nums text-zinc-100">{compactUsd(flows.totalMcap) ?? '—'}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-widest text-zinc-500">
                  Stablecoins <ChangeChip pct={flows.totalChange24hPct} />
                </div>
              </div>
              <div>
                <div className="text-lg font-bold tabular-nums text-zinc-100">
                  {flows.global?.btcDominancePct != null ? `${flows.global.btcDominancePct.toFixed(1)}%` : '—'}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-500">BTC dominance</div>
              </div>
              <div>
                <div className="text-lg font-bold tabular-nums text-zinc-100">
                  {compactUsd(flows.global?.totalMcapUsd) ?? '—'}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-widest text-zinc-500">
                  Total mcap <ChangeChip pct={flows.global?.mcapChange24hPct} />
                </div>
              </div>
            </div>
            <Explainer label="money flows">{FLOWS_EXPLAINER}</Explainer>
          </div>

          {flows.read && <p className="mt-3 text-xs text-zinc-500">{flows.read}</p>}

          {flows.coins.length > 0 && (
            <Disclose label="Per stablecoin" className="mt-3 border-t border-zinc-800 pt-2.5">
              <ul className="mt-3 divide-y divide-zinc-800">
                {flows.coins.map((c) => (
                  <li key={c.symbol} className="flex items-baseline justify-between gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
                    <span className="font-semibold text-zinc-100">{c.symbol}</span>
                    <span className="flex items-baseline gap-3 tabular-nums text-zinc-400">
                      <span>{compactUsd(c.marketCap)}</span>
                      <ChangeChip pct={c.mcapChange24hPct} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
                market cap · 24h change <SectionAge ts={flows.ts} now={now} />
              </p>
            </Disclose>
          )}
        </>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- options
const OPTIONS_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Options — what is the smart money pricing in?</p>
    <p>
      DVOL is Deribit&rsquo;s implied-volatility index: the annualized move option prices expect
      over the next 30 days (DVOL 50 ≈ ±2.6% expected daily swing). Compare it with realized vol —
      implied far above realized means options are braced for a catalyst. The put/call ratio splits
      open interest: puts are downside protection, calls are upside bets. Crypto normally runs
      call-heavy, so put demand near parity is notable. BTC and ETH only — the coins with a liquid
      listed options market.
    </p>
  </>
);

export function OptionsCard({ options, now }) {
  const statRow = options?.rows.find((r) => r.dvol != null);
  return (
    <Card
      title="Options — Implied Vol & Put/Call"
      stat={statRow ? `${statRow.currency} DVOL ${Math.round(statRow.dvol)}` : null}
    >
      {!options ? (
        <Unavailable what="Options data" />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className={`grid flex-1 gap-4 ${options.rows.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {options.rows.map((r) => (
                <div key={r.currency}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{r.currency}</span>
                    {r.dvol != null && (
                      <>
                        <span className="text-lg font-bold tabular-nums text-zinc-100">{r.dvol.toFixed(1)}</span>
                        {r.dvolChange24h != null && (
                          <span
                            className={`text-xs tabular-nums ${
                              r.dvolChange24h > 0.5 ? 'text-red-400' : r.dvolChange24h < -0.5 ? 'text-emerald-400' : 'text-zinc-500'
                            }`}
                          >
                            {r.dvolChange24h >= 0 ? '+' : ''}
                            {r.dvolChange24h.toFixed(1)} 24h
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-500">
                    DVOL (implied 30d)
                    {r.realizedVolPct != null && ` · realized ${Math.round(r.realizedVolPct)}`}
                  </div>
                  {r.putCallRatio != null && (
                    <div className="mt-1.5 text-xs text-zinc-400">
                      P/C <span className="font-medium tabular-nums text-zinc-200">{r.putCallRatio.toFixed(2)}</span>
                      <span className="text-zinc-500"> — {r.pcRead}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Explainer label="options data">{OPTIONS_EXPLAINER}</Explainer>
          </div>

          {options.rows[0]?.volGapRead && (
            <p className="mt-3 text-xs text-zinc-500">
              <span className="font-medium text-zinc-300">{options.rows[0].currency}:</span>{' '}
              {options.rows[0].volGapRead}
            </p>
          )}

          <Disclose label="Open-interest detail" className="mt-3 border-t border-zinc-800 pt-2.5">
            <ul className="mt-3 divide-y divide-zinc-800">
              {options.rows.map((r) => (
                <li key={r.currency} className="py-2.5 text-xs text-zinc-400 first:pt-0 last:pb-0">
                  <span className="text-sm font-semibold text-zinc-100">{r.currency}</span>{' '}
                  {r.callOi != null && r.putOi != null ? (
                    <span className="tabular-nums">
                      — calls {Math.round(r.callOi).toLocaleString('en-US')} {r.currency} · puts{' '}
                      {Math.round(r.putOi).toLocaleString('en-US')} {r.currency} open interest
                    </span>
                  ) : (
                    <span>— open-interest split unavailable</span>
                  )}
                  {r.volGapRead && <p className="mt-1 text-zinc-500">{r.volGapRead}</p>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
              source: Deribit <SectionAge ts={options.ts} now={now} />
            </p>
          </Disclose>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ character
const CHARACTER_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">30-day character — how does each coin trade?</p>
    <p>
      Realized volatility is how much a coin has actually been moving (annualized — higher means
      bigger daily candles, so the same position size carries more risk). Correlation to BTC asks
      whether the coin has its own story: near 1.0 it&rsquo;s a BTC trade in disguise; near 0 it
      moves to its own news. Both are computed from the last 30 daily closes and refresh once a day.
    </p>
  </>
);

export function CharacterCard({ character, now }) {
  const maxVol = character ? Math.max(...character.rows.map((r) => r.realizedVolPct || 0), 1) : 1;
  return (
    <Card
      title="Character — 30d Vol & BTC Correlation"
      stat={character?.wildest?.realizedVolPct != null ? `${character.wildest.symbol} wildest` : null}
    >
      {!character ? (
        <Unavailable what="Correlation/volatility data" />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <ul className="flex-1 space-y-2">
              {character.rows.map((r) => (
                <li key={r.symbol} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-sm font-semibold text-zinc-100">{r.symbol}</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    {r.realizedVolPct != null && (
                      <div
                        className="h-full rounded-full bg-sky-500/60"
                        style={{ width: `${Math.max(3, (r.realizedVolPct / maxVol) * 100)}%` }}
                      />
                    )}
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                    {r.realizedVolPct != null ? `${Math.round(r.realizedVolPct)}%` : '—'}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                    {r.correlationToBtc != null ? r.correlationToBtc.toFixed(2) : r.symbol === 'BTC' ? '1.00' : '—'}
                  </span>
                </li>
              ))}
            </ul>
            <Explainer label="volatility and correlation">{CHARACTER_EXPLAINER}</Explainer>
          </div>
          <p className="mt-2 flex justify-end gap-4 text-[10px] uppercase tracking-widest text-zinc-600">
            <span>realized vol</span>
            <span>corr·BTC</span>
          </p>

          <Disclose label="What this says" className="mt-2 border-t border-zinc-800 pt-2.5">
            <ul className="mt-3 space-y-1.5 text-xs text-zinc-400">
              {character.rows
                .filter((r) => r.corrRead)
                .map((r) => (
                  <li key={r.symbol}>
                    <span className="font-medium text-zinc-200">{r.symbol}</span> {r.corrRead}
                    {r.realizedVolPct != null && (
                      <span className="text-zinc-500">
                        {' '}
                        · ~{(r.realizedVolPct / 19).toFixed(1)}% typical daily move
                      </span>
                    )}
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
              refreshes daily <SectionAge ts={character.ts} now={now} />
            </p>
          </Disclose>
        </>
      )}
    </Card>
  );
}
