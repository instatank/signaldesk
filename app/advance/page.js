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
