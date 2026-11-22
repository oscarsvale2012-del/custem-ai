// Robux → Danish kroner at the official DevEx rate.
// - DevEx rate (USD per earned Robux): read from Roblox's official DevEx page.
// - USD → DKK: the European Central Bank's daily reference rates.
// Falls back to the last known values if a page can't be read.
const DEVEX_URL = "https://create.roblox.com/docs/production/monetization/developer-exchange";
const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const FALLBACK = { usdPerRobux: 0.0038, dkkPerUsd: 6.8 };
const MIN_ROBUX = 30000;

async function getText(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: { "User-Agent": "VYRON desktop app" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}`);
  return r.text();
}

function parseDevex(html) {
  const text = String(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const m = text.match(/standard exchange rate for the DevEx program is[^0-9]{0,40}(0\.\d{3,5})/i) || text.match(/\$\s?(0\.00\d{2,3})\s*(?:USD)?\s*per (?:1 )?Earned Robux/i);
  const v = m ? Number(m[1]) : NaN;
  if (!(v > 0.001 && v < 0.05)) throw new Error("DevEx rate not found on the Roblox page");
  return v;
}

function parseEcb(xml) {
  const rate = (c) => { const m = String(xml).match(new RegExp(`currency=['"]${c}['"]\\s+rate=['"]([\\d.]+)`)); return m ? Number(m[1]) : NaN; };
  const usd = rate("USD"), dkk = rate("DKK");
  if (!(usd > 0 && dkk > 0)) throw new Error("ECB rates not found");
  const date = (String(xml).match(/time=['"](\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  return { dkkPerUsd: dkk / usd, date };
}

/** prev = last result (kept when a source fails). */
async function fetchRates(fetchImpl = globalThis.fetch, prev = null) {
  const out = {
    usdPerRobux: prev?.usdPerRobux || FALLBACK.usdPerRobux, devexLive: false,
    dkkPerUsd: prev?.dkkPerUsd || FALLBACK.dkkPerUsd, ecbDate: prev?.ecbDate || null, ecbLive: false,
    minRobux: MIN_ROBUX, errors: [], fetchedAt: Date.now(), sources: { devex: DEVEX_URL, ecb: ECB_URL },
  };
  await Promise.all([
    getText(fetchImpl, DEVEX_URL).then((h) => { out.usdPerRobux = parseDevex(h); out.devexLive = true; }).catch((e) => out.errors.push("DevEx: " + e.message)),
    getText(fetchImpl, ECB_URL).then((x) => { const r = parseEcb(x); out.dkkPerUsd = r.dkkPerUsd; out.ecbDate = r.date; out.ecbLive = true; }).catch((e) => out.errors.push("ECB: " + e.message)),
  ]);
  out.dkkPerRobux = out.usdPerRobux * out.dkkPerUsd;
  return out;
}

const toDkk = (robux, rates) => (Number(robux) || 0) * (rates?.dkkPerRobux || FALLBACK.usdPerRobux * FALLBACK.dkkPerUsd);

module.exports = { fetchRates, parseDevex, parseEcb, toDkk, DEVEX_URL, ECB_URL, MIN_ROBUX, FALLBACK };
