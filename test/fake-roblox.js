// Dev/test only: a fake signed-in roblox.com and a fake Analytics API, so the
// Revenue page can be checked in the browser without a real account.
// Used by src/devserver.js when AF_DEMO_ROBLOX=1. Not part of the app build.
const http = require("http");

const totals = (tf) => ({ salesTotal: { Day: 12, Week: 64, Month: 157, Year: 157 }[tf], purchasesTotal: -6711, currencyPurchasesTotal: 2500, premiumStipendsTotal: 0,
  pendingRobuxTotal: 139, incomingRobuxTotal: { Day: 12, Week: 64, Month: 2657, Year: 2657 }[tf], outgoingRobuxTotal: -6759, individualToGroupTotal: -48 });

const fakeHost = {
  robloxLogin: async () => {},
  robloxLogout: async () => {},
  robloxFetch: async (url) => {
    const u = new URL(url);
    let body;
    if (u.pathname === "/v1/users/authenticated") body = { id: 1, name: "DemoCreator", displayName: "Demo Creator" };
    else if (/\/currency$/.test(u.pathname)) body = { robux: 2657 };
    else if (/transaction-totals/.test(u.pathname)) body = totals(u.searchParams.get("timeFrame"));
    else return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  },
};

function fakeAnalytics() {
  const series = (metric) => {
    const out = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i);
      const t = 30 - i;
      const v = { DailyRevenue: Math.round(20 + t * 4 + 25 * Math.sin(t / 2.5)), DailyActiveUsers: 3 + (t % 5), AveragePlayTimeMinutesPerDAU: 40 + (t % 7) * 3, ForwardD1Retention: 0.5 }[metric];
      out.push({ time: d.toISOString(), value: Math.max(0, v) });
    }
    return out;
  };
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      const metric = req.method === "POST" ? JSON.parse(body).metric : decodeURIComponent(req.url.split("/").pop());
      res.end(JSON.stringify({ path: "op/" + metric, done: true, response: { values: [{ dataPoints: series(metric) }] } }));
    });
  });
  return new Promise((r) => srv.listen(5198, () => r(srv)));
}

module.exports = { fakeHost, fakeAnalytics };
