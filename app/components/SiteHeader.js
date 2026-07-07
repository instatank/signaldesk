// Shared page header: brand, the three-page nav, and the data-freshness
// note. Plain <a> links — the whole site stays zero-client-JS.
import { istDisplayDate, istTimeString } from '../../lib/dashboard.js';

const PAGES = [
  { href: '/', label: 'Dashboard' },
  { href: '/advance', label: 'Advance' },
  { href: '/archive', label: 'Archive' },
];

export default function SiteHeader({ now, latestTs = null, stale = false, active = '/' }) {
  return (
    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold tracking-tight">
          <a href="/">
            Signal<span className="text-sky-400">Desk</span>
          </a>
        </h1>
        <nav className="flex items-center gap-3 text-xs">
          {PAGES.map((p) => (
            <a
              key={p.href}
              href={p.href}
              className={
                p.href === active
                  ? 'font-semibold text-zinc-200'
                  : 'text-zinc-500 hover:text-sky-400'
              }
            >
              {p.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>{istDisplayDate(now)}</span>
        {latestTs && (
          <span className="text-zinc-600">· data as of {istTimeString(latestTs)} IST</span>
        )}
        {stale && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400">
            data may be stale
          </span>
        )}
      </div>
    </header>
  );
}
