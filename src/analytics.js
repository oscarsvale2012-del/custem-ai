// Roblox Open Cloud Analytics Query API (official). Needs an Open Cloud API key
// with the universe.analytics:read permission for each experience.
// Queries are asynchronous: POST a query, then poll its operation until done.
const base = () => process.env.AF_ANALYTICS_BASE || "https://apis.roblox.com/analytics-query-api/v1/universes";

const METRICS = [
  ["revenue", "DailyRevenue"],
  ["dau", "DailyActiveUsers"],
  ["playtime", "AveragePlayTimeMinutesPerDAU"],
  ["d1", "ForwardD1Retention"],
];

class AnalyticsError extends Error { constructor(kind, msg, status) { super(msg); this.kind = kind; this.status = status; } }

// Spaces requests out to stay under the 30 queries/minute limit.
let chain = Promise.resolve();
const throttle = (fn) => { const p = chain.then(fn, fn); chain = p.then(() => wait(2100), () => wait(2100)); return p; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(apiKey, method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, headers: { "x-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new AnalyticsError("connection", "Cannot reach apis.roblox.com"); }
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401) throw new AnalyticsError("auth", "The Open Cloud API key was rejected", 401);
  if (r.status === 403) throw new AnalyticsError("forbidden", "This API key has no universe.analytics:read permission for this game", 403);
  if (r.status === 429) throw new AnalyticsError("rate", "Roblox rate limit reached — the app will retry later", 429);
  if (!r.ok && r.status !== 202) throw new AnalyticsError("other", j?.message || j?.error?.message || `Analytics API error ${r.status}`, r.status);
  return j || {};
}

/** Run one metric query (daily points) and return [{time, value}]. */
async function queryMetric(apiKey, universeId, metric, days) {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  let op = await throttle(() => call(apiKey, "POST", `${base()}/${universeId}/metrics`, { metric, granularity: "OneDay", startTime: start.toISOString(), endTime: end.toISOString() }));
  for (let i = 0; !op.done && i < 20; i++) {
    const id = String(op.path || "").split("/").pop();
    if (!id) throw new AnalyticsError("other", "Analytics API returned no operation id");
    await wait(Math.min(1000 * 2 ** i, 8000));
    op = await throttle(() => call(apiKey, "GET", `${base()}/${universeId}/operations/metrics/${id}`));
  }
  if (!op.done) throw new AnalyticsError("other", "Analytics query took too long");
  if (op.error) throw new AnalyticsError("other", op.error.message || "Analytics query failed");
  const series = op.response?.values?.[0]?.dataPoints || [];
  return series.map((p) => ({ time: p.time, value: Number(p.value) || 0 })).sort((a, b) => a.time.localeCompare(b.time));
}

/** All dashboard metrics for one game. Missing metrics are reported per metric. */
async function gameMetrics(apiKey, universeId, days = 30) {
  const out = { universeId, fetchedAt: Date.now(), series: {}, errors: {} };
  for (const [key, metric] of METRICS) {
    try { out.series[key] = await queryMetric(apiKey, universeId, metric, days); }
    catch (e) {
      out.errors[key] = e.message;
      if (e.kind === "auth" || e.kind === "forbidden") { out.fatal = e.message; break; }
    }
  }
  return out;
}

module.exports = { gameMetrics, queryMetric, AnalyticsError };
