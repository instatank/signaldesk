// Anthropic Messages API via plain fetch — no SDK, by the project's
// minimal-dependency rule. AI is an optional layer: callers must handle
// this module throwing and fall back to raw data.
import { fetchJson } from './http.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-sonnet-4-6';

// Structured output schema for the digest (PRD §7). Enforced server-side
// via output_config.format, so the response text is guaranteed valid JSON.
const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    market_pulse: {
      type: 'string',
      description: '2-3 sentences: what kind of day/regime is it — trending, chopping, fearful, greedy.',
    },
    top_stories: {
      type: 'array',
      description: 'Up to 5 stories ranked by market relevance, not recency.',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-line summary of the story.' },
          why_it_matters: { type: 'string', description: 'One line on why a trader should care.' },
          source: { type: 'string' },
        },
        required: ['summary', 'why_it_matters', 'source'],
        additionalProperties: false,
      },
    },
    positioning: {
      type: 'array',
      description: 'Funding + OI read per coin in plain language.',
      items: {
        type: 'object',
        properties: {
          asset: { type: 'string' },
          read: { type: 'string' },
        },
        required: ['asset', 'read'],
        additionalProperties: false,
      },
    },
    sentiment_note: {
      type: 'string',
      description: 'Fear & Greed reading and whether it is at an extreme.',
    },
    learn_today: {
      type: 'string',
      description: 'One concept from today\'s data explained in 2-3 sentences.',
    },
  },
  required: ['market_pulse', 'top_stories', 'positioning', 'sentiment_note', 'learn_today'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are the analyst behind SignalDesk, a daily crypto market briefing for a beginner large-cap trader who does basic price-action analysis on TradingView.

Rules you must never break:
- NO predictions, NO trade calls, NO buy/sell recommendations. You inform; the reader decides.
- Never invent data. Only use the numbers and headlines provided in the input. If something is missing, say so.
- Flag uncertainty explicitly when the data is mixed or thin.
- Ignore fluff: price-prediction articles, sponsored content, "top 10 coins" listicles.
- Plain language a beginner understands. Briefly explain jargon when unavoidable.
- Keep the whole briefing under 400 words total.

Funding-rate interpretation framework (8h rate): above +0.05% = overheated longs (squeeze risk); +0.01% to +0.05% = mildly bullish; -0.01% to +0.01% = neutral; -0.05% to -0.01% = mildly bearish; below -0.05% = overheated shorts (short-squeeze territory).
OI + price framework (24h): price up + OI up = new money entering longs (trend confirmation); price up + OI down = short covering (rally may lack fuel); price down + OI up = new shorts (bearish conviction); price down + OI down = longs closing (capitulation flush).
Fear & Greed: extremes are contrarian signals — below 20 historically favors buyers, above 80 calls for caution.

Each headline has a "recent" flag: true means published in the last 12 hours, false means 12-24h old. The window covers a full 24h, but treat "recent" headlines as the primary story — lead with them in top_stories. Only reach for a non-recent headline if nothing recent is significant enough to fill the section.

If the input includes upcomingMacroEvents (known FOMC/CPI dates within the next week), mention the nearest one where it fits naturally — usually market_pulse (e.g. "CPI lands Tuesday — expect positioning to stay cautious into it"). Awareness only: never predict the outcome or how the market will react.

The "learn_today" section is the compounding-education feature: pick ONE concept visible in today's actual data and explain it in 2-3 sentences.`;

export async function generateDigest(inputs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const body = {
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: DIGEST_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Write today's briefing from this data (JSON):\n\n${JSON.stringify(inputs)}`,
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
