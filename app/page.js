// The Phase 2 dashboard: the visual form of the Telegram digest.
// Server-rendered only (zero client JS), reads Firestore directly,
// revalidates every 5 minutes — an honest pace for 15-minute data.
import sources from '../config/sources.json';
import { getDashboardData, istDisplayDate, istTimeString } from '../lib/dashboard.js';
import PulseHero from './components/PulseHero.js';
import PositioningCard from './components/PositioningCard.js';
import FearGreedCard from './components/FearGreedCard.js';
import NewsCard from './components/NewsCard.js';

export const revalidate = 300;

// Missing env vars (local dev, CI build) must degrade, never crash the
// build — same principle as the pipeline's AI fallback.
async function loadData(now) {
  try {
    const { getDb } = await import('../lib/firestore.js');
    return { data: await getDashboardData(getDb(), sources.assets, now), error: null };
  } catch (err) {
    return { data: null, error: String(err?.message || err) };
  }
}

export default async function Home() {
  const now = new Date();
  const { data, error } = await loadData(now);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">
          Signal<span className="text-sky-400">Desk</span>
        </h1>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{istDisplayDate(now)}</span>
          {data?.latestTs && (
            <span className="text-zinc-600">· data as of {istTimeString(data.latestTs)} IST</span>
          )}
          {data?.stale && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400">
              data may be stale
            </span>
          )}
        </div>
      </header>

      {!data ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            Dashboard data is unavailable right now — the Telegram digest keeps arriving regardless.
          </p>
          <p className="mt-2 text-xs text-zinc-600">{error}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <PulseHero briefing={data.briefing} fearGreed={data.fearGreed} rows={data.rows} now={now} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <PositioningCard rows={data.rows} />
              <FearGreedCard fearGreed={data.fearGreed} />
            </div>
            <NewsCard headlines={data.headlines} now={now} />
          </div>
        </div>
      )}

      <footer className="mt-8 pb-4 text-center text-xs text-zinc-700">
        Informs, never advises. No signals, no predictions.
      </footer>
    </main>
  );
}
