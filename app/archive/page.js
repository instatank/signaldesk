// Digest archive (PRD §6 P1): every past briefing, newest first — a
// scrollable learning record. The pulse line is always visible; the full
// briefing sits behind the standard expand.
import { getDigestArchive, istDisplayDate, istTimeString } from '../../lib/dashboard.js';
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

function FullBriefing({ digest }) {
  return (
    <div className="mt-3 space-y-4 text-sm leading-relaxed">
      {digest.top_stories?.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">📰 Top stories</h3>
          <ol className="list-decimal space-y-2 pl-5">
            {digest.top_stories.slice(0, 5).map((s, i) => (
              <li key={i} className="text-zinc-300">
                {s.summary} <span className="text-zinc-500">({s.source})</span>
                <p className="mt-0.5 text-xs text-zinc-500">{s.why_it_matters}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {digest.positioning?.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500">📊 Positioning</h3>
          <ul className="space-y-1">
            {digest.positioning.map((p) => (
              <li key={p.asset} className="text-zinc-300">
                <span className="font-medium text-zinc-100">{p.asset}</span>: {p.read}
              </li>
            ))}
          </ul>
        </div>
      )}
      {digest.sentiment_note && <p className="text-zinc-300">🌡 {digest.sentiment_note}</p>}
      {digest.learn_today && (
        <p className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 text-zinc-200">
          🎓 {digest.learn_today}
        </p>
      )}
    </div>
  );
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
            No briefings stored yet — the archive fills in after the next digest run (07:00 /
            19:00 IST).
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
                  <Disclose label="Full briefing" className="mt-2.5 border-t border-zinc-800 pt-2">
                    <FullBriefing digest={e.digest} />
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
