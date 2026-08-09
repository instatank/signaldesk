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
// The trigger is a plain HTML form that POSTs to /api/flash and gets
// 303-redirected back here — it works with JS off, and the 10-minute
// cooldown is enforced server-side in a Firestore transaction regardless.
//
// This page carries the app's only other inline script (see TICK_SCRIPT
// below), for the two things a static render genuinely cannot do: show a
// "running" state during the ~30-60s wait, and tick the cooldown down live.
// Both are cosmetic — nothing breaks if the script never runs.
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
        Just ran a flash — next one available in{' '}
        <span className="sd-countdown tabular-nums">{formatCountdown(cooldown.remainingSec)}</span>.
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

const READY_LABEL = '⚡ Run flash briefing';
const READY_NOTE = `Pulls fresh data · takes ~30–60s · one per ${COOLDOWN_MIN} min`;

// One button in one form for both states — `disabled:` variants carry the
// look, so the tick script only ever flips `disabled` and the label. The
// server still enforces the cooldown; this is presentation only.
const BTN_CLASS =
  'rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none disabled:hover:bg-zinc-800';

// Rendered as raw HTML so the inline `onsubmit` reaches the boot script
// without a client component — same pattern as the header's theme toggle.
function TriggerForm({ cooldown }) {
  const until = cooldown.active ? Date.now() + cooldown.remainingSec * 1000 : 0;
  const label = cooldown.active
    ? `⚡ Available in ${formatCountdown(cooldown.remainingSec)}`
    : READY_LABEL;
  const note = cooldown.active ? `One flash per ${COOLDOWN_MIN} min` : READY_NOTE;
  const html =
    `<form method="post" action="/api/flash" class="flex flex-col items-center gap-1.5"` +
    ` onsubmit="return window.__sdFlashRun&&window.__sdFlashRun(this)">` +
    `<button type="submit" id="sd-flash-btn" data-until="${until}"${cooldown.active ? ' disabled' : ''}` +
    ` class="${BTN_CLASS}">${label}</button>` +
    `<span id="sd-flash-note" class="text-xs text-zinc-600">${note}</span>` +
    `</form>`;
  return <span className="contents" dangerouslySetInnerHTML={{ __html: html }} />;
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
      <TriggerForm cooldown={cooldown} />
    </section>
  );
}

// The page's only client JS — a few hundred bytes inline, no bundle, no
// hydration. Two jobs the server can't do, both purely cosmetic:
//   1. Swap the button to a "running" state on submit, so the ~30-60s wait
//      doesn't look like a dead click.
//   2. Tick the cooldown down live and re-enable the button at zero,
//      instead of a frozen number that only updates on reload.
// If this script never runs, the page still works exactly as before.
const TICK_SCRIPT = `(function(){
  var B='sd-flash-btn',N='sd-flash-note',T=${JSON.stringify(READY_LABEL)},R=${JSON.stringify(READY_NOTE)};
  function btn(){return document.getElementById(B)}
  function note(){return document.getElementById(N)}
  function pad(n){return (n<10?'0':'')+n}
  function tick(){
    var b=btn(); if(!b) return;
    var until=+b.getAttribute('data-until')||0;
    if(!until) return;
    var s=Math.round((until-Date.now())/1000);
    if(s<=0){
      b.setAttribute('data-until','0'); b.disabled=false; b.textContent=T;
      var n=note(); if(n) n.textContent=R;
      document.querySelectorAll('.sd-countdown').forEach(function(el){el.textContent='now'});
      return;
    }
    var txt=Math.floor(s/60)+':'+pad(s%60);
    b.textContent='⚡ Available in '+txt;
    document.querySelectorAll('.sd-countdown').forEach(function(el){el.textContent=txt});
  }
  window.__sdFlashRun=function(f){
    if(f.dataset.busy) return false;      // guard the double-click
    f.dataset.busy='1';
    var b=btn();
    if(b){ b.setAttribute('aria-busy','true'); b.classList.add('pointer-events-none','opacity-75');
           b.textContent='⏳ Running… pulling fresh data'; }
    var n=note(); if(n) n.textContent='Takes ~30–60s. Keep this tab open.';
    return true;
  };
  // Back/forward cache can restore the "running" state — reset it.
  window.addEventListener('pageshow',function(e){if(e.persisted) location.reload()});
  tick(); setInterval(tick,1000);
})();`;

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

      <script dangerouslySetInnerHTML={{ __html: TICK_SCRIPT }} />
    </main>
  );
}
