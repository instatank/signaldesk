// The Advance page's coaching layer, in ONE place so the three surfaces
// that teach the same stat can never drift:
//   • `one`  — a two-line grey footnote under each card (always visible;
//              the glanceable "what is this / how do I read it" refresher)
//   • `body` — the full explanation, shown both in the card's ⓘ popover
//              and in the "How to read this page" panel at the top
//
// These are advanced stats aimed at a beginner, so every entry answers the
// same three things: what it measures, how to read it, and where it lies
// to you. The caveats are the point — an unqualified advanced stat is
// worse than no stat.
export const GUIDE = [
  {
    key: 'crowd',
    title: 'Crowd — Long/Short Accounts',
    one: 'How many accounts sit long vs short. Retail-weighted, so extremes read contrarian: a very crowded side is squeeze fuel, not confirmation.',
    body: (
      <>
        <p className="mb-1 font-medium text-zinc-100">Long/short ratio — how is the crowd leaning?</p>
        <p>
          The ratio of accounts long vs short on perps (2.0 = twice as many longs). It counts
          accounts, not position size, so it skews retail — which is the point: retail crowds long
          near tops and capitulates near bottoms, so extremes read contrarian. Compare with funding:
          when both scream &ldquo;crowded long,&rdquo; the squeeze risk is real.
        </p>
      </>
    ),
  },
  {
    key: 'depth',
    title: 'Depth — Spot Order Book',
    one: 'Real orders resting within ±2% of price. Bids thicker = demand below, asks thicker = supply above. A 15-min snapshot and spoofable — texture, not signal.',
    body: (
      <>
        <p className="mb-1 font-medium text-zinc-100">
          Order-book depth — where is the resting liquidity?
        </p>
        <p>
          USD sitting on the spot book within ±2% of price. More on the bid side = resting demand
          below; more on the ask side = supply waiting above. Two honest caveats: this is a
          15-minute snapshot of a book that repaints in milliseconds, and big resting orders can be
          spoofed — treat it as texture, never as a signal on its own.
        </p>
      </>
    ),
  },
  {
    key: 'flows',
    title: 'Money Flows — Stablecoins & Dominance',
    one: "Stablecoin supply is crypto's cash pile: growing = new dry powder, shrinking = money leaving entirely. Rising BTC dominance = safety-seeking inside crypto.",
    body: (
      <>
        <p className="mb-1 font-medium text-zinc-100">Money flows — is cash entering crypto rails?</p>
        <p>
          Stablecoins are crypto&rsquo;s cash balance: supply growing means money moved in and is
          waiting to be deployed (&ldquo;dry powder&rdquo;); shrinking means money left entirely.
          BTC dominance is BTC&rsquo;s share of the total market — rising dominance in a down market
          is flight to quality inside crypto; falling dominance while prices rise usually means
          money is rotating into alts.
        </p>
      </>
    ),
  },
  {
    key: 'options',
    title: 'Options — Deribit DVOL & Put/Call',
    one: 'DVOL = the move options expect over 30 days; far above realized vol means traders are braced for a catalyst. Put/call near 1.0 is unusual hedging for crypto.',
    body: (
      <>
        <p className="mb-1 font-medium text-zinc-100">Options — what is the smart money pricing in?</p>
        <p>
          DVOL is Deribit&rsquo;s implied-volatility index: the annualized move option prices expect
          over the next 30 days (DVOL 50 ≈ ±2.6% expected daily swing). Compare it with realized
          vol — implied far above realized means options are braced for a catalyst. The put/call
          ratio splits open interest: puts are downside protection, calls are upside bets. Crypto
          normally runs call-heavy, so put demand near parity is notable. BTC and ETH only — the
          coins with a liquid listed options market.
        </p>
      </>
    ),
  },
  {
    key: 'character',
    title: 'Character — 30d Vol & BTC Correlation',
    one: "Realized vol = how big this coin's daily candles actually are, so size positions accordingly. Correlation near 1.0 means you're really just holding a BTC trade.",
    body: (
      <>
        <p className="mb-1 font-medium text-zinc-100">30-day character — how does each coin trade?</p>
        <p>
          Realized volatility is how much a coin has actually been moving (annualized — higher means
          bigger daily candles, so the same position size carries more risk). Correlation to BTC
          asks whether the coin has its own story: near 1.0 it&rsquo;s a BTC trade in disguise; near
          0 it moves to its own news. Both are computed from the last 30 daily closes and refresh
          once a day.
        </p>
      </>
    ),
  },
];

export const GUIDE_BY_KEY = Object.fromEntries(GUIDE.map((g) => [g.key, g]));
