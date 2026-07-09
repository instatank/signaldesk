// The Screener page: "what's strong, what's moving, what's crowded" across
// the largest Binance-futures coins, our tracked coins highlighted. A daily
// background job (/api/screener) computes it; prices refresh every 15 min.
// No AI, server-only, zero client JS (sorting is a native radio + CSS).
import sources from '../../config/sources.json';
import { getScreenerData } from '../../lib/screener.js';
import { istTimeString, relativeTime } from '../../lib/dashboard.js';
import SiteHeader from '../components/SiteHeader.js';
import {
  MarketSummary,
  StrongestCard,
  SpeedCard,
  CrowdedCard,
  WashedOutCard,
  BigMovesCard,
} from '../components/ScreenerCards.js';
import ScreenerTable from '../components/ScreenerTable.js';

// On-demand: read fresh each visit so REFRESH + 15-min live prices show
// immediately. The read is one cheap Firestore doc.
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { title: 'SignalDesk — Screener' };

async function loadData() {
  try {
    const { getDb } = await import('../../lib/firestore.js');
    return { data: await getScreenerData(getDb()), error: null };
  } catch (err) {
    return { data: null, error: String(err?.message || err) };
  }
}

function RefreshBar({ params }) {
  const banner = params.refreshed
    ? { cls: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300', text: 'Screener rebuilt with fresh Binance data.' }
    : params.cooldown
      ? { cls: 'border-amber-500/30 bg-amber-500/5 text-amber-300', text: `Just refreshed — try again in ~${Math.ceil(Number(params.cooldown) / 60)} min.` }
      : params.error
        ? { cls: 'border-red-500/30 bg-red-500/5 text-red-300', text: `Refresh failed: ${params.error}` }
        : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <form method="post" action="/api/screener/refresh">
        <button
          type="submit"
          className="rounded-full border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-sky-500 hover:text-sky-300"
        >
          ↻ Refresh
        </button>
      </form>
      {banner && <span className={`rounded-lg border px-3 py-1 text-xs ${banner.cls}`}>{banner.text}</span>}
    </div>
  );
}

export default async function ScreenerPage({ searchParams }) {
  const now = new Date();
  const params = (await searchParams) || {};
  const { data, error } = await loadData();
  const insights = data?.insights;
  const liveTs = data?.livePricesAt ? new Date(data.livePricesAt) : null;

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <SiteHeader now={now} latestTs={liveTs} active="/screener" />

      <div className="mb-4">
        <RefreshBar params={params} />
      </div>

      {!data || !data.rows?.length ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            Nothing to show yet — the screener builds on its next daily run (00:45 UTC), or hit
            <span className="text-zinc-300"> ↻ Refresh</span> above to build it now (~30–60s).
          </p>
          {error && <p className="mt-2 text-xs text-zinc-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-zinc-500">
              {data.rows.length} largest coins from Binance futures · your tracked coins highlighted
            </p>
            {data.generatedAt && (
              <p className="text-[11px] text-zinc-600">
                strength/returns rebuilt {relativeTime(new Date(data.generatedAt), now)}
                {liveTs && ` · prices ${istTimeString(liveTs)} IST`}
              </p>
            )}
          </div>

          <MarketSummary market={data.market} />

          <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <StrongestCard list={insights?.strongest} />
            <SpeedCard list={insights?.speed} />
            <CrowdedCard list={insights?.crowded} />
            <WashedOutCard list={insights?.washedOut} />
            <BigMovesCard list={insights?.bigMoves} />
          </div>

          <ScreenerTable rows={data.rows} generatedAt={data.generatedAt} livePricesAt={data.livePricesAt} />
        </div>
      )}

      <footer className="mt-8 space-y-1 pb-4 text-center text-xs text-zinc-700">
        <p>Informs, never advises. No signals, no predictions.</p>
        <p>Relative performance across a coin universe — not price targets. Data: Binance futures.</p>
      </footer>
    </main>
  );
}
