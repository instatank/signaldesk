// Last ~24h of deduped headlines, newest first. First 20 visible, the
// rest behind a native <details>. Fresh (<2h) headlines get a sky dot.
import { relativeTime } from '../../lib/dashboard.js';
import { Card, Unavailable } from './ui.js';

const VISIBLE = 20;
const FRESH_MS = 2 * 60 * 60 * 1000;

function Headline({ h, now }) {
  const when = h.publishedAt || h.ingestedAt;
  const fresh = when && now - when < FRESH_MS;
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <a
        href={h.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block"
      >
        <p className="text-sm leading-snug text-zinc-200 group-hover:text-sky-300">
          {fresh && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 align-middle" />}
          {h.title}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {h.source}
          {when && <> · {relativeTime(when, now)}</>}
        </p>
      </a>
    </li>
  );
}

export default function NewsCard({ headlines, now }) {
  const head = headlines.slice(0, VISIBLE);
  const rest = headlines.slice(VISIBLE);
  return (
    <Card title={`News — last 24h (${headlines.length})`}>
      {headlines.length === 0 ? (
        <Unavailable what="News feed" />
      ) : (
        <>
          <ul className="divide-y divide-zinc-800/70">
            {head.map((h) => (
              <Headline key={h.url || h.title} h={h} now={now} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group mt-2 border-t border-zinc-800 pt-2">
              <summary className="cursor-pointer list-none text-sm text-sky-400 hover:text-sky-300 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show {rest.length} more ↓</span>
                <span className="hidden group-open:inline">Show fewer ↑</span>
              </summary>
              <ul className="mt-2 divide-y divide-zinc-800/70">
                {rest.map((h) => (
                  <Headline key={h.url || h.title} h={h} now={now} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
