// News as shape, not just text. Three layers, most-visual first:
// 1. Narrative pulse — what the market is talking about (topic bars)
// 2. News flow — 24h volume histogram (quiet vs erupting)
// 3. The headlines themselves — compact, chip-tagged, scannable by color
import { hourlyNewsVolume, relativeTime, topicBreakdown } from '../../lib/dashboard.js';
import { Card, Disclose, Unavailable } from './ui.js';

const VISIBLE = 5;
const FRESH_MS = 2 * 60 * 60 * 1000;

// Categorical identity colors: one hue per narrative, reused between the
// bars and the headline chips so the eye links them. Green/red stay
// reserved for bullish/bearish — except Hacks, where red means danger.
const TAG_STYLE = {
  BTC: { bar: 'bg-orange-400', chip: 'bg-orange-400/10 text-orange-300' },
  ETH: { bar: 'bg-indigo-400', chip: 'bg-indigo-400/10 text-indigo-300' },
  SOL: { bar: 'bg-violet-400', chip: 'bg-violet-400/10 text-violet-300' },
  ZEC: { bar: 'bg-yellow-400', chip: 'bg-yellow-400/10 text-yellow-300' },
  HYPE: { bar: 'bg-teal-400', chip: 'bg-teal-400/10 text-teal-300' },
  VVV: { bar: 'bg-pink-400', chip: 'bg-pink-400/10 text-pink-300' },
  security: { bar: 'bg-red-400', chip: 'bg-red-400/10 text-red-300' },
  regulation: { bar: 'bg-sky-400', chip: 'bg-sky-400/10 text-sky-300' },
  etf: { bar: 'bg-cyan-400', chip: 'bg-cyan-400/10 text-cyan-300' },
  macro: { bar: 'bg-fuchsia-400', chip: 'bg-fuchsia-400/10 text-fuchsia-300' },
  stablecoins: { bar: 'bg-lime-400', chip: 'bg-lime-400/10 text-lime-300' },
  defi: { bar: 'bg-amber-400', chip: 'bg-amber-400/10 text-amber-300' },
};
const FALLBACK_STYLE = { bar: 'bg-zinc-500', chip: 'bg-zinc-700/50 text-zinc-300' };

const CHIP_LABEL = {
  security: 'Hack',
  regulation: 'Reg',
  etf: 'ETF',
  macro: 'Macro',
  stablecoins: 'Stable',
  defi: 'DeFi',
};

function Chip({ tag }) {
  const style = (TAG_STYLE[tag] || FALLBACK_STYLE).chip;
  return (
    <span className={`rounded px-1 py-px text-[10px] font-semibold leading-none ${style}`}>
      {CHIP_LABEL[tag] || tag}
    </span>
  );
}

// Layer 1: horizontal bars — the day's narrative mix at a glance.
function NarrativePulse({ headlines, now }) {
  const { entries, maxCount } = topicBreakdown(headlines, [], now);
  if (!entries.length) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        What the market is talking about
      </h3>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate text-right text-[11px] text-zinc-400">
              {e.label}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-zinc-800/60">
              <div
                className={`h-full rounded-sm ${(TAG_STYLE[e.key] || FALLBACK_STYLE).bar}`}
                style={{ width: `${Math.max(6, Math.round((e.count / maxCount) * 100))}%`, opacity: 0.75 }}
              />
            </div>
            <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-500">
              {e.count}
              {e.rising && <span className="ml-0.5 text-sky-400" title="most coverage in the last 6h">▲</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Layer 2: 24 skinny bars of headline volume — news intensity over time.
function NewsFlow({ headlines, now }) {
  const buckets = hourlyNewsVolume(headlines, now);
  const max = Math.max(...buckets, 1);
  if (buckets.every((b) => b === 0)) return null;
  return (
    <div className="mb-4">
      <div className="flex h-8 items-end gap-px">
        {buckets.map((count, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm ${i >= 18 ? 'bg-sky-400/70' : 'bg-zinc-700'}`}
            style={{ height: `${count === 0 ? 4 : Math.max(15, (count / max) * 100)}%` }}
            title={`${count} headline${count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-widest text-zinc-600">
        <span>news flow · 24h ago</span>
        <span className="text-sky-400/80">last 6h</span>
      </div>
    </div>
  );
}

// Layer 3: the headlines — demoted to compact, chip-led rows.
function Headline({ h, now }) {
  const when = h.publishedAt || h.ingestedAt;
  const fresh = when && now - when < FRESH_MS;
  const tags = [...(h.coins || []), ...(h.topics || [])].slice(0, 3);
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <a href={h.url} target="_blank" rel="noopener noreferrer" className="group block">
        <div className="mb-1 flex items-center gap-1.5">
          {fresh && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
          {tags.map((t) => (
            <Chip key={t} tag={t} />
          ))}
          <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
            {h.source}
            {when && <> · {relativeTime(when, now)}</>}
          </span>
        </div>
        <p className="line-clamp-2 text-[13px] leading-snug text-zinc-300 group-hover:text-sky-300">
          {h.title}
        </p>
      </a>
    </li>
  );
}

export default function NewsCard({ headlines, now }) {
  const head = headlines.slice(0, VISIBLE);
  const rest = headlines.slice(VISIBLE);
  return (
    <Card title="News — last 24h" stat={headlines.length > 0 ? `${headlines.length} headlines` : null}>
      {headlines.length === 0 ? (
        <Unavailable what="News feed" />
      ) : (
        <>
          <NarrativePulse headlines={headlines} now={now} />
          <NewsFlow headlines={headlines} now={now} />
          <ul className="divide-y divide-zinc-800/70 border-t border-zinc-800 pt-1">
            {head.map((h) => (
              <Headline key={h.url || h.title} h={h} now={now} />
            ))}
          </ul>
          {rest.length > 0 && (
            <Disclose
              label={`All ${headlines.length} headlines`}
              closeLabel="Show fewer"
              className="mt-2 border-t border-zinc-800 pt-2"
            >
              <ul className="mt-2 divide-y divide-zinc-800/70">
                {rest.map((h) => (
                  <Headline key={h.url || h.title} h={h} now={now} />
                ))}
              </ul>
            </Disclose>
          )}
        </>
      )}
    </Card>
  );
}
