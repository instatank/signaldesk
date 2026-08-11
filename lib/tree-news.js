// Tree News (news.treeofalpha.com) — the fastest crypto-native breaking-news
// feed on the owner's follow list, and the one account there that graduates
// from "link out" to a real ingested source.
//
// It is JSON, not RSS, so it needs its own fetcher rather than another entry
// in the `feeds` array. Shape, confirmed from a live response the owner pasted
// on 2026-08-11 (the sandbox cannot reach the host):
//
//   [{ _id, title, en?, source, sourceName?, url, time, symbols?, suggestions?,
//      icon?, image?, info? }, …]
//
//   time        epoch MILLISECONDS
//   en          English translation — present on exchange notices (Korean
//               Upbit announcements) and echoed verbatim on blog items
//   source      "Twitter" | "Blogs" | an exchange name ("Upbit", …)
//   sourceName  the original publisher on blog items ("COINDESK")
//   title       on blog items, prefixed with "PUBLISHER: "; on social items,
//               prefixed with "Display Name (@handle): "
//
// Three decisions shape everything below.
//
// 1. SOCIAL POSTS ARE GATED BY THE OWNER'S OWN FOLLOW LIST. Tree News relays
//    all of crypto Twitter, which includes a lot of merch giveaways. Rather
//    than invent a quality heuristic (this codebase counts, it never scores),
//    a post is kept only if its handle is already in config/follows.json —
//    curation the owner did himself, and edits in one place he already owns.
//    Everything non-social (exchange notices, blogs) comes in unfiltered:
//    an exchange halting deposits is market-moving by definition.
//
// 2. THE `source` FIELD NAMES THE ORIGINAL PUBLISHER, NOT THE RELAY. The
//    digest's conviction bar counts DISTINCT SOURCES, so a Tree News relay of
//    a CoinDesk story must collapse onto the same "CoinDesk" the RSS feed
//    writes — otherwise one story read twice looks like two independent
//    confirmations. The publisher map is derived from the configured feed
//    names, so it stays in sync with no second list to maintain.
//
// 3. DEDUPE RIDES THE EXISTING RAILS. Doc ids are already sha256 of the
//    canonical URL, and Tree News blog items carry the publisher's real URL —
//    so the same story arriving by both paths collides for free, and whichever
//    arrived FIRST wins. That is the whole point of adding this source.
import { canonicalUrl, urlHash } from './rss.js';
import { fetchJson } from './http.js';
import { shapeFollowGroups } from './follows.js';

const DEFAULT_MAX_ITEMS = 80;
const DEFAULT_MAX_TITLE_CHARS = 300;

// Hosts whose posts are gated by the follow list. Keyed on the URL rather
// than Tree News's own `source` label, so a Truth Social post is handled
// correctly no matter what that field happens to say.
const SOCIAL_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'truthsocial.com', 'www.truthsocial.com']);

// "CoinDesk" and "COINDESK" and "coin desk" are the same publisher.
function publisherKey(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Map every name we already use for a publisher onto its canonical spelling,
// so Tree News items collapse onto the RSS feed's source name instead of
// forming a near-duplicate that inflates the distinct-source count.
export function buildPublisherMap(feeds = [], followGroups = []) {
  const map = new Map();
  for (const feed of feeds) {
    const name = typeof feed?.name === 'string' ? feed.name.trim() : '';
    if (name) map.set(publisherKey(name), name);
  }
  // Follow-list display names too: "@TheBlockCo" should read as "The Block",
  // the same string the RSS feed writes.
  for (const group of followGroups) {
    for (const account of group.accounts) {
      const key = publisherKey(account.name);
      if (key && !map.has(key)) map.set(key, account.name);
    }
  }
  return map;
}

// handleLower -> the account's display name, across both platforms.
export function buildFollowAllowlist(followsConfig) {
  const allow = new Map();
  for (const group of shapeFollowGroups(followsConfig)) {
    for (const account of group.accounts) {
      allow.set(account.handle.toLowerCase(), account.name);
    }
  }
  return allow;
}

// The account a social post came from. Prefers the URL (structural) and falls
// back to the "Name (@handle):" prefix Tree News puts in the title.
export function socialHandle(rawUrl, title) {
  try {
    const u = new URL(rawUrl);
    if (SOCIAL_HOSTS.has(u.hostname.toLowerCase())) {
      const first = u.pathname.split('/').filter(Boolean)[0];
      if (first) return first.replace(/^@+/, '');
    }
  } catch {
    // fall through to the title
  }
  const match = /\(@([A-Za-z0-9_.]{1,40})\)/.exec(String(title || ''));
  return match ? match[1] : null;
}

export function isSocialUrl(rawUrl) {
  try {
    return SOCIAL_HOSTS.has(new URL(rawUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Epoch milliseconds in the live feed, but accept seconds too — a tolerant
// parser degrades on a format change instead of writing 1970 timestamps.
export function toPublishedAt(time) {
  const n = Number(time);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Prefer the English rendering, drop the publisher prefix so the title matches
// what the newsroom's own RSS feed says (that is what makes the title-level
// dedupe work), and flatten the newlines tweets are full of.
export function cleanTitle(raw, maxChars = DEFAULT_MAX_TITLE_CHARS) {
  const english = typeof raw?.en === 'string' && raw.en.trim() ? raw.en : raw?.title;
  let title = String(english || '').replace(/\s+/g, ' ').trim();
  if (!title) return '';

  const prefix = typeof raw?.sourceName === 'string' ? raw.sourceName.trim() : '';
  if (prefix && title.toUpperCase().startsWith(`${prefix.toUpperCase()}:`)) {
    title = title.slice(prefix.length + 1).trim();
  }
  if (title.length > maxChars) title = `${title.slice(0, maxChars - 1).trimEnd()}…`;
  return title;
}

// One raw item -> the same headline shape lib/rss.js produces, or null if it
// should not be ingested (gated social account, or unusable data).
export function normalizeTreeNewsItem(raw, opts = {}) {
  const {
    allowlist = new Map(),
    publishers = new Map(),
    socialFollowsOnly = true,
    relayName = 'Tree News',
    maxTitleChars = DEFAULT_MAX_TITLE_CHARS,
  } = opts;

  const title = cleanTitle(raw, maxTitleChars);
  const publishedAt = toPublishedAt(raw?.time);
  if (!title || !publishedAt) return null;

  const rawUrl = typeof raw?.url === 'string' && raw.url.trim() ? raw.url.trim() : null;

  let source;
  if (rawUrl && isSocialUrl(rawUrl)) {
    const handle = socialHandle(rawUrl, raw?.title);
    const followed = handle ? allowlist.get(handle.toLowerCase()) : null;
    // Not one of the owner's accounts: this is where the noise is filtered.
    if (!followed && socialFollowsOnly) return null;
    source = followed || (handle ? `@${handle}` : relayName);
  } else {
    const named = typeof raw?.sourceName === 'string' && raw.sourceName.trim() ? raw.sourceName : raw?.source;
    source = publishers.get(publisherKey(named)) || (typeof named === 'string' && named.trim() ? named.trim() : relayName);
  }

  return {
    // Same identity rule as RSS, so a story relayed here and published there
    // is one document, not two. Items with no URL fall back to Tree News's own
    // stable id rather than being dropped.
    id: rawUrl ? urlHash(rawUrl) : `tree-${String(raw?._id ?? `${publishedAt.getTime()}-${title.slice(0, 40)}`)}`,
    title,
    url: rawUrl ? canonicalUrl(rawUrl) : null,
    source,
    publishedAt,
    // Provenance, for debugging why a headline looks unfamiliar. Not sent to
    // Claude and not rendered — `source` is what the reader and the prompt see.
    via: relayName,
  };
}

// Fetch + normalise. Mirrors fetchAllFeeds' contract exactly: returns
// { items, errors } and NEVER throws, so one bad response degrades this
// source alone and the rest of the ingest run is untouched.
export async function fetchTreeNews(config, followsConfig, feeds = []) {
  const errors = [];
  if (!config?.url) return { items: [], errors };

  let payload;
  try {
    payload = await fetchJson(config.url, {
      headers: { 'user-agent': 'SignalDesk/1.0 (personal news reader)', accept: 'application/json' },
      timeoutMs: config.timeoutMs ?? 12_000,
    });
  } catch (err) {
    return { items: [], errors: [{ feed: config.name || 'Tree News', error: String(err?.message || err) }] };
  }

  // Tolerant: the live endpoint returns a bare array, but accept the common
  // wrapper shapes too rather than silently ingesting nothing if it changes.
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.news)
        ? payload.news
        : Array.isArray(payload?.data)
          ? payload.data
          : null;
  if (!list) {
    return { items: [], errors: [{ feed: config.name || 'Tree News', error: 'unexpected payload shape (expected an array)' }] };
  }

  const followGroups = shapeFollowGroups(followsConfig);
  const opts = {
    allowlist: buildFollowAllowlist(followsConfig),
    publishers: buildPublisherMap(feeds, followGroups),
    socialFollowsOnly: config.socialFollowsOnly !== false,
    relayName: config.name || 'Tree News',
    maxTitleChars: config.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS,
  };

  const seen = new Set();
  const items = [];
  for (const raw of list.slice(0, config.maxItems ?? DEFAULT_MAX_ITEMS)) {
    let item = null;
    try {
      item = normalizeTreeNewsItem(raw, opts);
    } catch (err) {
      errors.push({ feed: opts.relayName, error: `item skipped: ${String(err?.message || err)}` });
      continue;
    }
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { items, errors };
}
