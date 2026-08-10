// Offline tests for the curated follow list (PRD §8). The risk here is a
// silently wrong link — sending the owner to the wrong account is worse
// than showing nothing — so the shaping is strict and the shipped config
// is asserted against it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countFollows,
  platformMeta,
  shapeFollowAccount,
  shapeFollowGroups,
} from '../lib/follows.js';
import followList from '../config/follows.json' with { type: 'json' };

test('derives the profile URL from the platform', () => {
  assert.equal(
    shapeFollowAccount({ handle: 'DeItaone', platform: 'x' }).url,
    'https://x.com/DeItaone',
  );
  assert.equal(
    shapeFollowAccount({ handle: 'realDonaldTrump', platform: 'truthsocial' }).url,
    'https://truthsocial.com/@realDonaldTrump',
  );
});

test('tolerates a pasted @handle and surrounding space', () => {
  const account = shapeFollowAccount({ handle: '  @WatcherGuru ', platform: 'x' });
  assert.equal(account.handle, 'WatcherGuru');
  assert.equal(account.display, '@WatcherGuru');
  assert.equal(account.url, 'https://x.com/WatcherGuru');
});

test('drops anything that would render a wrong or broken link', () => {
  assert.equal(shapeFollowAccount({ handle: 'CoinDesk', platform: 'mastodon' }), null);
  assert.equal(shapeFollowAccount({ handle: '', platform: 'x' }), null);
  assert.equal(shapeFollowAccount({ platform: 'x' }), null);
  // A URL pasted into the handle field must not be concatenated into one.
  assert.equal(shapeFollowAccount({ handle: 'https://x.com/tradfi', platform: 'x' }), null);
  assert.equal(shapeFollowAccount({ handle: 'two words', platform: 'x' }), null);
});

test('falls back to the handle when no display name is given', () => {
  assert.equal(shapeFollowAccount({ handle: 'tradfi', platform: 'x' }).name, '@tradfi');
});

test('shapeFollowGroups drops groups left with no usable accounts', () => {
  const groups = shapeFollowGroups({
    groups: [
      { name: 'Good', accounts: [{ handle: 'CoinDesk', platform: 'x' }] },
      { name: 'All broken', accounts: [{ handle: 'x', platform: 'nope' }] },
      { name: 'Empty', accounts: [] },
    ],
  });
  assert.deepEqual(groups.map((g) => g.name), ['Good']);
  assert.equal(countFollows(groups), 1);
});

test('shapeFollowGroups degrades on a malformed config instead of throwing', () => {
  assert.deepEqual(shapeFollowGroups(null), []);
  assert.deepEqual(shapeFollowGroups({}), []);
  assert.deepEqual(shapeFollowGroups({ groups: 'nope' }), []);
  assert.equal(countFollows([]), 0);
});

test('the shipped follow list survives shaping intact', () => {
  const configured = followList.groups.reduce((n, g) => n + g.accounts.length, 0);
  const groups = shapeFollowGroups(followList);
  assert.equal(countFollows(groups), configured, 'an entry was dropped — check handle/platform');
  for (const group of groups) {
    for (const account of group.accounts) {
      assert.ok(platformMeta(account.platform), `unknown platform for ${account.handle}`);
      assert.ok(account.note.length > 0, `${account.handle} needs a "how to read it" note`);
      assert.ok(account.url.startsWith('https://'), `${account.handle} has a non-https URL`);
    }
  }
});

test('Trump is on Truth Social, not X', () => {
  const [account] = shapeFollowGroups(followList)
    .flatMap((g) => g.accounts)
    .filter((a) => a.name === 'Donald Trump');
  assert.equal(account.platform, 'truthsocial');
  assert.equal(account.url, 'https://truthsocial.com/@realDonaldTrump');
});
