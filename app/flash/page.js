// The Flash page: an on-demand, last-4h market-reaction read for when
// something just happened and the owner wants to read the market now,
// without waiting for the 07:00/19:00 digest.
//
// It reuses the FULL dashboard layout (PulseHero + Positioning + News) so it
// looks and reads exactly like `/` — the difference is the data is pulled
// fresh on the button press and the hero briefing is Claude's 4h reaction
// read instead of the scheduled 12/24h one. The visuals are drawn from raw
// Firestore numbers (SVG/CSS), so showing them costs zero extra AI tokens.
//
// Zero client JS, like every other page: the trigger is a plain HTML form
// that POSTs to /api/flash and gets 303-redirected back here. During the
// 10-minute cooldown the button is server-rendered disabled with a static
// "available in ~Xm" label (reload to refresh the countdown — no ticking JS).
import sources from '../../config/sources.json';
import macroCalendar from '../../config/macro-events.json';
import { FLASH_RECENT_HOURS, FLASH_COOLDOWN_MS, getFlashLatest, formatCountdown } from '../../lib/flash.js';
import { getDashboardData } from '../../lib/dashboard.js';
import { upcomingMacroEvents } from '../../lib/macro.js';
import SiteHeader from '../components/SiteHeader.js';
import PulseHero from '../components/PulseHero.js';
import PositioningCard from '../components/PositioningCard.js';
import NewsCard from '../components/NewsCard.js';

// On-demand: never cache. Every load reflects the current cooldown + result.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: 'SignalDesk — Flash' };

const COOLDOWN_MIN = Math.round(FLASH_COOLDOWN_MS / 60000);

async function loadFlash(now) {
  try {
    const { getDb } = await import('../../lib/firestore.js');
    const db = getDb();
    // The flash's lean ingest writes the same metrics/headlines the
    // dashboard reads, so getDashboardData reflects the just-pulled data.
    const [flash, data] = await Promise.all([
      getFlashLatest(db, now),
      getDashboardData(db, sources.assets, now),
    ]);
    return { flash, data, error: null };
  } catch (err) {
    return { flash: null, data: null, error: String(err?.message || err) };
  }
}

// Post-action banner driven by the redirect's query string.
function StatusBanner({ params, cooldown }) {
  if (params.ran) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300">
        Fresh flash read below — pulled the last {FLASH_RECENT_HOURS}h.
      </div>
    );
  }
  if (params.degraded) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
        The data refreshed, but the AI read failed this time. The live snapshot below is current;
        try Flash again in a moment for the written summary.
      </div>
    );
  }
  if (params.cooldown) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
        Just ran a flash — next one available in {formatCountdown(cooldown.remainingSec)}.
      </div>
    );
  }
  if (params.error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
        Flash couldn&rsquo;t run: {params.error}
      </div>
    );
  }
  return null;
}

function TriggerCard({ cooldown }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-center sm:p-5">
      <p className="mx-auto mb-3 max-w-lg text-sm leading-relaxed text-zinc-400">
        <strong className="text-zinc-200">⚡ Flash briefing.</strong> Something just happened — a war
        headline, a hack, a sharp move? Pull fresh data and get an AI read of how the market is
        reacting <strong className="text-zinc-300">right now</strong>, weighted to the last{' '}
        {FLASH_RECENT_HOURS} hours. The snapshot below refreshes with it; your twice-daily 12h/24h
        briefing is unaffected.
      </p>
      {cooldown.active ? (
        <div className="flex flex-col items-center gap-1.5">
          <button
            disabled
            className="cursor-not-allowed rounded-full bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-500"
          >
            ⚡ Available in {formatCountdown(cooldown.remainingSec)}
          </button>
          <span className="text-xs text-zinc-600">One flash per {COOLDOWN_MIN} min · reload to refresh</span>
        </div>
      ) : (
        <form method="post" action="/api/flash" className="flex flex-col items-center gap-1.5">
          <button
            type="submit"
            className="rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400"
          >
            ⚡ Run flash briefing
          </button>
          <span className="text-xs text-zinc-600">Pulls fresh data · takes ~30–60s · one per {COOLDOWN_MIN} min</span>
        </form>
      )}
    </section>
  );
}

export default async function FlashPage({ searchParams }) {
  const now = new Date();
  const params = (await searchParams) || {};
  const { flash, data, error } = await loadFlash(now);
  const cooldown = flash?.cooldown || { active: false, remainingSec: 0 };
  const result = flash?.result || null;
  const macroEvents = upcomingMacroEvents(macroCalendar.events, now);

  // Feed the flash's 4h briefing into the shared PulseHero as its briefing.
  const flashBriefing = result
    ? { generatedAt: result.generatedAt, degraded: result.degraded, digest: result.digest }
    : null;
  const heroEmptyText = result?.degraded
    ? 'The AI read failed on the last flash — the live data below still refreshed. Run flash again for the written summary.'
    : 'No flash run yet — hit the button above for a fresh last-4h read. The live snapshot below updates with each run.';

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <SiteHeader now={now} latestTs={data?.latestTs} stale={Boolean(data?.stale)} active="/flash" />

      <div className="space-y-4">
        <TriggerCard cooldown={cooldown} />
        <StatusBanner params={params} cooldown={cooldown} />

        {!data ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p className="text-sm text-zinc-400">
              Live data is unavailable right now — try the button again in a moment.
            </p>
            {error && <p className="mt-2 text-xs text-zinc-600">{error}</p>}
          </div>
        ) : (
          <>
            <PulseHero
              briefing={flashBriefing}
              fearGreed={data.fearGreed}
              rows={data.rows}
              macroEvents={macroEvents}
              now={now}
              label={`Last ${result?.recentHours ?? FLASH_RECENT_HOURS}h · market reaction`}
              emptyText={heroEmptyText}
            />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <PositioningCard rows={data.rows} />
              <NewsCard headlines={data.headlines} now={now} />
            </div>
          </>
        )}
      </div>

      <footer className="mt-8 pb-4 text-center text-xs text-zinc-700">
        Informs, never advises. No signals, no predictions.
      </footer>
    </main>
  );
}
