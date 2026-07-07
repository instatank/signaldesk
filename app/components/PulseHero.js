// The 10-second read: market pulse sentence, the Fear & Greed block
// (number + 30-day sparkline — this IS the sentiment card now), a price
// ticker row, and upcoming macro-event chips (FOMC/CPI within a week).
// The full briefing sits behind a native <details>.
import { relativeTime } from '../../lib/dashboard.js';
import { formatEventDates } from '../../lib/macro.js';
import { ChangeChip, Disclose, Explainer, Sparkline, TONE_TEXT } from './ui.js';

const FNG_STROKES = {
  red: '#f87171',
  amber: '#fbbf24',
  gray: '#a1a1aa',
  lime: '#a3e635',
  green: '#34d399',
};

const FNG_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Fear &amp; Greed — the crowd&rsquo;s mood, 0–100</p>
    <p>
      Blends volatility, volume, social buzz and dominance into one number. The beginner lesson it
      teaches: sentiment extremes are contrarian. Historically, extreme fear (&lt;20) marked better
      buying zones than selling zones, and extreme greed (&gt;80) is when to be careful, not FOMO.
    </p>
  </>
);

// Compact price so six tickers fit one row: $109,432 → $109.4K.
function compactPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 2 : 4 })}`;
}

// Mobile: a slim horizontal row under the pulse sentence. Desktop: the
// centered block on the hero's right.
function FearGreedBlock({ fearGreed }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-zinc-800 pt-3 sm:block sm:border-none sm:pt-0 sm:text-center">
      <div>
        <div className={`text-5xl font-bold ${TONE_TEXT[fearGreed.tone]}`}>{fearGreed.value}</div>
        <div className="mt-0.5 text-xs font-medium text-zinc-300">{fearGreed.classification}</div>
      </div>
      <div className="w-32 sm:mt-1.5 sm:w-auto">
        {fearGreed.history.length >= 2 && (
          <div className="sm:mx-auto sm:w-28">
            <Sparkline
              values={fearGreed.history}
              stroke={FNG_STROKES[fearGreed.tone]}
              extremes={{ low: 20, high: 80 }}
              height={28}
              className="h-7 w-full"
              label="Fear and Greed, 30-day trend"
            />
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px] uppercase tracking-widest text-zinc-500">
          <span>Fear &amp; Greed · 30d</span>
          <Explainer label="Fear and Greed index">
            {FNG_EXPLAINER}
            <p className="mt-2 border-t border-zinc-700 pt-2 text-zinc-400">{fearGreed.guidance}</p>
          </Explainer>
        </div>
      </div>
    </div>
  );
}

export default function PulseHero({ briefing, fearGreed, rows, macroEvents = [], now }) {
  const digest = briefing?.digest;
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
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
        {fearGreed && <FearGreedBlock fearGreed={fearGreed} />}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <span key={r.symbol} className="flex items-baseline gap-1.5 text-sm">
            <span className="font-medium text-zinc-300">{r.symbol}</span>
            {r.price != null && (
              <span className="tabular-nums text-zinc-500">{compactPrice(r.price)}</span>
            )}
            <ChangeChip pct={r.change24hPct} />
          </span>
        ))}
      </div>

      {macroEvents.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-zinc-600">📅</span>
          {macroEvents.map((e) => (
            <span
              key={`${e.kind}-${e.date}`}
              title={e.daysAway === 0 ? `${e.name} — today` : `${e.name} — in ${e.daysAway}d`}
              className={`rounded-full px-2 py-0.5 font-medium ${
                e.daysAway <= 1 ? 'bg-violet-500/15 text-violet-300' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {e.kind === 'fomc' ? 'FOMC' : 'CPI'} {formatEventDates(e)}
            </span>
          ))}
          <Explainer label="macro events">
            <p className="mb-1 font-medium text-zinc-100">Macro events ahead</p>
            <p>
              Scheduled US macro releases within the next week. FOMC (rate decisions) and CPI
              (inflation prints) are the two events that most reliably move crypto — expect
              positioning to get cautious into them and volatility around the release. Awareness
              only: knowing the date is the edge, guessing the outcome is not.
            </p>
          </Explainer>
        </div>
      )}

      {digest && (
        <Disclose
          label="Read the full briefing"
          closeLabel="Collapse briefing"
          className="mt-4 border-t border-zinc-800 pt-3"
        >
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
        </Disclose>
      )}
    </section>
  );
}
