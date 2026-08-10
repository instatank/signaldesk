// The curated follow list (PRD §8). Reference material, not data: it never
// changes between renders, so the card starts FOLDED — one row on the
// dashboard until the owner wants it, which keeps the 10-second read intact.
//
// Nothing here is ingested. Each row is a plain link out plus the one line
// that matters for a beginner: how to read that account without being
// played by it ("every number must teach" applies to sources too).
import { Card, Explainer, Footnote } from './ui.js';

function Account({ account }) {
  return (
    <li>
      <a
        href={account.url}
        target="_blank"
        rel="noopener noreferrer"
        className="-mx-2 block rounded-lg px-2 py-2 transition-colors hover:bg-zinc-800/60"
      >
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            aria-hidden="true"
            title={account.platformLabel}
            className="shrink-0 rounded bg-zinc-800 px-1.5 py-px text-[10px] font-semibold leading-tight text-zinc-400"
          >
            {account.badge}
          </span>
          <span className="text-sm font-medium text-sky-400">{account.display}</span>
          <span className="text-xs text-zinc-500">{account.name}</span>
          {account.inDigest && (
            <span className="rounded bg-emerald-500/10 px-1 py-px text-[10px] font-semibold leading-tight text-emerald-400">
              in briefing
            </span>
          )}
        </span>
        {account.note && (
          <span className="mt-1 block text-[11px] leading-relaxed text-zinc-500">{account.note}</span>
        )}
      </a>
    </li>
  );
}

export default function FollowsCard({ groups, count }) {
  if (!groups.length) return null;

  return (
    <Card title="Follow list" stat={`${count} accounts`} open={false}>
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.name}>
            <h3 className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              {group.name}
              <Explainer label="the follow list">
                These accounts are read by you, not by SignalDesk — X charges for API access and
                scraping it breaks constantly, so the app deliberately just links out. The briefing
                stays your considered read on a 15-minute cycle; this list is the speed layer for
                the minutes in between. Edit the accounts and these notes in{' '}
                <code className="text-zinc-400">config/follows.json</code>.
              </Explainer>
            </h3>
            {group.blurb && (
              <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">{group.blurb}</p>
            )}
            <ul className="divide-y divide-zinc-800/70 border-t border-zinc-800/70">
              {group.accounts.map((account) => (
                <Account key={`${account.platform}:${account.handle}`} account={account} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Footnote>
        Every post here is an opinion or an unverified first report — never data. Speed cuts both
        ways: the fastest accounts are the ones most often wrong for the first ten minutes. Let the
        briefing, funding and your chart decide; let these tell you when to go look.
      </Footnote>
    </Card>
  );
}
