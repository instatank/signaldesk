// The full briefing, rendered once and reused by the dashboard hero, the
// flash page and the archive — they were drifting apart as the digest
// shape changed, so there is now exactly one renderer.
//
// Shape follows lib/claude.js: a `narrative` block (the synthesis), then
// the stories it was built from, what to watch, and the learn card.
// Deliberately absent: per-coin funding/OI prose and a sentiment
// paragraph — the Positioning card and the hero's F&G block already own
// those. Digests stored before this change still carry `positioning` /
// `sentiment_note`, so the archive keeps rendering them when present.

const CONVICTION = {
  high: { label: 'high conviction', cls: 'bg-emerald-500/10 text-emerald-400' },
  medium: { label: 'medium conviction', cls: 'bg-amber-500/10 text-amber-400' },
  low: { label: 'low conviction', cls: 'bg-zinc-700/40 text-zinc-400' },
};

const CATEGORY_CLS = {
  macro: 'bg-violet-500/10 text-violet-300',
  regulatory: 'bg-sky-500/10 text-sky-300',
  flows: 'bg-emerald-500/10 text-emerald-300',
  protocol: 'bg-indigo-500/10 text-indigo-300',
  security: 'bg-red-500/10 text-red-300',
  'market-structure': 'bg-amber-500/10 text-amber-300',
};

const IMPACT_DOT = { high: 'text-red-400', medium: 'text-amber-400', low: 'text-zinc-600' };

function SectionTitle({ children, className = 'text-zinc-500' }) {
  return (
    <h3 className={`mb-2 text-xs font-semibold uppercase tracking-widest ${className}`}>
      {children}
    </h3>
  );
}

function Narrative({ n }) {
  const conviction = CONVICTION[n.conviction];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-800/25 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {n.headline && (
          <p className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">🧭 {n.headline}</p>
        )}
        {conviction && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${conviction.cls}`}
          >
            {conviction.label}
          </span>
        )}
      </div>
      {n.synthesis && <p className="mt-2 text-zinc-300">{n.synthesis}</p>}
      {n.market_reaction && (
        <p className="mt-3 border-l-2 border-sky-500/40 pl-2.5 text-xs text-zinc-400">
          <span className="font-medium text-zinc-300">Market check.</span> {n.market_reaction}
        </p>
      )}
      {n.tension && (
        <p className="mt-1.5 border-l-2 border-amber-500/40 pl-2.5 text-xs text-zinc-400">
          <span className="font-medium text-zinc-300">Counterpoint.</span> {n.tension}
        </p>
      )}
    </div>
  );
}

function Story({ s, i }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-bold tabular-nums text-zinc-400">
        {i + 1}
      </span>
      <div className="min-w-0">
        <p className="text-zinc-200">
          {s.summary} <span className="text-zinc-500">({s.source})</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {s.category && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                CATEGORY_CLS[s.category] || 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {s.category}
            </span>
          )}
          {s.impact && (
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              <span className={IMPACT_DOT[s.impact] || 'text-zinc-600'}>●</span> {s.impact} impact
            </span>
          )}
        </div>
        <p className="mt-1 border-l-2 border-sky-500/40 pl-2 text-xs text-zinc-400">
          {s.why_it_matters}
        </p>
      </div>
    </li>
  );
}

export default function BriefingBody({ digest, className = '' }) {
  if (!digest) return null;
  return (
    <div className={`space-y-5 text-sm leading-relaxed ${className}`}>
      {digest.narrative && <Narrative n={digest.narrative} />}

      {digest.top_stories?.length > 0 && (
        <div>
          <SectionTitle>📰 What moved the tape</SectionTitle>
          <ol className="space-y-3">
            {digest.top_stories.slice(0, 5).map((s, i) => (
              <Story key={i} s={s} i={i} />
            ))}
          </ol>
        </div>
      )}

      {digest.watch_next?.length > 0 && (
        <div>
          <SectionTitle>👀 What to watch next</SectionTitle>
          <ul className="space-y-1">
            {digest.watch_next.slice(0, 3).map((w, i) => (
              <li key={i} className="flex gap-2 text-zinc-300">
                <span className="text-zinc-600">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Legacy shape — kept so archived briefings still render in full. */}
      {digest.positioning?.length > 0 && (
        <div>
          <SectionTitle>📊 Positioning</SectionTitle>
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
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <SectionTitle className="text-indigo-400">🎓 One thing to learn today</SectionTitle>
          <p className="text-zinc-200">{digest.learn_today}</p>
        </div>
      )}
    </div>
  );
}
