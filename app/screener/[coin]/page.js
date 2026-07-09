// Per-coin detail: the "expanded" screener view. Return ladder, plain-language
// reads (all templated math, no AI), and three charts — relative performance
// vs the average coin, daily funding, and open-interest change. Reads the
// same screener/latest doc; server-only, zero client JS, static SVG charts.
import { getScreenerData, findCoin } from '../../../lib/screener.js';
import { relativeTime } from '../../../lib/dashboard.js';
import { Sparkline, TONE_TEXT } from '../../components/ui.js';
import SiteHeader from '../../components/SiteHeader.js';

export const revalidate = 300;
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { coin } = await params;
  return { title: `SignalDesk — ${String(coin).toUpperCase()} screener` };
}

async function loadCoin(base) {
  try {
    const { getDb } = await import('../../../lib/firestore.js');
    const data = await getScreenerData(getDb());
    return { data, coin: findCoin(data, base), error: null };
  } catch (err) {
    return { data: null, coin: null, error: String(err?.message || err) };
  }
}

function fmt(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`;
}
function abs(v, dp = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.abs(v).toFixed(dp)}%`;
}

// Daily funding bars: above baseline = longs paid shorts that day.
function FundingBars({ values }) {
  const vals = (values || []).filter(Number.isFinite);
  if (vals.length < 2) return <p className="text-xs text-zinc-600">Not enough funding history.</p>;
  const max = Math.max(0.0001, ...vals.map((v) => Math.abs(v)));
  const bw = 4;
  const gap = 2;
  const h = 56;
  const mid = h / 2;
  const width = vals.length * (bw + gap);
  return (
    <svg viewBox={`0 0 ${width} ${h}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label="daily funding">
      <line x1="0" y1={mid} x2={width} y2={mid} stroke="#3f3f46" strokeWidth="0.5" />
      {vals.map((v, i) => {
        const barH = (Math.abs(v) / max) * (mid - 2);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={v >= 0 ? mid - barH : mid}
            width={bw}
            height={Math.max(barH, 0.5)}
            fill={v >= 0 ? '#60a5fa' : '#f87171'}
          />
        );
      })}
    </svg>
  );
}

function ChartBlock({ title, blurb, children }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{title}</h3>
      <p className="mb-2 mt-0.5 text-[11px] leading-snug text-zinc-600">{blurb}</p>
      {children}
    </div>
  );
}

function Bullet({ children }) {
  return (
    <li className="flex gap-2">
      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
      <span className="text-sm leading-relaxed text-zinc-300">{children}</span>
    </li>
  );
}

export default async function CoinDetailPage({ params }) {
  const { coin: coinParam } = await params;
  const now = new Date();
  const { data, coin, error } = await loadCoin(coinParam);

  if (!coin) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <SiteHeader now={now} active="/screener" />
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            {data ? `"${String(coinParam).toUpperCase()}" isn't in the tracked universe.` : 'Screener data unavailable right now.'}
          </p>
          {error && <p className="mt-2 text-xs text-zinc-600">{error}</p>}
          <a href="/screener" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">← Back to screener</a>
        </div>
      </main>
    );
  }

  const d = coin.detail || {};
  const trend = coin.trend || {};
  const dd = d.drawdown;
  const ladder = [
    { label: 'yesterday', v: coin.r24h },
    { label: '1 week', v: coin.r7d },
    { label: '1 month', v: coin.r30d },
    { label: '2 months', v: coin.r60d },
  ];

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <SiteHeader now={now} active="/screener" />

      {/* header */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{coin.base}</h1>
          <span className="text-sm text-zinc-500">{coin.name}</span>
          {coin.sizeRank && <span className="text-xs text-zinc-600">#{coin.sizeRank} by size</span>}
          {coin.tracked && (
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-sky-400">tracked</span>
          )}
          <a
            href={`https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-500 hover:text-sky-400"
          >
            open in TradingView ↗
          </a>
        </div>
        <a href="/screener" className="text-xs text-zinc-500 hover:text-sky-400">✕ close</a>
      </div>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
        {/* strength headline */}
        <div>
          <p className="text-lg font-semibold text-zinc-100">
            Stronger overall than {Math.round(coin.strength ?? 0)}% of the market.
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Averages this coin&rsquo;s rankings for recent returns, trend, and swing-adjusted performance —
            100 means top of the pack.
          </p>
        </div>

        {/* return ladder */}
        <div className="grid grid-cols-4 gap-2 border-y border-zinc-800 py-3">
          {ladder.map((x) => (
            <div key={x.label}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{x.label}</div>
              <div className={`text-base font-semibold tabular-nums ${x.v == null ? 'text-zinc-600' : x.v >= 0 ? TONE_TEXT.green : TONE_TEXT.red}`}>
                {fmt(x.v)}
              </div>
            </div>
          ))}
        </div>

        {/* plain-language reads */}
        <ul className="space-y-2">
          <Bullet>
            <span className={TONE_TEXT[trend.tone] || 'text-zinc-300'}>{trend.label || 'unrated'}</span> —{' '}
            {d.aboveMa200 == null
              ? 'not enough history for a 200-day trend read'
              : `trading ${d.aboveMa200 ? 'above' : 'below'} its 200-day average`}
            {coin.r7d != null && `, ${coin.r7d >= 0 ? 'up' : 'down'} ${abs(coin.r7d)} over the past week`}.
          </Bullet>
          {d.vsBtc30 != null && coin.symbol !== 'BTCUSDT' && (
            <Bullet>
              {coin.r30d != null && coin.r30d > d.vsBtc30 ? 'Beating' : 'Lagging'} Bitcoin this month ({fmt(coin.r30d)} vs{' '}
              {fmt(d.vsBtc30)} for BTC). Simple 30-day price change, this coin next to Bitcoin&rsquo;s.
            </Bullet>
          )}
          <Bullet>
            <span className={TONE_TEXT[coin.cost?.tone] || 'text-zinc-300'}>{coin.cost?.label || '—'}</span> cost to hold.
            Perpetual funding is a rolling fee between longs and shorts; this is the past week&rsquo;s average, annualized
            {d.annualFunding != null && ` (${fmt(d.annualFunding)}/yr)`}.
          </Bullet>
          {dd && (
            <Bullet>
              Trading {abs(dd.pctBelowHigh)} below its highest price of the past year ({dd.daysListed} days of history).
              Context only — being far below a high says nothing about what comes next.
            </Bullet>
          )}
          {d.dailyMove != null && (
            <Bullet>
              Typically moves about ±{d.dailyMove.toFixed(1)}% a day — a measure of how much it swings, not a forecast.
            </Bullet>
          )}
        </ul>

        {/* charts */}
        <div className="grid gap-3 sm:grid-cols-3">
          <ChartBlock title="vs the average coin — 1m" blurb="Gap vs the average tracked coin. Above the midline = ahead of the market.">
            {d.relSeries?.length >= 2 ? (
              <Sparkline
                values={d.relSeries}
                stroke={d.relSeries[d.relSeries.length - 1] >= 0 ? '#34d399' : '#f87171'}
                height={56}
                className="h-14 w-full"
                label="relative performance"
              />
            ) : (
              <p className="text-xs text-zinc-600">Not enough history.</p>
            )}
          </ChartBlock>

          <ChartBlock title="cost to hold — daily funding" blurb="Each bar is a day's funding. Above: longs paid shorts. Below: shorts paid longs.">
            <FundingBars values={d.fundingBars} />
          </ChartBlock>

          <ChartBlock title="open positions — ~29d" blurb={d.oiChange != null ? `Open contracts ${d.oiChange >= 0 ? 'up' : 'down'} ${abs(d.oiChange)} — ${d.oiChange >= 0 ? 'positions building' : 'positions being unwound'}.` : 'Open-interest trend.'}>
            {d.oiSeries?.length >= 2 ? (
              <Sparkline
                values={d.oiSeries}
                stroke={d.oiChange >= 0 ? '#34d399' : '#f87171'}
                height={56}
                className="h-14 w-full"
                label="open interest"
              />
            ) : (
              <p className="text-xs text-zinc-600">Not enough history.</p>
            )}
          </ChartBlock>
        </div>

        {data?.generatedAt && (
          <p className="text-[10px] text-zinc-700">
            Rebuilt {relativeTime(new Date(data.generatedAt), now)} · Binance futures · not advice, no predictions.
          </p>
        )}
      </section>
    </main>
  );
}
