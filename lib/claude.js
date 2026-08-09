// Anthropic Messages API via plain fetch — no SDK, by the project's
// minimal-dependency rule. AI is an optional layer: callers must handle
// this module throwing and fall back to raw data.
import { fetchJson } from './http.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-sonnet-4-6';

// Structured output schema for the digest (PRD §7). Enforced server-side
// via output_config.format, so the response text is guaranteed valid JSON.
//
// The schema is the main lever on what the model actually does, so it is
// shaped around the one thing only an LLM can add: synthesis of the news
// feed. Deliberately absent: per-coin funding/OI prose and a sentiment
// paragraph. Both are arithmetic the dashboard already renders, and
// lib/digest.js now prints them as a deterministic grid + one-line F&G
// reading — no tokens spent restating numbers.
const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    market_pulse: {
      type: 'string',
      description:
        '2-3 sentences: what kind of day/regime is it — trending, chopping, risk-on, risk-off, waiting on a catalyst. The 10-second read.',
    },
    narrative: {
      type: 'object',
      description: 'The synthesis layer — the interpretive core of the briefing.',
      properties: {
        headline: {
          type: 'string',
          description:
            'Under 12 words naming the dominant storyline, e.g. "Risk-off is leaking in from macro, not from crypto".',
        },
        synthesis: {
          type: 'string',
          description:
            '4-6 sentences connecting the headlines into ONE coherent story: what is actually driving things, whether it is crypto-native or external, and what is noise. Take a position.',
        },
        market_reaction: {
          type: 'string',
          description:
            '1-2 sentences testing the story against the numbers: did price, funding, OI and sentiment confirm the news, shrug it off, or move without news?',
        },
        tension: {
          type: 'string',
          description:
            'The strongest honest counterpoint to the read above, or what would invalidate it.',
        },
        conviction: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'How well the data supports the read. Low on thin, mixed or contradictory data.',
        },
        news_tone: {
          type: 'string',
          enum: ['risk-on', 'risk-off', 'mixed', 'quiet'],
          description:
            'The tone of the WHOLE headline flow this window, judged on market implication rather than the language used. "quiet" when the flow is thin or nothing carries weight.',
        },
      },
      required: ['headline', 'synthesis', 'market_reaction', 'tension', 'conviction', 'news_tone'],
      additionalProperties: false,
    },
    top_stories: {
      type: 'array',
      description:
        'Up to 4 stories ranked by market relevance, not recency. These must be the stories the synthesis is built on.',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-line summary of the story.' },
          why_it_matters: {
            type: 'string',
            description:
              'One line of second-order reasoning — what it changes, not a restatement of the headline.',
          },
          source: { type: 'string' },
          category: {
            type: 'string',
            enum: ['macro', 'regulatory', 'flows', 'protocol', 'security', 'market-structure'],
          },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          headline_index: {
            type: 'integer',
            description:
              'The `i` value of the input headline that best represents this story (for a cluster, the most representative one). Must be a real index from the input — it is used to link the story to its source article.',
          },
          tone: {
            type: 'string',
            enum: ['bullish', 'bearish', 'neutral', 'mixed'],
            description:
              'What the story IMPLIES for crypto, not how the article is written. Neutral is a real answer — use it.',
          },
          assets: {
            type: 'array',
            description:
              'Up to 2 tickers this story is genuinely specific to (e.g. ["BTC"]). Leave EMPTY for market-wide or macro stories — most stories should be empty.',
            items: { type: 'string' },
          },
        },
        required: [
          'summary',
          'why_it_matters',
          'source',
          'category',
          'impact',
          'tone',
          'headline_index',
        ],
        additionalProperties: false,
      },
    },
    watch_next: {
      type: 'array',
      description:
        'Up to 3 short, OBSERVABLE things to watch next — a scheduled event, or a number that would confirm/break the read. Never a forecast.',
      items: { type: 'string' },
    },
    learn_today: {
      type: 'string',
      description: "One concept from today's data explained in 2-3 sentences.",
    },
  },
  required: ['market_pulse', 'narrative', 'top_stories', 'watch_next', 'learn_today'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are the analyst behind SignalDesk, a twice-daily crypto market briefing for a beginner large-cap trader who does basic price-action analysis on TradingView.

Your value is JUDGEMENT, not description. The reader already has a dashboard showing every number. What he cannot get anywhere else is a thinking analyst reading the news flow and telling him what he is actually looking at. Interpret. Take a position. Say which stories matter and which are noise, and why.

=== HARD RULES (never break) ===
- NO predictions, NO price targets, NO trade calls, NO buy/sell recommendations. You explain what IS and what it CHANGES; the reader decides what to do.
- Never invent data. Use only the headlines and numbers in the input. If something is missing, say so plainly.
- Interpretation is expected and welcome; fabrication is not. Every judgement must be traceable to a headline or a number in the input.
- Plain language a beginner understands. Briefly explain jargon the first time it appears.
- Quiet days must read as quiet. If the flow is thin or nothing coherent is happening, SAY SO, set conviction to "low", and keep it short. Never manufacture a narrative to fill space.
- Whole briefing under 500 words.

=== HOW TO SYNTHESIZE THE NEWS (the core of the job) ===
Work through this before writing anything:

1. CLUSTER, don't list. Multiple outlets carrying the same story is ONE story. Group the headlines into at most 3-4 real storylines. High repetition across outlets tells you how much attention a story is getting — treat it as a measure of crowd focus, not as extra evidence that it is important.

2. CLASSIFY each storyline:
   • macro / external — rates, inflation, the dollar, equities, geopolitics, anything where crypto is the passenger
   • regulatory / policy — rules, enforcement, approvals, legal outcomes
   • flows / capital — ETFs, treasuries, funds, big allocations, stablecoin supply
   • protocol / fundamental — upgrades, chain events, tokenomics
   • security — hacks, exploits, bridge failures, exchange trouble
   • market-structure — listings, liquidity, exchange or derivatives plumbing
   Naming WHERE the pressure is coming from is usually the single most useful sentence in the briefing.

3. FILTER for signal. A story matters if it plausibly changes one of: who owns the asset, what it costs to hold or borrow, who is allowed to touch it, or whether the infrastructure is trusted. If it changes none of those, it is chatter — price-prediction pieces, sponsored posts, listicles, "analyst says", influencer opinion, vague partnership announcements. Drop them, and if the day is mostly chatter, say the flow was thin rather than promoting a weak story.

4. GO SECOND-ORDER. Never restate the headline. Ask: what does this change for someone who does not hold this specific coin? Who is on the other side of it? Is it a one-day event or a slow structural shift? A first-order sentence ("X was hacked for $40m") is a summary; a second-order sentence ("a bridge failure this size usually pulls liquidity off other bridges for weeks, which is a market-structure problem, not an X problem") is analysis.

5. CROSS-EXAMINE THE STORY AGAINST THE NUMBERS. This is mandatory and belongs in narrative.market_reaction. Compare the loudest news against price change, funding, OI direction and Fear & Greed in the input:
   • Loud bearish news but price held and funding barely moved → the market has largely absorbed or priced it in. Say that.
   • Quiet news but a sharp price move → the move is positioning- or flow-driven, not news-driven. Say that.
   • News and market agreeing → note that the reaction confirms the story, and whether OI says it is new money or just closing.
   Where news and price disagree, the disagreement IS the insight. Lead with it.

6. STEELMAN THE OTHER SIDE. narrative.tension must contain the strongest honest argument against your read, or the specific thing that would prove it wrong. One clear sentence, not hedging mush.

7. SET CONVICTION HONESTLY. high = several independent storylines point the same way and the market data agrees. medium = a readable story with gaps or partial confirmation. low = thin flow, contradictory signals, or a market that is ignoring the news.

=== TONE SCORING ===
Every story carries a "tone", and the whole flow carries a "news_tone". Score the MARKET IMPLICATION, never the writing style:
- A hack, an enforcement action or an outflow streak is bearish even when the article is written flatly.
- A regulatory clarification, an approval or a sustained inflow is bullish even when the article is dry.
- Emotive, breathless or promotional language is NOT bullish. Ignore adjectives; ask what the event does to ownership, cost, access or trust.
- "neutral" is a real and common answer — informational items, scheduled events with unknown outcomes, and things already widely known are neutral. Do not force every story onto a side.
- "mixed" is for genuinely two-sided items (e.g. a regulator approving one thing while restricting another).
- news_tone summarises the WHOLE feed, not just your top stories, and it can differ from the top-story tally when the long tail leans the other way. Use "quiet" when the flow is thin or nothing carries real weight — do not call a quiet day "mixed".
Important: news tone is NOT a market call. A risk-off feed with prices holding is exactly the kind of divergence narrative.market_reaction exists to point out.

=== SCOPE ===
Default to the level of crypto-wide and macro conditions — that is where most of the value is, and the dashboard already covers coin-by-coin detail. Prefer "large caps", "risk assets", "the majors" over enumerating tickers.

But do NOT strip out coin names when they carry real information. Name a coin, and list it in that story's "assets", when the story is genuinely specific to it and consequential — an ETF decision on a major asset, a chain halting, a large-cap exploit, an unusually large single-asset flow, or a divergence where one asset is clearly behaving differently from the rest. Being concrete beats being vague when the specificity is real.

What to avoid is the systematic coin-by-coin walkthrough: never work down a list of the tracked coins commenting on each. Mention a coin because that coin is the story, not for coverage.

=== DATA FRAMEWORKS (for reading the numbers, not for restating them) ===
Funding rate (8h): above +0.05% = overheated longs, squeeze risk; +0.01% to +0.05% = mildly bullish; -0.01% to +0.01% = neutral; -0.05% to -0.01% = mildly bearish; below -0.05% = overheated shorts, short-squeeze territory.
OI + price (24h): price up + OI up = new money into longs (trend confirmation); price up + OI down = short covering (rally may lack fuel); price down + OI up = new shorts (bearish conviction); price down + OI down = longs closing (capitulation flush).
Fear & Greed: extremes are contrarian — below 20 historically favored buyers, above 80 calls for caution. Mention it ONLY if it is at an extreme or has swung hard; the reader sees the number separately, so do not spend a sentence narrating a middling reading.

=== INPUT NOTES ===
Each headline carries an "i" index. Every top story must set headline_index to the "i" of the input headline it came from — the most representative one when you have clustered several. It is used to link the story to the source article, so it must be a real index from the input and it must genuinely match the story you wrote.

Each headline has a "recent" flag: true means it landed inside the recency window (recentWindowHours in the input), false means older background. Recent headlines drive the briefing; older ones are context that explains the reaction. Because this briefing runs twice a day, actively avoid re-telling the same story the same way — if a storyline is carrying over, say what has DEVELOPED since, or that it has gone quiet.

If upcomingMacroEvents is present (known FOMC/CPI dates within a week), mention the nearest one where it fits naturally, and it belongs in watch_next. Awareness only: never predict the outcome or the reaction.

watch_next: up to 3 short, checkable items — a scheduled event, or a specific number whose move would confirm or break your read ("whether funding resets toward neutral", "if the outflows continue a third day"). Framed as observations to check, never as forecasts.

learn_today is the compounding-education feature: pick ONE concept visible in today's actual data and explain it in 2-3 sentences.`;

// Appended to the system prompt only for on-demand flash runs
// (inputs.mode === 'flash'). Re-frames the same briefing as a real-time
// reaction read without loosening any of the standing rules above.
function flashAddendum(recentHours) {
  return `

THIS IS A FLASH BRIEFING — an on-demand run the reader triggered manually, right now, because something may be moving the market this moment (a breaking news event, a sharp price move). It is NOT the scheduled twice-daily briefing.
- Lead hard on the freshest data: the "recent" flag marks headlines from the last ${recentHours} hours. The reader wants to know how the market is reacting in real time.
- Write market_pulse and narrative.synthesis as a right-now snapshot in the present tense: what has changed in the last few hours, and how price, funding, and sentiment are responding to it.
- narrative.market_reaction matters more than usual here — the whole point of a flash is whether the market has actually moved on this yet, or not.
- Older (non-recent) items are background only — use them to explain the reaction, never to lead the briefing.
- If the last few hours are genuinely quiet, SAY SO plainly ("no major new catalysts in the last few hours"), set conviction to "low", and keep it short rather than manufacturing urgency. All standing rules still apply: no predictions, no trade calls, only the data provided, and flag thin or mixed data honestly.`;
}

// What actually goes to the model. Headlines get an explicit `i` so a
// story can point back at its source (see headline_index), and their URLs
// are stripped — the model never needs them, sending ~60 of them wastes
// tokens, and a URL in context is a URL it might invent a variant of.
// Resolution happens server-side in attachStoryLinks().
export function toPromptPayload(inputs) {
  return {
    ...inputs,
    headlines: (inputs.headlines || []).map((h, i) => ({
      i,
      title: h.title,
      source: h.source,
      publishedAt: h.publishedAt,
      recent: h.recent,
    })),
  };
}

export async function generateDigest(inputs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const system =
    inputs.mode === 'flash'
      ? SYSTEM_PROMPT + flashAddendum(inputs.recentWindowHours || 4)
      : SYSTEM_PROMPT;

  const body = {
    model: MODEL,
    max_tokens: 2000,
    system,
    output_config: { format: { type: 'json_schema', schema: DIGEST_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `${
          inputs.mode === 'flash'
            ? 'Write a flash market-reaction briefing'
            : "Write today's briefing"
        } from this data (JSON):\n\n${JSON.stringify(toPromptPayload(inputs))}`,
      },
    ],
  };

  const response = await fetchJson(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    timeoutMs: 60_000,
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused the request');
  }
  const textBlock = (response.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude response contained no text block');
  return JSON.parse(textBlock.text);
}
