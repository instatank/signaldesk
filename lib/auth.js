// Cron endpoint protection. Vercel Cron automatically sends
// "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET env var is set.
// Manual/curl calls must send the same header.

export function isAuthorized(request) {
  return matchesBearer(request, process.env.CRON_SECRET);
}

// The TradeGenie bridge (/api/snapshot) uses its own secret, deliberately
// NOT CRON_SECRET: that key can trigger digests and ingests, and the other
// app has no business holding it. A read-only endpoint gets a read-only key,
// so it can be rotated — or leaked — without touching the pipeline.
export function isSnapshotAuthorized(request) {
  return matchesBearer(request, process.env.SNAPSHOT_TOKEN);
}

function matchesBearer(request, secret) {
  if (!secret) return false; // no secret configured -> everything rejected
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
}
