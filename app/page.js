// The Phase 2 dashboard: the visual form of the Telegram digest.
// Server-rendered only (zero client JS), reads Firestore directly,
// revalidates every 5 minutes — an honest pace for 15-minute data.
import sources from '../config/sources.json';
import macroCalendar from '../config/macro-events.json';
import { getDashboardData } from '../lib/dashboard.js';
import { upcomingMacroEvents } from '../lib/macro.js';
import PulseHero from './components/PulseHero.js';
import PositioningCard from './components/PositioningCard.js';
import NewsCard from './components/NewsCard.js';
import SiteHeader from './components/SiteHeader.js';

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
  const macroEvents = upcomingMacroEvents(macroCalendar.events, now);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <SiteHeader now={now} latestTs={data?.latestTs} stale={Boolean(data?.stale)} active="/" />

      {!data ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            Dashboard data is unavailable right now — the Telegram digest keeps arriving regardless.
          </p>
          <p className="mt-2 text-xs text-zinc-600">{error}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <PulseHero
            briefing={data.briefing}
            fearGreed={data.fearGreed}
            rows={data.rows}
            macroEvents={macroEvents}
            now={now}
          />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <PositioningCard rows={data.rows} />
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
