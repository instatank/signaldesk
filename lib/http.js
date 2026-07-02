// Small fetch helpers with a hard timeout, so one slow upstream can never
// hang a cron run past Vercel's function limit.

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  return fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function fetchJson(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchText(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}
