// The 10-second read: market pulse sentence, F&G number, price chips.
// The full briefing (stories, positioning, learn-today) sits behind a
// native <details> so the hero stays glanceable.
import { relativeTime } from '../../lib/dashboard.js';
import { ChangeChip, TONE_TEXT } from './ui.js';

export default function PulseHero({ briefing, fearGreed, rows, now }) {
  const digest = briefing?.digest;
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500">
            <span>Today&rsquo;s briefing</span>
            {briefing?.generatedAt && (
              <span className="normal-case tracking-normal text-zinc-600">
                {relativeTime(briefing.generatedAt, now)}
              </span>
            )}
            {briefing?.degraded && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 normal-case tracking-normal text-amber-400">
                raw data only
              </span>
            )}
          </div>
          {digest?.market_pulse ? (
            <p className="text-base leading-relaxed text-zinc-100 sm:text-lg">{digest.market_pulse}</p>
          ) : (
            <p className="text-sm text-zinc-500">
              No briefing yet — the first one lands after the next digest run (07:00 / 19:00 IST).
            </p>
          )}
        </div>
        {fearGreed && (
          <div className="shrink-0 text-center">
            <div className={`text-4xl font-bold tabular-nums ${TONE_TEXT[fearGreed.tone]}`}>
              {fearGreed.value}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Fear &amp; Greed</div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((r) => (
          <span key={r.symbol} className="flex items-baseline gap-1.5 text-sm">
            <span className="font-medium text-zinc-300">{r.symbol}</span>
            <ChangeChip pct={r.change24hPct} />
          </span>
        ))}
      </div>

      {digest && (
        <details className="group mt-4 border-t border-zinc-800 pt-3">
          <summary className="cursor-pointer list-none text-sm text-sky-400 hover:text-sky-300 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Read the full briefing ↓</span>
            <span className="hidden group-open:inline">Collapse briefing ↑</span>
          </summary>
          <div className="mt-4 space-y-5 text-sm leading-relaxed">
            {digest.top_stories?.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  📰 Top stories
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
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  🌡 Sentiment
                </h3>
                <p className="text-zinc-300">{digest.sentiment_note}</p>
              </div>
            )}
            {digest.learn_today && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-indigo-400">
                  🎓 One thing to learn today
                </h3>
                <p className="text-zinc-200">{digest.learn_today}</p>
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
