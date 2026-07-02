// RSS ingestion. Feed URLs live in config/sources.json, not code.
// Per-feed failures are logged and skipped — one dead feed must never
// kill the run. Headlines are deduped by a hash of the canonical URL.
import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { fetchText } from './http.js';

const parser = new Parser();

// Strip tracking params, fragments and trailing slashes so the same story
// republished with different utm tags hashes to the same doc id.
export function canonicalUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const params = [...u.searchParams.keys()];
    for (const key of params) {
      if (/^(utm_|ref$|ref_|source$|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl;
  }
}

export function urlHash(rawUrl) {
  return crypto.createHash('sha256').update(canonicalUrl(rawUrl)).digest('hex');
}

async function fetchFeed(feed) {
  const xml = await fetchText(feed.url, {
    headers: {
      'user-agent': 'SignalDesk/1.0 (personal RSS reader)',
      accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    timeoutMs: 12_000,
  });
  const parsed = await parser.parseString(xml);
  return (parsed.items || [])
    .filter((item) => item.link && item.title)
    .map((item) => ({
      id: urlHash(item.link),
      title: item.title.trim(),
      url: canonicalUrl(item.link),
      source: feed.name,
      publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
    }));
}

// Returns { items, errors }. Never throws for individual feed failures.
export async function fetchAllFeeds(feeds) {
  const results = await Promise.allSettled(feeds.map((f) => fetchFeed(f)));
  const items = [];
  const errors = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      errors.push({ feed: feeds[i].name, error: String(result.reason?.message || result.reason) });
    }
  });
  // Dedupe within this run too (feeds overlap heavily).
  const seen = new Set();
  const deduped = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { items: deduped, errors };
}
