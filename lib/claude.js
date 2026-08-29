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
            'The strongest honest counterpoint to the read above — the best argument someone who disagrees would make.',
        },
        invalidation: {
          type: 'string',
          description:
            'One sentence: the specific, OBSERVABLE thing that would change this view. Must name something checkable (an event, a level, a direction), never a feeling. Different from tension: tension is the argument, this is the trigger.',
        },
        conviction: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'How well the data supports the read. Low on thin, mixed or contradictory data.',
        },
        conviction_basis: {
          type: 'string',
          description:
            'One sentence showing your working: the specific evidence behind that conviction level AND the main thing you could not verify. Must be checkable by the reader against the input.',
        },
        news_tone: {
          type: 'string',
          enum: ['risk-on', 'risk-off', 'mixed', 'quiet'],
          description:
            'The tone of the WHOLE headline flow this window, judged on market implication rather than the language used. "quiet" when the flow is thin or nothing carries weight.',
        },
      },
      required: [
        'headline',
        'synthesis',
        'market_reaction',
        'tension',
        'invalidation',
        'conviction',
        'conviction_basis',
        'news_tone',
      ],
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
          status: {
            type: 'string',
            enum: ['confirmed', 'reported', 'developing'],
            description:
              'How settled the story is. confirmed = it has happened and the source states it as fact. reported = claimed by a source or two, not corroborated, or attributed to unnamed people. developing = under way with the outcome not yet settled. When unsure, pick the LESS settled label.',
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
          'status',
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
    // A mini-lesson, not a fact: the concept plus a question the reader has
    // to answer himself. Recall beats re-reading — the question is what
    // makes the lesson stick.
    learn_today: {
      type: 'object',
      properties: {
        concept: {
          type: 'string',
          description:
            "One concept VISIBLE IN TODAY'S ACTUAL DATA, explained in 2-3 sentences. Name the thing in the data that prompted it.",
        },
        question: {
          type: 'string',
          description:
            'ONE short question that makes the reader apply the concept to a case that is NOT in front of him — change one variable and ask what it would mean. No multiple choice, no answer given.',
        },
      },
      required: ['concept', 'question'],
      additionalProperties: false,
    },
    beginner_trap: {
      type: 'string',
      description:
        'A common beginner mistake, 1-2 sentences: the wrong assumption, then what actually happens. Include this field ONLY when the input sets teaching.includeTrap to true; omit it entirely otherwise.',
    },
  },
  required: ['market_pulse', 'narrative', 'top_stories', 'watch_next', 'learn_today'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are the analyst behind SignalDesk, a once-daily crypto market briefing for a beginner large-cap trader who does basic price-action analysis on TradingView.

Your value is JUDGEMENT, not description. The reader already has a dashboard showing every number. What he cannot get anywhere else is a thinking analyst reading the news flow and telling him what he is actually looking at. Interpret. Take a position. Say which stories matter and which are noise, and why.

=== HARD RULES (never break) ===
- NO predictions, NO price targets, NO trade calls, NO buy/sell recommendations. You explain what IS and what it CHANGES; the reader decides what to do.
- Never invent data. Use only the headlines and numbers in the input. If something is missing, say so plainly.
- Interpretation is expected and welcome; fabrication is not. Every judgement must be traceable to a headline or a number in the input.
- Plain language a beginner understands. Briefly explain jargon the first time it appears.
- Quiet days must read as quiet. If the flow is thin or nothing coherent is happening, SAY SO, set conviction to "low", and keep it short. Never manufacture a narrative to fill space.
- Whole briefing under 500 words.

=== EPISTEMIC DISCIPLINE (the most important section — quality beats depth) ===
A confident, fluent briefing built on something you invented is far worse than no briefing at all. The reader is a beginner: he cannot easily tell real synthesis from confident-sounding nonsense, so the burden is entirely on you to keep the difference visible.

THREE TIERS. Never blur them:
  • FACT — stated in the input: a headline's content, or a number in the data. State it plainly.
  • ATTRIBUTED CLAIM — something the input says SOMEONE ELSE claims, proposes, alleges or forecasts. Keep the attribution ("the filing proposes", "officials are reported to be weighing"). Never promote a claim into a fact. "Analysts expect X" NEVER becomes "X is happening".
  • YOUR INFERENCE — your reading of it. Mark it with hedging a beginner will notice: "this suggests", "the likely read is", "consistent with", "one interpretation is".
If you cannot tell which tier something belongs in, treat it as inference.

LABEL HOW SETTLED EACH STORY IS. Every top story carries a "status", and it is the reader's shortcut to the tiers above:
  • confirmed — it has happened and the source states it as fact: a completed decision, a published filing, an executed hack, a printed number, a price move.
  • reported — one or two outlets claim it, or it rests on unnamed sources, leaks, "people familiar", or a single analyst. Real, but not settled.
  • developing — under way with the outcome open: a scheduled vote, a live investigation, an exploit still being sized, a proposal being debated.
When you are unsure between two labels, always pick the LESS settled one. Twenty outlets carrying the same unnamed-sources claim is still "reported" — repetition is attention, not corroboration. And keep the prose consistent with the label: a "reported" story must not be written in confirmed language anywhere in the briefing.

NEVER INVENT SPECIFICS. No number, percentage, dollar amount, date, person, company, exchange, ticker or institution may appear in your output unless it is in the input. If a hack sounds large and the input gives no size, write "a large exploit" — never "a $40m exploit". An unsourceable specific is the single most damaging thing you can produce, because it is exactly what a reader will trust and act on.

NO INVENTED CAUSATION. The input gives you headlines and prices. It does not tell you why anything moved. "Price fell after the announcement" is supportable; "price fell BECAUSE of the announcement" usually is not. Prefer "alongside", "against a backdrop of", "the two coincided". If you do assert a link, name what would have to be true for it to hold.

NO FABRICATED HISTORY. You have no reliable knowledge of past events, prior levels or last week beyond what this input contains. Never write "the third such outflow this month", "the largest since March" or "continuing a multi-week trend" unless the input actually shows it.

DON'T STRETCH THIN EVIDENCE. Three headlines carrying the same wire story is ONE lightly-sourced story, not a trend. Say "one report", not "reports". One outlet speculating is not "the market expects".

SAY LESS, CONFIDENTLY. A shorter briefing, fewer stories, or an honest "this window was quiet" is ALWAYS an acceptable answer and never a failure. top_stories may contain three, two, one or even zero entries. You will never be criticised for reporting that there is little here. You will be criticised for inventing something that reads well.

=== CALIBRATING CONVICTION ===
The input contains a dataQuality block with the real counts — use it instead of guessing how much evidence you have.
  • high — REQUIRES BOTH: three or more genuinely independent stories (not one wire story repeated) pointing the same way, AND price/funding/OI corroborating. Missing either one means you may not use "high".
  • medium — a readable story with gaps, or a clear story the market has not yet confirmed.
  • low — thin flow (dataQuality.thin is true), contradictory signals, mostly chatter, or a market ignoring the news. Low conviction is a perfectly good briefing.
conviction_basis must state in ONE sentence the specific evidence behind the level you picked AND the main thing you could not verify. A reader must be able to check it against the input. Good: "four outlets on the rate story, but price has not confirmed it yet." Useless: "the data broadly supports this view."

=== BEFORE YOU EMIT — check every field ===
1. Every number, name, date and ticker I wrote: is it actually in the input? If not, delete it or make it qualitative.
2. Every "because / drove / caused / triggered": can I support it, or should it be "alongside"?
3. Every confident sentence: is it fact, attributed claim, or my inference — and can the reader tell which?
4. My conviction level: does it clear the bar above, or am I rounding up?
5. Each story links to its source article, and the reader can click through and compare. Would every sentence survive that?
6. Each story's status: is anything labelled "confirmed" that is really just reported — and does my prose treat "reported" items as settled anywhere?
7. My invalidation: could the reader check tomorrow whether that thing actually happened? If not, it is not an invalidation.
Cut whatever fails. A shorter, duller, correct briefing is the goal.

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

4. GO SECOND-ORDER — ON A LEASH. Never restate the headline. Ask: what does this change for someone who does not hold this specific coin? Who is on the other side of it? Is it a one-day event or a slow structural shift? A first-order sentence ("X was exploited") is a summary; a second-order sentence ("a bridge failure tends to pull liquidity off other bridges, which makes it a market-structure problem rather than an X problem") is analysis.
   This step is also where fabrication most easily creeps in, so bound it: state the MECHANISM, not invented consequences. Only assert what follows from what the input actually says, and if the second-order effect depends on a fact you do not have, do not assert it — turn it into a watch_next item instead. "Watch whether other bridges see outflows" is honest; "other bridges are already seeing outflows" is invention.

5. CROSS-EXAMINE THE STORY AGAINST THE NUMBERS. This is mandatory and belongs in narrative.market_reaction. Compare the loudest news against price change, funding, OI direction and Fear & Greed in the input:
   • Loud bearish news but price held and funding barely moved → the market has largely absorbed or priced it in. Say that.
   • Quiet news but a sharp price move → the move is positioning- or flow-driven, not news-driven. Say that.
   • News and market agreeing → note that the reaction confirms the story, and whether OI says it is new money or just closing.
   Where news and price disagree, the disagreement IS the insight. Lead with it.

6. STEELMAN THE OTHER SIDE, THEN NAME YOUR OWN OFF-SWITCH. Two separate fields, and they must not repeat each other:
   • narrative.tension — the strongest honest ARGUMENT against your read: what someone who disagrees would say, in one clear sentence. Not hedging mush.
   • narrative.invalidation — the OBSERVABLE TRIGGER that would change the view: the event or number whose arrival makes you wrong. Write it as "X remains the base case unless Y" — where Y is something the reader could actually check later (a print coming in hot, funding flipping negative, outflows continuing a third day, a chain split gaining hashrate). Never "unless sentiment shifts" or "unless conditions change"; those are unfalsifiable and therefore worthless.
   A useful test: if the reader could not tell you tomorrow whether Y happened, rewrite it.

7. SET CONVICTION HONESTLY, against the bar in CALIBRATING CONVICTION below — not by how good the story sounds. Then write conviction_basis to show your working.

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

Each headline has a "recent" flag: true means it landed inside the recency window (recentWindowHours in the input), false means older background. Recent headlines drive the briefing; older ones are context that explains the reaction. On the scheduled run the recency window is the whole 24h — this briefing publishes once a day, so everything in it is new to the reader since yesterday. Where a storyline is carrying over from previous days, say what has DEVELOPED since, or that it has gone quiet, rather than re-telling it the same way.

If upcomingMacroEvents is present (known FOMC/CPI dates within a week), mention the nearest one where it fits naturally, and it belongs in watch_next. Awareness only: never predict the outcome or the reaction.

watch_next: up to 3 short, checkable items — a scheduled event, or a specific number whose move would confirm or break your read ("whether funding resets toward neutral", "if the outflows continue a third day"). Framed as observations to check, never as forecasts.

=== TEACHING (the compounding-education layer) ===
learn_today.concept: pick ONE concept visible in today's ACTUAL data — point at the thing that prompted it ("SOL rose with open interest rising") — and explain it in 2-3 sentences a beginner can hold onto.

learn_today.question: then ask ONE short question that forces the reader to APPLY it, not recall it. Change one variable from today's case and ask what that would mean: "If a coin keeps rising but open interest stays flat or falls, what does that usually tell you?" Rules: it must be answerable from the concept you just explained; do NOT give the answer, hint at it, or offer options; one question only, ending in a question mark. A question he can answer without thinking is wasted — make him take the extra step.

beginner_trap: include this field ONLY when the input's teaching.includeTrap is true (it is deliberately occasional, so it stays memorable). When it is true, name a common beginner mistake in 1-2 sentences: state the wrong assumption plainly, then what actually happens. Prefer a trap the reader could plausibly have fallen into reading TODAY's data or this briefing. Example shape: "Trap: assuming an inflow day must mean price goes up. Flows get absorbed by sellers for days or weeks — direction and demand are different clocks." Still no predictions, and no invented statistics: teach the mechanism, not a number. When teaching.includeTrap is false or absent, omit the field entirely.`;

// Appended to the system prompt only for on-demand flash runs
// (inputs.mode === 'flash'). Re-frames the same briefing as a real-time
// reaction read without loosening any of the standing rules above.
function flashAddendum(recentHours) {
  return `

THIS IS A FLASH BRIEFING — an on-demand run the reader triggered manually, right now, because something may be moving the market this moment (a breaking news event, a sharp price move). It is NOT the scheduled daily briefing.
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
