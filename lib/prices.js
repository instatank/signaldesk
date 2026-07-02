// Spot prices + 24h change from CoinGecko's free endpoint.
import { fetchJson } from './http.js';

export async function fetchPrices(baseUrl, assets) {
  const ids = assets.map((a) => a.coingecko).join(',');
  const url = `${baseUrl}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const json = await fetchJson(url, {
    headers: { accept: 'application/json' },
  });
  const prices = {};
  for (const asset of assets) {
    const entry = json[asset.coingecko];
    if (!entry) continue;
    prices[asset.symbol] = {
      usd: entry.usd,
      change24hPct: entry.usd_24h_change ?? null,
    };
  }
  if (Object.keys(prices).length === 0) {
    throw new Error('CoinGecko returned no prices');
  }
  return prices;
}
