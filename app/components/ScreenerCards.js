// Screener presentational pieces: shared atoms, the market-summary banner,
// and the five insight cards (Strongest / Picking up speed / Crowded longs /
// Washed out / Yesterday's big moves). All server components, zero client JS.
import { Card, ChangeChip, Sparkline, TONE_TEXT } from './ui.js';

// A coin label that links to its detail page; tracked coins get an accent.
export function CoinTag({ base, name, tracked, className = '' }) {
  return (
    <a href={`/screener/${base}`} className={`group inline-flex items-baseline gap-1.5 ${className}`}>
      <span className={`font-semibold ${tracked ? 'text-sky-300' : 'text-zinc-200'} group-hover:text-sky-400`}>
        {base}
      </span>
      {name && name !== base && <span className="text-xs text-zinc-500">{name}</span>}
      {tracked && <span className="text-[9px] uppercase tracking-wider text-sky-500/70">tracked</span>}
    </a>
  );
}

// A relative-performance sparkline (coin vs the average tracked coin).
export function RelSpark({ values, className = 'h-6 w-20' }) {
  if (!values || values.length < 2) return <span className="inline-block w-20" />;
  const up = values[values.length - 1] >= 0;
  return (
    <Sparkline
      values={values}
      stroke={up ? '#34d399' : '#f87171'}
      height={24}
      width={80}
      className={className}
      label="performance vs the average coin"
    />
  );
}

function fmtPct(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

export function MarketSummary({ market }) {
  if (!market) return null;
  const bullets = [market.breadth, market.avgMonth, market.crowding, market.oiAnomaly].filter(Boolean);
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      <p className="text-sm font-medium leading-relaxed text-zinc-100 sm:text-base">{market.btcRegime}</p>
      <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-zinc-400 sm:grid-cols-2">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-zinc-600">·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Generic insight card: a titled list + optional "beyond the top N" line.
function InsightCard({ title, blurb, list, empty, renderItem }) {
  const items = list?.top || [];
  const overflow = list?.overflow || [];
  return (
    <Card title={title} stat={items.length ? `${items.length}` : null}>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">{blurb}</p>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-zinc-600">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((c) => (
            <li key={c.symbol} className="flex items-center gap-3">
              <div className="w-24 shrink-0">
                <CoinTag base={c.base} name={c.name} tracked={c.tracked} />
              </div>
              <RelSpark values={c.relSpark} className="h-6 w-16 shrink-0" />
              <span className="min-w-0 flex-1 text-xs leading-snug text-zinc-400">{renderItem(c)}</span>
            </li>
          ))}
        </ul>
      )}
      {overflow.length > 0 && (
        <p className="mt-3 border-t border-zinc-800 pt-2 text-[11px] leading-relaxed text-zinc-600">
          beyond the top {items.length}: {overflow.join(' · ')}
        </p>
      )}
    </Card>
  );
}

export function StrongestCard({ list }) {
  return (
    <InsightCard
      title="Strongest right now"
      blurb="Best overall marks for the past month — returns, trend, and standing vs the rest of the market."
      list={list}
      empty="Nothing stands out."
      renderItem={(c) => (
        <>
          <span className="text-zinc-300">Stronger than {Math.round(c.strength ?? 0)}% of the market</span>
          {' · '}
          <span className={c.r30d >= 0 ? TONE_TEXT.green : TONE_TEXT.red}>{fmtPct(c.r30d)}</span> this month
        </>
      )}
    />
  );
}

export function SpeedCard({ list }) {
  return (
    <InsightCard
      title="Picking up speed"
      blurb="Doing better over the past 1–3 weeks than their past month would suggest."
      list={list}
      empty="No coins are accelerating today."
      renderItem={(c) => (
        <>
          <span className={c.r7d >= 0 ? TONE_TEXT.green : TONE_TEXT.red}>{fmtPct(c.r7d)}</span> this past week ·{' '}
          {fmtPct(c.r30d)} over the whole month
        </>
      )}
    />
  );
}

export function CrowdedCard({ list }) {
  return (
    <InsightCard
      title="Crowded longs"
      blurb="Where long positioning looks expensive — elevated funding this past week. Says nothing about strength."
      list={list}
      empty="No major coins stand out today."
      renderItem={(c) => (
        <>
          Funding <span className={TONE_TEXT.amber}>~{Math.round(c.annualFunding ?? 0)}%/yr</span> to hold a long
        </>
      )}
    />
  );
}

export function WashedOutCard({ list }) {
  return (
    <InsightCard
      title="Washed out"
      blurb="The biggest losers of the past two months — where rebounds have historically formed. A watch list, not a buy list."
      list={list}
      empty="No deep two-month losers today."
      renderItem={(c) => (
        <>
          <span className={TONE_TEXT.red}>{fmtPct(c.r60d)}</span> over the past two months
        </>
      )}
    />
  );
}

export function BigMovesCard({ list }) {
  return (
    <InsightCard
      title="Yesterday's big moves"
      blurb="Outsized one-day moves. Context only — a big move says nothing about what comes next."
      list={list}
      empty="A quiet day — no outsized moves."
      renderItem={(c) => (
        <>
          <span className={c.r24h >= 0 ? TONE_TEXT.green : TONE_TEXT.red}>{fmtPct(c.r24h)}</span> in 24h
          {c.volumeQuiet && ' · quiet volume'}
        </>
      )}
    />
  );
}
