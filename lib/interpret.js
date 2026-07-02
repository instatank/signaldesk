// The interpretation layer — the product's core differentiator.
// Every number ships with a plain-language read (PRD §5). Used by the
// digest's raw fallback now and by the dashboard cards in Phase 2.

// fundingRate is the 8h rate as a decimal fraction: 0.0001 = 0.01%.
export function interpretFunding(fundingRate) {
  const pct = fundingRate * 100; // convert to percent for thresholds
  if (pct > 0.05) {
    return {
      emoji: '🔴',
      label: 'Overheated longs',
      explanation:
        'Longs are paying a premium to stay in. Crowded long trade — vulnerable to a long squeeze / sharp dip.',
    };
  }
  if (pct >= 0.01) {
    return {
      emoji: '🟡',
      label: 'Mildly bullish',
      explanation: 'Normal bull-market funding. Longs slightly dominant, nothing extreme.',
    };
  }
  if (pct > -0.01) {
    return {
      emoji: '⚪',
      label: 'Neutral',
      explanation:
        'Balanced positioning. Funding tells you nothing right now — lean on your chart analysis.',
    };
  }
  if (pct >= -0.05) {
    return {
      emoji: '🟡',
      label: 'Mildly bearish',
      explanation: 'Shorts paying to stay in. Mild bearish crowding.',
    };
  }
  return {
    emoji: '🟢',
    label: 'Overheated shorts',
    explanation: 'Heavy short crowding. Historically, this is when short squeezes happen.',
  };
}

// 24h price direction + 24h OI direction -> what the flow means (PRD §5).
// Small moves are treated as flat so we don't overinterpret noise.
export function interpretOiPrice(priceChangePct, oiChangePct) {
  if (priceChangePct == null || oiChangePct == null) return null;
  const priceFlat = Math.abs(priceChangePct) < 0.5;
  const oiFlat = Math.abs(oiChangePct) < 1;
  if (priceFlat || oiFlat) {
    return 'Price and positioning roughly flat — no strong flow signal in the last 24h.';
  }
  const priceUp = priceChangePct > 0;
  const oiUp = oiChangePct > 0;
  if (priceUp && oiUp) return 'New money entering longs — trend confirmation';
  if (priceUp && !oiUp) return 'Shorts closing (short covering) — rally may lack fuel';
  if (!priceUp && oiUp) return 'New shorts opening — bearish conviction';
  return 'Longs closing — could be capitulation flush';
}

export function interpretFearGreed(value) {
  if (value < 20) {
    return 'Extreme Fear (<20): historically better buying zones than selling zones.';
  }
  if (value > 80) {
    return 'Extreme Greed (>80): time for caution, not FOMO.';
  }
  if (value < 40) return 'Fear: sentiment is pessimistic but not at an extreme.';
  if (value > 60) return 'Greed: sentiment is optimistic but not at an extreme.';
  return 'Neutral: sentiment is balanced — no contrarian edge either way.';
}

export function formatFundingPct(fundingRate) {
  return `${(fundingRate * 100).toFixed(4)}%`;
}
