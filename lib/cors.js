// Lets the owner's browser (e.g. a test-run page) call these cron
// endpoints directly. The endpoints are still gated by CRON_SECRET in
// lib/auth.js — this only allows the response to be read cross-origin.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
};

export function withCors(response) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
