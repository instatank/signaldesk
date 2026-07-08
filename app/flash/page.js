// The Flash page: an on-demand, last-4h market-reaction briefing for when
// something just happened and the owner wants to read the market now, without
// waiting for the 07:00/19:00 digest. One button, one result, same visual
// language as the rest of the site.
//
// Zero client JS, like every other page: the trigger is a plain HTML form
// that POSTs to /api/flash and gets 303-redirected back here. During the
// 10-minute cooldown the button is server-rendered disabled with a static
// "available in ~Xm" label (reload to refresh the countdown — no ticking JS).
import { FLASH_RECENT_HOURS, FLASH_COOLDOWN_MS, getFlashLatest, formatCountdown } from '../../lib/flash.js';
import { istTimeString, relativeTime } from '../../lib/dashboard.js';
import SiteHeader from '../components/SiteHeader.js';

// On-demand: never cache. Every load reflects the current cooldown + result.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = { title: 'SignalDesk — Flash' };

const COOLDOWN_MIN = Math.round(FLASH_COOLDOWN_MS / 60000);

async function loadFlash(now) {
  try {
    const { getDb } = await import('../../lib/firestore.js');
    return { flash: await getFlashLatest(getDb(), now), error: null };
  } catch (err) {
    return { flash: null, error: String(err?.message || err) };
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
        The data refreshed, but the AI read failed this time. The numbers on the Dashboard and
        Advance pages are current; try Flash again in a moment for the written summary.
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

function TriggerButton({ cooldown }) {
  if (cooldown.active) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <button
          disabled
          className="cursor-not-allowed rounded-full bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-500"
        >
          ⚡ Available in {formatCountdown(cooldown.remainingSec)}
        </button>
        <span className="text-xs text-zinc-600">One flash per {COOLDOWN_MIN} min · reload to refresh</span>
      </div>
    );
  }
  return (
    <form method="post" action="/api/flash" className="flex flex-col items-center gap-1.5">
      <button
        type="submit"
        className="rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400"
      >
        ⚡ Run flash briefing
      </button>
      <span className="text-xs text-zinc-600">Pulls fresh data · takes ~30–60s · one per {COOLDOWN_MIN} min</span>
    </form>
  );
}

function ResultBody({ digest }) {
  return (
    <div className="mt-4 space-y-5 text-sm leading-relaxed">
      {digest.top_stories?.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            📰 What&rsquo;s driving it
          </h3>
          <ol className="space-y-3">
            {digest.top_stories.slice(0, 5).map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-bold tabular-nums text-zinc-400">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-zinc-200">
                    {s.summary} <span className="text-zinc-500">({s.source})</span>
                  </p>
                  <p className="mt-1 border-l-2 border-sky-500/40 pl-2 text-xs text-zinc-400">
                    {s.why_it_matters}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {digest.positioning?.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            📊 Positioning
          </h3>
          <ul className="space-y-1">
            {digest.positioning.map((p) => (
              <li key={p.asset} className="text-zinc-300">
                <span className="font-medium text-zinc-100">{p.asset}</span>: {p.read}
              </li>
            ))}
          </ul>
        </div>
      )}
      {digest.sentiment_note && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">🌡 Sentiment</h3>
          <p className="text-zinc-300">{digest.sentiment_note}</p>
        </div>
      )}
      {digest.learn_today && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-indigo-400">
            🎓 One thing to learn
          </h3>
          <p className="text-zinc-200">{digest.learn_today}</p>
        </div>
      )}
    </div>
  );
}

export default async function FlashPage({ searchParams }) {
  const now = new Date();
  const params = (await searchParams) || {};
  const { flash, error } = await loadFlash(now);
  const cooldown = flash?.cooldown || { active: false, remainingSec: 0 };
  const result = flash?.result || null;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <SiteHeader now={now} active="/flash" />

      <div className="space-y-4">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-center sm:p-6">
          <h2 className="text-lg font-semibold text-zinc-100">⚡ Flash briefing</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-zinc-400">
            Something just happened — a war headline, a hack, a sharp move? Run a flash to pull fresh
            data and get an AI read of how the market is reacting <strong className="text-zinc-300">right
            now</strong>, weighted to the last {FLASH_RECENT_HOURS} hours. Your twice-daily 12h/24h
            briefing is unaffected.
          </p>
          <div className="mt-4 flex justify-center">
            <TriggerButton cooldown={cooldown} />
          </div>
        </section>

        <StatusBanner params={params} cooldown={cooldown} />

        {result ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-zinc-500">
              <span>Last {result.recentHours}h · market reaction</span>
              {result.generatedAt && (
                <span className="normal-case tracking-normal text-zinc-600">
                  {relativeTime(result.generatedAt, now)}
                  {` · ${istTimeString(result.generatedAt)} IST`}
                </span>
              )}
              {result.degraded && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 normal-case tracking-normal text-amber-400">
                  raw data only
                </span>
              )}
            </div>
            {result.digest?.market_pulse ? (
              <>
                <p className="text-base leading-relaxed text-zinc-100 sm:text-lg">
                  {result.digest.market_pulse}
                </p>
                <ResultBody digest={result.digest} />
              </>
            ) : (
              <p className="text-sm text-zinc-500">
                The AI read failed on the last run — the underlying data still refreshed, so the
                Dashboard and Advance pages are current. Run Flash again for the written summary.
              </p>
            )}
          </section>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p className="text-sm text-zinc-400">
              No flash yet. Hit the button above whenever the market gets interesting.
            </p>
            {error && <p className="mt-2 text-xs text-zinc-600">{error}</p>}
          </div>
        )}
      </div>

      <footer className="mt-8 pb-4 text-center text-xs text-zinc-700">
        Informs, never advises. No signals, no predictions.
      </footer>
    </main>
  );
}
