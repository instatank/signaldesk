// News as shape, not just text. Three layers, most-visual first:
// 1. Narrative pulse — what the market is talking about (topic bars)
// 2. News flow — 24h volume histogram (quiet vs erupting)
// 3. The headlines themselves — compact, chip-tagged, scannable by color
//
// The narrative-pulse bars double as a filter: click a bar to narrow the
// headline list to just that coin/theme. This stays true to the "zero
// client JS" rule — it's a native radio group (one hidden <input> per bar
// plus an "all" default) driven entirely by a generated `:checked ~`
// stylesheet. No hydration, no event handlers, works with JS disabled.
import { hourlyNewsVolume, relativeTime, topicBreakdown } from '../../lib/dashboard.js';
import { Card, Unavailable } from './ui.js';

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

// Layer 1: horizontal bars — the day's narrative mix at a glance. Each row
// is a <label> tied to its filter radio, so clicking a bar filters the
// list below. `entries`/`maxCount` come from the parent (computed once).
function NarrativePulse({ entries, maxCount }) {
  return (
    <div className="np mb-4">
      <h3 className="mb-2 flex items-baseline justify-between gap-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        <span>What the market is talking about</span>
        <span className="font-normal normal-case tracking-normal text-zinc-700">
          tap to filter · tap again to clear
        </span>
      </h3>
      <ul className="space-y-0.5">
        {entries.map((e) => (
          <li
            key={e.key}
            className={`nprow nprow-${e.key} relative flex items-center gap-2 rounded px-1 -mx-1 py-1 transition hover:bg-zinc-800/40`}
          >
            <span className="w-20 shrink-0 truncate text-right text-[11px] text-zinc-400">
              {e.label}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-zinc-800/60">
              <div
                className={`npbar h-full rounded-sm ${(TAG_STYLE[e.key] || FALLBACK_STYLE).bar}`}
                style={{ width: `${Math.max(6, Math.round((e.count / maxCount) * 100))}%`, opacity: 0.75 }}
              />
            </div>
            <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-500">
              {e.count}
              {e.rising && <span className="ml-0.5 text-sky-400" title="most coverage in the last 6h">▲</span>}
            </span>
            {/* Two stacked full-row labels. "select" is live by default; once
                this bar is the active filter the generated CSS swaps in the
                "clear" layer, so a second tap on the same bar toggles it off. */}
            <label
              htmlFor={`nf-${e.key}`}
              aria-label={`Show only ${e.label} headlines`}
              title={`Show only ${e.label} headlines`}
              className={`npsel npsel-${e.key} absolute inset-0 cursor-pointer`}
            />
            <label
              htmlFor="nf-all"
              aria-label={`Clear ${e.label} filter`}
              title="Clear filter"
              className={`npdesel npdesel-${e.key} absolute inset-0 cursor-pointer`}
            />
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

// Layer 3: the headlines — demoted to compact, chip-led rows. The <li>
// carries a `t-<tag>` class for every coin/theme it matches (not just the
// three shown chips) so the CSS filter can hide/show it precisely.
function Headline({ h, now }) {
  const when = h.publishedAt || h.ingestedAt;
  const fresh = when && now - when < FRESH_MS;
  const allTags = [...(h.coins || []), ...(h.topics || [])];
  const tags = allTags.slice(0, 3);
  const tagClasses = allTags.map((t) => `t-${t}`).join(' ');
  return (
    <li className={`nh py-2 first:pt-0 last:pb-0 ${tagClasses}`}>
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

// Build the generated stylesheet that wires the radio group to the list.
// One block per filter key plus the "all"/"every" defaults. All selectors
// hang off `#nf-*:checked ~ …`, so the radios must be siblings of `.np`,
// `.nb`, and `.nfoot` inside the filter container.
function filterCss(keys) {
  const rules = [
    // Default view ("all"): only the first VISIBLE headlines.
    `#nf-all:checked ~ .nb .nh:nth-child(n+${VISIBLE + 1}){display:none}`,
    // Footer controls hidden until their state is active.
    `.nfoot .ctl-clear,.nfoot .ctl-less,.nfoot .fi{display:none}`,
    // "Everything" state: show all, swap the footer toggle.
    `#nf-every:checked ~ .nfoot .ctl-more{display:none}`,
    `#nf-every:checked ~ .nfoot .ctl-less{display:inline-flex}`,
    // Deselect layer is dormant until its bar becomes the active filter.
    `.np .npdesel{display:none}`,
  ];
  for (const k of keys) {
    // Category state: show all matching headlines, hide the rest.
    rules.push(`#nf-${k}:checked ~ .nb .nh:not(.t-${k}){display:none}`);
    // Highlight the active bar…
    rules.push(
      `#nf-${k}:checked ~ .np .nprow-${k}{background-color:rgb(39 39 42 / .7);box-shadow:inset 0 0 0 1px rgb(63 63 70)}`
    );
    rules.push(`#nf-${k}:checked ~ .np .nprow-${k} .npbar{opacity:1}`);
    // …and dim every other bar back so the active one clearly stands out.
    rules.push(`#nf-${k}:checked ~ .np .nprow:not(.nprow-${k}){opacity:.35}`);
    // Toggle-off: once active, the "clear" overlay takes over this bar's
    // clicks (points at nf-all), so tapping it again removes the filter.
    rules.push(`#nf-${k}:checked ~ .np .npsel-${k}{pointer-events:none}`);
    rules.push(`#nf-${k}:checked ~ .np .npdesel-${k}{display:block}`);
    // Swap footer to the clear control and reveal this filter's label.
    rules.push(`#nf-${k}:checked ~ .nfoot .ctl-more{display:none}`);
    rules.push(`#nf-${k}:checked ~ .nfoot .ctl-clear{display:inline-flex}`);
    rules.push(`#nf-${k}:checked ~ .nfoot .fi-${k}{display:inline}`);
  }
  return rules.join('\n');
}

export default function NewsCard({ headlines, now }) {
  const { entries, maxCount } = topicBreakdown(headlines, [], now);
  const keys = entries.map((e) => e.key);
  const canFilter = keys.length > 0 && headlines.length > 0;

  return (
    <Card title="News — last 24h" stat={headlines.length > 0 ? `${headlines.length} headlines` : null}>
      {headlines.length === 0 ? (
        <Unavailable what="News feed" />
      ) : !canFilter ? (
        // No classifiable narratives to filter on — plain list, no controls.
        <>
          <NewsFlow headlines={headlines} now={now} />
          <ul className="divide-y divide-zinc-800/70 border-t border-zinc-800 pt-1">
            {headlines.map((h) => (
              <Headline key={h.url || h.title} h={h} now={now} />
            ))}
          </ul>
        </>
      ) : (
        <div className="relative">
          {/* Hidden radio group. sr-only (not `hidden`) keeps them keyboard-
              reachable while the labels do the visible work. */}
          <input type="radio" name="nf" id="nf-all" defaultChecked className="peer sr-only" aria-label="Show recent headlines" />
          <input type="radio" name="nf" id="nf-every" className="sr-only" aria-label="Show all headlines" />
          {keys.map((k) => (
            <input key={k} type="radio" name="nf" id={`nf-${k}`} className="sr-only" aria-label={`Filter headlines by ${k}`} />
          ))}

          <NarrativePulse entries={entries} maxCount={maxCount} />
          <NewsFlow headlines={headlines} now={now} />

          <ul className="nb divide-y divide-zinc-800/70 border-t border-zinc-800 pt-1">
            {headlines.map((h) => (
              <Headline key={h.url || h.title} h={h} now={now} />
            ))}
          </ul>

          <div className="nfoot mt-2 flex items-center gap-3 border-t border-zinc-800 pt-2 text-sm">
            {headlines.length > VISIBLE && (
              <label htmlFor="nf-every" className="ctl-more cursor-pointer text-sky-400 hover:text-sky-300">
                All {headlines.length} headlines ↓
              </label>
            )}
            <label htmlFor="nf-all" className="ctl-less cursor-pointer text-sky-400 hover:text-sky-300">
              Show fewer ↑
            </label>
            <label htmlFor="nf-all" className="ctl-clear cursor-pointer items-center gap-1.5 text-zinc-400 hover:text-zinc-200">
              <span className="text-zinc-500">Showing</span>
              {entries.map((e) => (
                <span key={e.key} className={`fi fi-${e.key} font-medium text-zinc-200`}>
                  {e.label}
                </span>
              ))}
              <span className="text-xs text-sky-400">✕ clear</span>
            </label>
          </div>

          <style dangerouslySetInnerHTML={{ __html: filterCss(keys) }} />
        </div>
      )}
    </Card>
  );
}
