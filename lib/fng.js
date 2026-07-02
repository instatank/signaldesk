// Fear & Greed index from alternative.me. Free, no key.
// Fallbacks if this endpoint ever dies (documented in the PRD):
// CoinMarketCap has an F&G endpoint on its free tier; Coinglass publishes
// the same index on its website.
import { fetchJson } from './http.js';

export async function fetchFearGreed(url) {
  const json = await fetchJson(url);
  if (!json.data?.length) throw new Error('Fear & Greed: empty response');
  const [current, ...rest] = json.data;
  return {
    value: Number(current.value),
    classification: current.value_classification,
    timestamp: Number(current.timestamp),
    // Daily history, newest first, for the 30-day sparkline (Phase 2)
    // and the 7-day trend the digest needs.
    history: [current, ...rest].map((d) => ({
      value: Number(d.value),
      timestamp: Number(d.timestamp),
    })),
  };
}
