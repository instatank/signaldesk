// Funding rate + open interest, via an adapter with automatic failover.
// Binance is primary (richest data) but geo-blocks US IPs (451/403);
// OKX is the fallback and is globally accessible. Which source actually
// served the data is recorded on every snapshot.
import { fetchJson } from './http.js';

const binanceSource = {
  name: 'binance',
  async fetch(asset) {
    const [premium, oi] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${asset.binance}`),
      fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${asset.binance}`),
    ]);
    return {
      // lastFundingRate is the current 8h rate as a decimal fraction
      // (0.0001 = 0.01%).
      fundingRate: Number(premium.lastFundingRate),
      markPrice: Number(premium.markPrice),
      // openInterest is denominated in the base asset (e.g. BTC).
      openInterest: Number(oi.openInterest),
    };
  },
};

const okxSource = {
  name: 'okx',
  async fetch(asset) {
    const [funding, oi] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${asset.okx}`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instId=${asset.okx}`),
    ]);
    if (funding.code !== '0' || !funding.data?.[0]) {
      throw new Error(`OKX funding error for ${asset.okx}: ${funding.msg || funding.code}`);
    }
    if (oi.code !== '0' || !oi.data?.[0]) {
      throw new Error(`OKX OI error for ${asset.okx}: ${oi.msg || oi.code}`);
    }
    return {
      fundingRate: Number(funding.data[0].fundingRate),
      markPrice: null,
      // oiCcy is denominated in the base asset, matching Binance's unit.
      openInterest: Number(oi.data[0].oiCcy),
    };
  },
};

export const SOURCES = [binanceSource, okxSource];

// Fetch funding + OI for one asset, failing over silently down the source
// list. Throws only if every source fails.
export async function fetchDerivatives(asset, sources = SOURCES) {
  let lastError;
  for (const source of sources) {
    try {
      const data = await source.fetch(asset);
      if (!Number.isFinite(data.fundingRate)) {
        throw new Error(`${source.name} returned non-numeric funding rate`);
      }
      return { ...data, source: source.name };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Returns { data: {BTC: {...}|null, ...}, errors: [...] }.
export async function fetchAllDerivatives(assets, sources = SOURCES) {
  const results = await Promise.allSettled(
    assets.map((a) => fetchDerivatives(a, sources)),
  );
  const data = {};
  const errors = [];
  results.forEach((result, i) => {
    const symbol = assets[i].symbol;
    if (result.status === 'fulfilled') {
      data[symbol] = result.value;
    } else {
      data[symbol] = null;
      errors.push({ asset: symbol, error: String(result.reason?.message || result.reason) });
    }
  });
  return { data, errors };
}
