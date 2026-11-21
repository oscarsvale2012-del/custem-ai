// Tests for the Roblox account link and revenue features.
// Real Roblox APIs are called where no sign-in is needed; the signed-in parts
// use a fake roblox.com that answers with the same JSON shapes.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}

(async () => {
  // fake Analytics API: first answers "pending", then the finished result
  let polls = 0;
  const srv = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-api-key"] !== "test-key-1234567890abcdef") { res.statusCode = 401; return res.end("{}"); }
    if (req.method === "POST") { res.statusCode = 202; return res.end(JSON.stringify({ path: "universes/42/operations/metrics/op-1", done: false })); }
    polls++;
    res.end(JSON.stringify({ path: "universes/42/operations/metrics/op-1", done: true, response: { values: [{ breakdowns: [], dataPoints: [
      { time: "2026-11-19T00:00:00Z", value: 157 }, { time: "2026-11-18T00:00:00Z", value: 40 } ] }] } }));
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.AF_ANALYTICS_BASE = `http://127.0.0.1:${srv.address().port}/universes`;
  const AN = require("../src/analytics");
  const RA = require("../src/robloxAccount");

  console.log("Official Analytics API");
  await test("query → poll → daily points, sorted by date", async () => {
    const pts = await AN.queryMetric("test-key-1234567890abcdef", "42", "DailyRevenue", 30);
    assert.deepEqual(pts.map((p) => p.value), [40, 157]);
    assert(polls >= 1);
  });
  await test("wrong key is reported as rejected", async () => {
    const m = await AN.gameMetrics("bad-key-0000000000000000", "42", 7);
    assert(/rejected/.test(m.fatal));
  });

  console.log("Real Roblox APIs (no sign-in)");
  await test("real Analytics API rejects an invalid key with a clear message", async () => {
    const saved = process.env.AF_ANALYTICS_BASE; delete process.env.AF_ANALYTICS_BASE;
    try { await assert.rejects(AN.queryMetric("not-a-real-key-000000000000", "383310974", "DailyRevenue", 3), (e) => e.kind === "auth"); }
    finally { process.env.AF_ANALYTICS_BASE = saved; }
  });
  const plain = (u) => fetch(u, { headers: { Accept: "application/json" } });
  await test("without a Roblox session nobody is signed in", async () => {
    assert.equal(await RA.whoAmI(plain), null);
  });
  await test("Robux summary without a session asks to link again", async () => {
    await assert.rejects(RA.summary(plain, "1"), (e) => e.kind === "auth" && /Link your account again/.test(e.message));
  });
  await test("owned games are listed with real icons", async () => {
    const g = await RA.ownedGames("1");
    assert(g.length > 0, "no games");
    assert(g[0].universeId && g[0].name);
    assert(g.some((x) => /^https:\/\//.test(x.iconUrl || "")), "no icon urls");
  });

  console.log("Linking flow (fake roblox.com session)");
  const totals = (tf) => ({ salesTotal: tf === "Day" ? 12 : 157, purchasesTotal: -6711, currencyPurchasesTotal: 2500, premiumStipendsTotal: 0, pendingRobuxTotal: 139, incomingRobuxTotal: 2657, outgoingRobuxTotal: -6759, individualToGroupTotal: 0 });
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    let body;
    if (u.pathname === "/v1/users/authenticated") body = { id: 1, name: "Roblox", displayName: "Roblox" };
    else if (/\/currency$/.test(u.pathname)) body = { robux: 2657 };
    else if (/transaction-totals/.test(u.pathname)) body = totals(u.searchParams.get("timeFrame"));
    else return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  let loggedOut = false;
  const TMP = path.join(__dirname, "..", ".testdata-rev");
  fs.rmSync(TMP, { recursive: true, force: true });
  const { Backend } = require("../src/backend");
  const be = new Backend({ dataDir: TMP, encrypt: (s) => "x:" + Buffer.from(s).toString("hex"), decrypt: (s) => Buffer.from(s.slice(2), "hex").toString(),
    host: { robloxLogin: async () => {}, robloxFetch: fakeFetch, robloxLogout: async () => { loggedOut = true; } } });
  await be.init();
  await test("link → account, balance, pending and summary lines", async () => {
    const me = await be.linkRoblox();
    assert.equal(me.name, "Roblox");
    const R = be.publicState().revenue;
    assert.equal(R.summary.balance, 2657);
    assert.equal(R.summary.pending, 139);
    assert.equal(R.summary.day.sales, 12);
    assert.equal(R.summary.month.outgoing, 6759);
    const labels = R.summary.month.lines.map((l) => l.label);
    assert(labels.includes("Sales of goods") && labels.includes("Currency purchases") && labels.includes("Purchases"));
    assert(R.summary.month.lines.find((l) => l.label === "Purchases").outgoing);
    assert.equal(R.history.length, 1);
    assert.equal(R.history[0].pending, 139);
    assert(calls.every((c) => new URL(c).hostname.endsWith("roblox.com")), "session used for a non-Roblox host");
  });
  await test("Open Cloud key is stored encrypted and never in public state", async () => {
    be.setRobloxApiKey("test-key-1234567890abcdef");
    be.store.saveNow();
    assert(!fs.readFileSync(path.join(TMP, "agentforge-data.json"), "utf8").includes("test-key-1234567890abcdef"));
    assert(!JSON.stringify(be.publicState()).includes("test-key-1234567890abcdef"));
    assert.equal(be.publicState().revenue.hasApiKey, true);
  });
  await test("unlink signs out and forgets the account", async () => {
    await be.unlinkRoblox();
    assert(loggedOut);
    assert.equal(be.publicState().revenue.account, null);
  });
  await test("without the desktop app, linking explains why", async () => {
    const be2 = new Backend({ dataDir: TMP + "2", encrypt: (s) => s, decrypt: (s) => s });
    await assert.rejects(be2.linkRoblox(), /desktop app/);
  });

  await be.shutdown();
  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(TMP + "2", { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
