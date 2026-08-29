// Digest archive (PRD §6 P1): every past briefing, newest first — a
// scrollable learning record. The pulse line is always visible; the full
// briefing sits behind the standard expand.
import { getDigestArchive, istDisplayDate, istTimeString } from '../../lib/dashboard.js';
import BriefingBody from '../components/BriefingBody.js';
import SiteHeader from '../components/SiteHeader.js';
import { Disclose } from '../components/ui.js';

export const revalidate = 900;

export const metadata = { title: 'SignalDesk — Archive' };

async function loadEntries() {
  try {
    const { getDb } = await import('../../lib/firestore.js');
    return { entries: await getDigestArchive(getDb()), error: null };
  } catch (err) {
    return { entries: null, error: String(err?.message || err) };
  }
}

export default async function ArchivePage() {
  const now = new Date();
  const { entries, error } = await loadEntries();

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <SiteHeader now={now} active="/archive" />

      {!entries || entries.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No briefings stored yet — the archive fills in after the next digest run (07:00 IST).
          </p>
          {error && <p className="mt-2 text-xs text-zinc-600">{error}</p>}
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-100">
                  {e.generatedAt ? istDisplayDate(e.generatedAt) : e.id}
                </span>
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>
                    {e.slot === 'evening' ? '🌆 evening' : '☀️ morning'}
                    {e.generatedAt && ` · ${istTimeString(e.generatedAt)} IST`}
                  </span>
                  {e.degraded && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400">
                      raw data only
                    </span>
                  )}
                </span>
              </div>
              {e.digest?.market_pulse ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">{e.digest.market_pulse}</p>
                  {e.digest.narrative?.headline && (
                    <p className="mt-1 text-sm text-zinc-500">🧭 {e.digest.narrative.headline}</p>
                  )}
                  <Disclose label="Full briefing" className="mt-2.5 border-t border-zinc-800 pt-2">
                    <BriefingBody digest={e.digest} className="mt-3" />
                  </Disclose>
                </>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">
                  The AI summary failed this run — the raw-data digest went to Telegram instead.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-8 pb-4 text-center text-xs text-zinc-700">
        Informs, never advises. No signals, no predictions.
      </footer>
    </main>
  );
}
