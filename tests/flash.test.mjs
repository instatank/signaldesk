// Offline tests for the flash (on-demand briefing) layer: the pure cooldown
// math, the countdown formatter, and that the digest-inputs window is
// genuinely parameterized (flash mode leads on 4h; scheduled default is
// untouched). No network, no Firestore, no secrets.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { flashCooldownState, formatCountdown, FLASH_COOLDOWN_MS } from '../lib/flash.js';
import { assembleDigestInputs } from '../lib/digest.js';

describe('flash cooldown', () => {
  const now = new Date('2026-07-08T12:00:00Z');

  test('no prior run → not on cooldown', () => {
    assert.deepEqual(flashCooldownState(null, now), { active: false, remainingSec: 0 });
  });

  test('a run 3 min ago is still cooling down (10-min window)', () => {
    const ref = new Date(now.getTime() - 3 * 60 * 1000);
    const state = flashCooldownState(ref, now);
    assert.equal(state.active, true);
    assert.equal(state.remainingSec, 7 * 60); // 7 minutes left
  });

  test('a run 10 min ago has cleared', () => {
    const ref = new Date(now.getTime() - FLASH_COOLDOWN_MS);
    assert.equal(flashCooldownState(ref, now).active, false);
  });

  test('formatCountdown renders minutes+seconds and seconds-only', () => {
    assert.equal(formatCountdown(7 * 60 + 20), '7m 20s');
    assert.equal(formatCountdown(45), '45s');
    assert.equal(formatCountdown(0), '');
  });
});

describe('digest-inputs window is parameterized', () => {
  const now = Date.now();
  // A fake Firestore query that records the ingestedAt >= cutoff it was
  // handed, so we can assert the window without a real DB.
  function fakeDb(recordCutoff) {
    const chain = {
      where(field, op, value) {
        if (field === 'ingestedAt' && op === '>=') recordCutoff(value);
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      get: async () => ({ empty: true, docs: [] }),
    };
    return { collection: () => chain };
  }

  test('flash mode pulls a 12h window and tags mode + 4h recency', async () => {
    let cutoff = null;
    const inputs = await assembleDigestInputs(fakeDb((v) => (cutoff = v)), [], [], {
      windowHours: 12,
      recentHours: 4,
      mode: 'flash',
    });
    const hoursBack = (now - cutoff.getTime()) / 3_600_000;
    assert.ok(Math.abs(hoursBack - 12) < 0.1, `expected ~12h window, got ${hoursBack}`);
    assert.equal(inputs.mode, 'flash');
    assert.equal(inputs.recentWindowHours, 4);
  });

  test('default (scheduled) still pulls 24h and tags mode=scheduled/24h recency', async () => {
    let cutoff = null;
    const inputs = await assembleDigestInputs(fakeDb((v) => (cutoff = v)), []);
    const hoursBack = (now - cutoff.getTime()) / 3_600_000;
    assert.ok(Math.abs(hoursBack - 24) < 0.1, `expected ~24h window, got ${hoursBack}`);
    assert.equal(inputs.mode, 'scheduled');
    // One briefing a day: the whole 24h window is "recent" to the reader.
    assert.equal(inputs.recentWindowHours, 24);
  });
});
