// The curated follow list (PRD §8): manual curation, deliberately NOT
// scraped — X API access is paid and fragile, so the app links out and the
// owner reads the accounts himself.
//
// This module only normalises `config/follows.json` into rows the card can
// render. Profile URLs are DERIVED from the platform rather than stored, so
// a typo in the config can never send the owner to the wrong account, and
// anything malformed is dropped rather than rendered as a broken link.

const PLATFORMS = {
  x: {
    label: 'X',
    badge: '𝕏',
    profileUrl: (handle) => `https://x.com/${handle}`,
    display: (handle) => `@${handle}`,
  },
  truthsocial: {
    label: 'Truth Social',
    badge: 'TS',
    profileUrl: (handle) => `https://truthsocial.com/@${handle}`,
    display: (handle) => `@${handle}`,
  },
};

export function platformMeta(platform) {
  return PLATFORMS[platform] || null;
}

// Handles are stored bare, but tolerate a pasted "@handle" or stray spaces.
function normalizeHandle(raw) {
  if (typeof raw !== 'string') return '';
  const handle = raw.trim().replace(/^@+/, '');
  // Anything with a slash, space or protocol is a URL someone pasted into
  // the wrong field — refuse it rather than build a nonsense link.
  return /^[A-Za-z0-9_.]{1,40}$/.test(handle) ? handle : '';
}

export function shapeFollowAccount(account) {
  const handle = normalizeHandle(account?.handle);
  const meta = platformMeta(account?.platform);
  if (!handle || !meta) return null;
  return {
    handle,
    display: meta.display(handle),
    name: typeof account?.name === 'string' && account.name.trim() ? account.name.trim() : meta.display(handle),
    note: typeof account?.note === 'string' ? account.note : '',
    platform: account.platform,
    platformLabel: meta.label,
    badge: meta.badge,
    url: meta.profileUrl(handle),
    inDigest: account?.inDigest === true,
  };
}

export function shapeFollowGroups(config) {
  const groups = Array.isArray(config?.groups) ? config.groups : [];
  return groups
    .map((group) => ({
      name: typeof group?.name === 'string' ? group.name : '',
      blurb: typeof group?.blurb === 'string' ? group.blurb : '',
      accounts: (Array.isArray(group?.accounts) ? group.accounts : [])
        .map(shapeFollowAccount)
        .filter(Boolean),
    }))
    .filter((group) => group.accounts.length > 0);
}

export function countFollows(groups) {
  return groups.reduce((total, group) => total + group.accounts.length, 0);
}
