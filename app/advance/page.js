// The Advance page: free-tier depth beyond the three core streams —
// crowd positioning, spot-book depth, money flows, options, and 30-day
// character. Deliberately a separate page so the main dashboard keeps
// its 10-second read; same server-only, zero-client-JS contract.
import sources from '../../config/sources.json';
import { isStale } from '../../lib/dashboard.js';
import {
  getAdvancedData,
  shapeLongShort,
  shapeDepth,
  shapeStables,
  shapeOptions,
  shapeRollup,
} from '../../lib/advanced.js';
import SiteHeader from '../components/SiteHeader.js';
import { CrowdCard, DepthCard, FlowsCard, OptionsCard, CharacterCard } from '../components/AdvanceCards.js';
import { GUIDE } from '../components/advanceGuide.js';
import { Chevron, ROW_TAB } from '../components/ui.js';

export const revalidate = 300;

export const metadata = { title: 'SignalDesk — Advance' };

async function loadData() {
  try {
    const { getDb } = await import('../../lib/firestore.js');
    return { data: await getAdvancedData(getDb()), error: null };
  } catch (err) {
    return { data: null, error: String(err?.message || err) };
  }
}

// One tap for the whole page's theory. Every card also carries a two-line
// footnote, so this is the "go deeper" layer rather than the only place
// the stats are explained. Same source text as the cards' ⓘ popovers.
function HowToRead() {
  return (
    <details className="group/g mb-4 rounded-2xl border border-zinc-800 bg-zinc-900">
      <summary className={`${ROW_TAB} mx-0 rounded-2xl px-4 py-3 text-zinc-300 sm:px-5`}>
        <span>
          <span className="font-semibold">📖 How to read this page</span>
          <span className="ml-2 text-xs text-zinc-500">
            what each stat means, and where it lies to you
          </span>
        </span>
        <Chevron className="group-open/g:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-zinc-800 px-4 py-4 text-sm leading-relaxed text-zinc-400 sm:px-5">
        <p className="text-zinc-500">
          These are second-layer stats — they add context to the main dashboard, they don&rsquo;t
          replace it. None of them is a signal on its own; each is most useful when it agrees or
          disagrees with what price and funding are already telling you.
        </p>
        {GUIDE.map((g) => (
          <div key={g.key} className="border-l-2 border-zinc-800 pl-3">
            {g.body}
          </div>
        ))}
      </div>
    </details>
  );
}

export default async function AdvancePage() {
  const now = new Date();
  const { data, error } = await loadData();

  const crowd = data ? shapeLongShort(data.longShort, sources.assets) : null;
  const depth = data ? shapeDepth(data.depth, sources.assets) : null;
  const flows = data ? shapeStables(data.stables) : null;
  const options = data ? shapeOptions(data.options, data.rollup) : null;
  const character = data ? shapeRollup(data.rollup, sources.assets) : null;

  // The 15-min sections drive the header's freshness note.
  const latestTs = crowd?.ts || depth?.ts || flows?.ts || null;
  const empty = !crowd && !depth && !flows && !options && !character;

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <SiteHeader now={now} latestTs={latestTs} stale={Boolean(latestTs) && isStale(latestTs, now)} active="/advance" />

      <HowToRead />

      {empty ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-sm text-zinc-400">
            No advanced data yet — it starts accumulating with the next ingest run (every 15
            minutes; options and daily stats within the hour).
          </p>
          {error && <p className="mt-2 text-xs text-zinc-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <CrowdCard crowd={crowd} now={now} />
            <DepthCard depth={depth} now={now} />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <FlowsCard flows={flows} now={now} />
            <OptionsCard options={options} now={now} />
          </div>
          <CharacterCard character={character} now={now} />
        </div>
      )}

      <footer className="mt-8 space-y-1 pb-4 text-center text-xs text-zinc-700">
        <p>Informs, never advises. No signals, no predictions.</p>
        <p>
          Not here (no free source): liquidations & ETF flows (Coinglass, paid), exchange netflows
          (CryptoQuant, no free API), whale alerts (paid).
        </p>
      </footer>
    </main>
  );
}
