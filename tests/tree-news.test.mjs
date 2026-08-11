// Offline tests for the Tree News source.
//
// The fixture below is REAL — items copied verbatim from a live
// news.treeofalpha.com/api/news response the owner pasted on 2026-08-11
// (the sandbox cannot reach the host, so this file is the spec). It covers
// every item shape the endpoint produced: a Korean exchange notice with an
// English translation, tweets from a followed newsroom, publisher-prefixed
// blog items, and a promotional tweet from an account nobody follows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTreeNewsItem,
  buildFollowAllowlist,
  buildPublisherMap,
  socialHandle,
  isSocialUrl,
  toPublishedAt,
  cleanTitle,
  fetchTreeNews,
} from '../lib/tree-news.js';
import { collectHeadlines, urlHash } from '../lib/rss.js';
import { titleKey, shapeHeadlines } from '../lib/dashboard.js';
import { assembleDigestInputs, attachStoryLinks } from '../lib/digest.js';
import follows from '../config/follows.json' with { type: 'json' };
import sources from '../config/sources.json' with { type: 'json' };

// --- the real payload ------------------------------------------------------
const UPBIT = {
  title: '[입출금] Polygon 네트워크 관련 디지털 자산 입출금 일시 중단 안내 (08/13 20:00 ~)',
  source: 'Upbit',
  url: 'https://upbit.com/service_center/notice?id=1721052840',
  time: 1786423547664,
  symbols: [],
  _id: '1786423547664P02',
  en: '[Deposit/Withdrawal] Notice of temporary suspension of deposits and withdrawals of digital assets related to the Polygon network (08/13 20:00 ~)',
  suggestions: [{ found: ['polygon'], coin: 'POL', symbols: [{ exchange: 'binance-futures', symbol: 'POLUSDT' }], supply: 10538992837 }],
};

const BLOCK_TWEET = {
  _id: '2087036027357823180',
  source: 'Twitter',
  title:
    'The Block (@TheBlockCo): NEW: UK lawmakers criticized banks in a new letter for stunting the growth of the local cryptocurrency industry by denying services to digital asset companies, calling the practice "one of the single biggest barriers," according to the Financial Times. ',
  url: 'https://x.com/TheBlockCo/status/2087036027357823180',
  icon: 'https://twproxy.twproxy.workers.dev/?url=https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1944749695525425152%2F9babG7Df_400x400.jpg',
  image: 'https://twproxy.twproxy.workers.dev/?url=https%3A%2F%2Fpbs.twimg.com%2Fmedia%2FHPakNCea8AAUd2v.jpg',
  time: 1786423139209,
  info: { twitterId: '963767159536209921', truthId: null, isReply: false, isRetweet: false, isQuote: false, isSelfReply: false },
  suggestions: [],
};

const COINTELEGRAPH_BLOG = {
  title: "COINTELEGRAPH: White House vows to get CLARITY across 'finish line' in September",
  source: 'Blogs',
  url: 'https://cointelegraph.com/news/white-house-clarity-across-finish-line-september',
  time: 1786421582921,
  symbols: [],
  sourceName: 'COINTELEGRAPH',
  en: "COINTELEGRAPH: White House vows to get CLARITY across 'finish line' in September",
  _id: '1786421582921CWHvtgCafliS',
  suggestions: [],
};

const COINDESK_BLOG = {
  title: 'COINDESK: U.S. SEC sets meeting to propose Reg Crypto to support certain digital assets offerings',
  source: 'Blogs',
  url: 'https://www.coindesk.com/policy/2026/08/11/u-s-sec-sets-meeting-to-propose-reg-crypto-to-support-certain-digital-assets-offerings',
  time: 1786421287742,
  symbols: [],
  sourceName: 'COINDESK',
  en: 'COINDESK: U.S. SEC sets meeting to propose Reg Crypto to support certain digital assets offerings',
  _id: '1786421287742CUSsmtpRCtscdao',
  suggestions: [],
};

const PROMO_TWEET = {
  _id: '2087028231790645738',
  source: 'Twitter',
  title:
    "Coin98 Super Wallet (@coin98_wallet): Remember this umbrella? ☂️👀\nMany of you asked where to get it.\n\nGood news! You might just walk away with one at @Convictionvn 2026 😉\n\nStop by the Coin98 booth, join the activities, and don't miss your chance to grab exclusive Coin98 merch 💛\n\nSee you there!",
  url: 'https://x.com/coin98_wallet/status/2087028231790645738',
  time: 1786421280441,
  info: { twitterId: '974473136983891968', truthId: null, isReply: false, isRetweet: false, isQuote: true, isSelfReply: false },
  suggestions: [],
};

const PAYLOAD = [UPBIT, BLOCK_TWEET, COINTELEGRAPH_BLOG, COINDESK_BLOG, PROMO_TWEET];

const opts = () => ({
  allowlist: buildFollowAllowlist(follows),
  publishers: buildPublisherMap(sources.feeds, []),
  socialFollowsOnly: true,
});

describe('field parsing against the real payload', () => {
  test('time is epoch milliseconds', () => {
    assert.equal(toPublishedAt(1786423547664).toISOString(), '2026-08-11T04:45:47.664Z');
  });

  test('seconds are tolerated too, so a format change degrades instead of writing 1970', () => {
    assert.equal(toPublishedAt(1786423547).toISOString(), '2026-08-11T04:45:47.000Z');
    assert.equal(toPublishedAt(null), null);
    assert.equal(toPublishedAt('banana'), null);
    assert.equal(toPublishedAt(0), null);
  });

  test('the English translation wins over a Korean exchange notice', () => {
    assert.ok(cleanTitle(UPBIT).startsWith('[Deposit/Withdrawal] Notice of temporary suspension'));
  });

  test('the publisher prefix is stripped so the title matches the newsroom RSS', () => {
    assert.equal(
      cleanTitle(COINTELEGRAPH_BLOG),
      "White House vows to get CLARITY across 'finish line' in September"
    );
    assert.equal(
      cleanTitle(COINDESK_BLOG),
      'U.S. SEC sets meeting to propose Reg Crypto to support certain digital assets offerings'
    );
  });

  test('tweet newlines are flattened and long posts are capped', () => {
    const title = cleanTitle(PROMO_TWEET);
    assert.ok(!title.includes('\n'));
    assert.ok(cleanTitle({ title: 'x'.repeat(500) }, 50).length <= 50);
    assert.ok(cleanTitle({ title: 'x'.repeat(500) }, 50).endsWith('…'));
  });

  test('handles are read from the URL, falling back to the title prefix', () => {
    assert.equal(socialHandle(BLOCK_TWEET.url, BLOCK_TWEET.title), 'TheBlockCo');
    assert.equal(socialHandle('https://truthsocial.com/@realDonaldTrump/posts/123', ''), 'realDonaldTrump');
    assert.equal(socialHandle('not a url', 'The Block (@TheBlockCo): something'), 'TheBlockCo');
    assert.equal(socialHandle('https://coindesk.com/x', 'no handle here'), null);
  });

  test('only social hosts are treated as social', () => {
    assert.equal(isSocialUrl('https://x.com/a/status/1'), true);
    assert.equal(isSocialUrl('https://truthsocial.com/@a/posts/1'), true);
    assert.equal(isSocialUrl('https://www.coindesk.com/policy/x'), false);
    assert.equal(isSocialUrl('https://upbit.com/service_center/notice?id=1'), false);
  });
});

describe('the follow list is the social filter', () => {
  test("the owner's own curation is what gets in", () => {
    const allow = buildFollowAllowlist(follows);
    assert.equal(allow.get('theblockco'), 'The Block');
    assert.equal(allow.get('coindesk'), 'CoinDesk');
    assert.equal(allow.get('realdonaldtrump'), 'Donald Trump'); // Truth Social too
    assert.equal(allow.has('coin98_wallet'), false);
  });

  test('a followed newsroom tweet is ingested', () => {
    const item = normalizeTreeNewsItem(BLOCK_TWEET, opts());
    assert.ok(item);
    assert.ok(item.title.startsWith('The Block (@TheBlockCo): NEW: UK lawmakers'));
  });

  test('the merch giveaway is dropped', () => {
    assert.equal(normalizeTreeNewsItem(PROMO_TWEET, opts()), null);
  });

  test('exchange notices are NEVER gated — a deposit halt is market-moving by definition', () => {
    const item = normalizeTreeNewsItem(UPBIT, opts());
    assert.ok(item);
    assert.equal(item.source, 'Upbit');
  });

  test('socialFollowsOnly:false lets everything through (the config escape hatch)', () => {
    const item = normalizeTreeNewsItem(PROMO_TWEET, { ...opts(), socialFollowsOnly: false });
    assert.ok(item);
    assert.equal(item.source, '@coin98_wallet');
  });
});

describe('source names collapse onto the publisher, not the relay', () => {
  // The digest's conviction bar counts DISTINCT SOURCES. One story read twice
  // must not look like two independent confirmations.
  test('a relayed blog item carries the same source string as the RSS feed', () => {
    assert.equal(normalizeTreeNewsItem(COINDESK_BLOG, opts()).source, 'CoinDesk');
    assert.equal(normalizeTreeNewsItem(COINTELEGRAPH_BLOG, opts()).source, 'Cointelegraph');
  });

  test('a followed newsroom tweet does too', () => {
    assert.equal(normalizeTreeNewsItem(BLOCK_TWEET, opts()).source, 'The Block');
  });

  test('the publisher map is derived from the configured feeds — no second list', () => {
    const map = buildPublisherMap(sources.feeds, []);
    assert.equal(map.get('COINDESK'), 'CoinDesk');
    assert.equal(map.get('THEBLOCK'), 'The Block');
    assert.equal(map.get('BITCOINMAGAZINE'), 'Bitcoin Magazine');
  });

  test('an unknown publisher keeps its own name rather than being relabelled', () => {
    const item = normalizeTreeNewsItem({ ...COINDESK_BLOG, sourceName: 'Some New Outlet' }, opts());
    assert.equal(item.source, 'Some New Outlet');
  });

  test('provenance is recorded but is not the source', () => {
    const item = normalizeTreeNewsItem(COINDESK_BLOG, opts());
    assert.equal(item.via, 'Tree News');
    assert.notEqual(item.source, 'Tree News');
  });
});

describe('dedupe against the existing newsroom RSS', () => {
  test('the doc id is the same URL hash the RSS feed would produce', () => {
    const item = normalizeTreeNewsItem(COINDESK_BLOG, opts());
    assert.equal(item.id, urlHash(COINDESK_BLOG.url));
  });

  test('the same story from both streams is written once, and the faster one wins', () => {
    const treeItem = normalizeTreeNewsItem(COINDESK_BLOG, opts());
    const rssItem = {
      id: urlHash(COINDESK_BLOG.url),
      title: 'U.S. SEC sets meeting to propose Reg Crypto to support certain digital assets offerings',
      url: COINDESK_BLOG.url,
      source: 'CoinDesk',
      publishedAt: new Date(),
    };
    const merged = collectHeadlines([
      ['tree-news', { status: 'fulfilled', value: { items: [treeItem], errors: [] } }],
      ['rss', { status: 'fulfilled', value: { items: [rssItem], errors: [] } }],
    ]);
    assert.equal(merged.items.length, 1);
    assert.equal(merged.items[0].via, 'Tree News'); // the earlier stream won
  });

  test('a tracking-param variant of the same article still collides', () => {
    const item = normalizeTreeNewsItem({ ...COINDESK_BLOG, url: `${COINDESK_BLOG.url}?utm_source=treenews` }, opts());
    assert.equal(item.id, urlHash(COINDESK_BLOG.url));
  });

  test('the stripped title matches the newsroom title, so title-dedupe also collapses them', () => {
    // The case a URL hash cannot catch: the newsroom republishes under a
    // different link. Without the prefix strip these would be two stories.
    const treeTitle = normalizeTreeNewsItem(COINTELEGRAPH_BLOG, opts()).title;
    assert.equal(
      titleKey(treeTitle),
      titleKey("White House vows to get CLARITY across 'finish line' in September")
    );
    const collapsed = shapeHeadlines([
      { title: treeTitle, url: 'https://relay.example/a' },
      { title: "White House vows to get CLARITY across 'finish line' in September", url: 'https://cointelegraph.com/news/x' },
    ]);
    assert.equal(collapsed.length, 1);
  });
});

describe('fetchTreeNews — never throws, always degrades', () => {
  function withFetch(impl, run) {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    return run().finally(() => {
      globalThis.fetch = original;
    });
  }
  const json = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const cfg = sources.treeNews;

  test('parses the live payload end to end', async () => {
    await withFetch(json(PAYLOAD), async () => {
      const { items, errors } = await fetchTreeNews(cfg, follows, sources.feeds);
      assert.equal(errors.length, 0);
      // 5 in: the promo tweet is filtered, the other four survive.
      assert.equal(items.length, 4);
      assert.deepEqual(items.map((i) => i.source), ['Upbit', 'The Block', 'Cointelegraph', 'CoinDesk']);
      assert.ok(items.every((i) => i.publishedAt instanceof Date));
      assert.ok(items.every((i) => i.id && i.title));
    });
  });

  test('accepts the common wrapper shapes as well as a bare array', async () => {
    await withFetch(json({ items: PAYLOAD }), async () => {
      assert.equal((await fetchTreeNews(cfg, follows, sources.feeds)).items.length, 4);
    });
    await withFetch(json({ data: PAYLOAD }), async () => {
      assert.equal((await fetchTreeNews(cfg, follows, sources.feeds)).items.length, 4);
    });
  });

  test('an unexpected payload shape reports an error and ingests nothing', async () => {
    await withFetch(json({ surprise: true }), async () => {
      const { items, errors } = await fetchTreeNews(cfg, follows, sources.feeds);
      assert.equal(items.length, 0);
      assert.match(errors[0].error, /unexpected payload shape/);
    });
  });

  test('a dead endpoint degrades this source alone', async () => {
    await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
      const { items, errors } = await fetchTreeNews(cfg, follows, sources.feeds);
      assert.equal(items.length, 0);
      assert.equal(errors.length, 1);
    });
  });

  test('an HTTP error degrades this source alone', async () => {
    await withFetch(async () => new Response('nope', { status: 503 }), async () => {
      const { errors } = await fetchTreeNews(cfg, follows, sources.feeds);
      assert.match(errors[0].error, /503/);
    });
  });

  test('a single malformed item never takes the batch down', async () => {
    await withFetch(json([null, 'garbage', { title: 'no time' }, { time: 1786423547664 }, COINDESK_BLOG]), async () => {
      const { items } = await fetchTreeNews(cfg, follows, sources.feeds);
      assert.equal(items.length, 1);
      assert.equal(items[0].source, 'CoinDesk');
    });
  });

  test('no config means the source is simply off', async () => {
    const { items, errors } = await fetchTreeNews(undefined, follows, sources.feeds);
    assert.equal(items.length, 0);
    assert.equal(errors.length, 0);
  });

  test('the shipped config points at the live endpoint with the filter on', () => {
    assert.equal(sources.treeNews.url, 'https://news.treeofalpha.com/api/news');
    assert.equal(sources.treeNews.socialFollowsOnly, true);
  });
});

describe('the digest never sees twins', () => {
  // The owner's stated requirement: Tree News carries the newsrooms' stories
  // minutes earlier, so it must dedupe like every other source rather than
  // creating twins in the briefing. URL-hash dedupe covers the same link;
  // this covers the same STORY reaching the model under two links.
  function fakeDbWithHeadlines(docs) {
    const chain = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      get: async () => ({ empty: docs.length === 0, docs: docs.map((d) => ({ data: () => d })) }),
    };
    return { collection: () => chain };
  }

  const story = 'U.S. SEC sets meeting to propose Reg Crypto to support certain digital assets offerings';
  const ts = (d) => ({ toDate: () => d });

  test('the same story from the relay and the newsroom reaches Claude once', async () => {
    const db = fakeDbWithHeadlines([
      { title: story, source: 'CoinDesk', url: 'https://relay.example/x', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
      { title: story, source: 'CoinDesk', url: 'https://coindesk.com/real', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
    ]);
    const inputs = await assembleDigestInputs(db, [], []);
    assert.equal(inputs.headlines.length, 1);
    // dataQuality is what the prompt keys its conviction bar off — it must
    // count evidence, not copies.
    assert.equal(inputs.dataQuality.headlineCount, 1);
  });

  test('genuinely different stories all survive', async () => {
    const db = fakeDbWithHeadlines([
      { title: story, source: 'CoinDesk', url: 'a', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
      { title: 'Something else entirely', source: 'The Block', url: 'b', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
    ]);
    const inputs = await assembleDigestInputs(db, [], []);
    assert.equal(inputs.headlines.length, 2);
    assert.equal(inputs.dataQuality.distinctSources, 2);
  });

  test('headline_index still resolves after deduping (links point at the right story)', async () => {
    const db = fakeDbWithHeadlines([
      { title: 'Dupe', source: 'A', url: 'https://relay.example/1', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
      { title: 'Dupe', source: 'A', url: 'https://newsroom.example/1', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
      { title: 'The real story', source: 'B', url: 'https://newsroom.example/2', ingestedAt: ts(new Date()), publishedAt: ts(new Date()) },
    ]);
    const inputs = await assembleDigestInputs(db, [], []);
    const linked = attachStoryLinks(
      { top_stories: [{ headline_index: 1, summary: 'The real story happened', source: 'B' }] },
      inputs
    );
    assert.equal(linked.top_stories[0].url, 'https://newsroom.example/2');
  });
});
