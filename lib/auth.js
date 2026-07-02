// Cron endpoint protection. Vercel Cron automatically sends
// "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET env var is set.
// Manual/curl calls must send the same header.

export function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // no secret configured -> everything rejected
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
}
