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

// --- Advance-page reads. Same contract as above: plain language, no
// predictions, extremes framed as contrarian caution rather than signals.

// Long/short ACCOUNT ratio — counts accounts, not size, so it skews
// retail. Ratio 2.0 = twice as many accounts long as short.
export function interpretLongShort(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio >= 3) {
    return {
      emoji: '🔴',
      label: 'Heavily long-skewed',
      explanation:
        'Far more accounts long than short. Retail crowds long near tops more often than bottoms — an extreme here is a caution flag, not a buy signal.',
    };
  }
  if (ratio >= 1.5) {
    return {
      emoji: '🟡',
      label: 'Long-leaning',
      explanation: 'More accounts long than short — the usual retail lean, nothing extreme.',
    };
  }
  if (ratio >= 0.67) {
    return {
      emoji: '⚪',
      label: 'Balanced',
      explanation: 'Long and short account counts are roughly even — no crowd to fade.',
    };
  }
  return {
    emoji: '🟢',
    label: 'Short-skewed',
    explanation:
      'More accounts short than long — rare for retail. Crowded shorts are historically squeeze fuel.',
  };
}

// Order-book bid share within ±2% of price. Snapshot texture, not a
// signal — books repaint in milliseconds and big orders can be spoofed.
export function interpretDepth(bidSharePct) {
  if (bidSharePct == null || !Number.isFinite(bidSharePct)) return null;
  if (bidSharePct >= 60) return 'Bids thicker — more resting spot demand just below price than supply above.';
  if (bidSharePct <= 40) return 'Asks thicker — more resting supply just above price than demand below.';
  return 'Order book roughly balanced within ±2% of price — no side has a wall.';
}

// Stablecoin total market cap 24h change — the "dry powder" read.
export function interpretStablecoins(changePct) {
  if (changePct == null || !Number.isFinite(changePct)) return null;
  if (changePct > 0.15) return 'Stablecoin supply expanding — new dry powder entering crypto rails, potential future buying power.';
  if (changePct < -0.15) return 'Stablecoin supply shrinking — money is leaving crypto rails, not rotating within them.';
  return 'Stablecoin supply flat over 24h — no meaningful money entering or leaving crypto rails.';
}

// Put/call open-interest ratio. Crypto options run call-heavy by
// default (~0.4–0.7), so "high" here starts well below equity norms.
export function interpretPutCall(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio < 0.5) return 'Call-heavy even by crypto standards — speculative upside positioning dominates.';
  if (ratio < 0.8) return 'Typical crypto skew: more calls than puts, a mild speculative lean.';
  if (ratio <= 1.2) return 'Puts near parity with calls — unusually high hedging demand for crypto.';
  return 'Put-heavy — traders are paying up for downside protection.';
}

// Implied (DVOL) vs realized volatility, both annualized percents.
export function interpretVolGap(impliedPct, realizedPct) {
  if (!Number.isFinite(impliedPct) || !Number.isFinite(realizedPct)) return null;
  const gap = impliedPct - realizedPct;
  if (gap > 15) return 'Options are pricing far more movement than the recent past delivered — the market expects a catalyst.';
  if (gap < -10) return 'Options are pricing less movement than recently realized — either complacency or a post-event cooldown.';
  return 'Implied volatility is roughly in line with recent realized movement — options see more of the same.';
}

// 30-day daily-return correlation vs BTC.
export function interpretCorrelation(rho) {
  if (rho == null || !Number.isFinite(rho)) return null;
  if (rho >= 0.8) return 'moves almost in lockstep with BTC';
  if (rho >= 0.5) return 'loosely tracks BTC';
  if (rho >= 0.2) return 'only weakly tied to BTC';
  if (rho > -0.2) return 'trades on its own story, independent of BTC';
  return 'has been moving against BTC';
}
