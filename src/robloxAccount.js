// Linked Roblox account. The user signs in on roblox.com inside an app window;
// the session stays in Electron's own encrypted cookie store and is only sent
// to roblox.com. These are the same endpoints the Roblox website uses for the
// Robux summary page — Roblox offers no official API for pending Robux.

const sessionFetch = async (fetcher, url) => {
  let r;
  try { r = await fetcher(url); } catch { throw Object.assign(new Error("Cannot reach roblox.com"), { kind: "connection" }); }
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error("Roblox sign-in expired. Link your account again."), { kind: "auth" });
  if (r.status === 429) throw Object.assign(new Error("Roblox is rate limiting requests. Try again in a minute."), { kind: "rate" });
  if (!r.ok) throw Object.assign(new Error(`Roblox returned ${r.status} for ${new URL(url).hostname}`), { kind: "other" });
  return r.json();
};

const publicFetch = (url) => sessionFetch((u) => fetch(u, { headers: { "User-Agent": "AgentForge/0.2", Accept: "application/json" } }), url);

const LABELS = {
  salesTotal: "Sales of goods",
  currencyPurchasesTotal: "Currency purchases",
  premiumStipendsTotal: "Robux stipends",
  premiumPayoutsTotal: "Premium payouts",
  groupPayoutsTotal: "Group payouts",
  groupPremiumPayoutsTotal: "Group Premium payouts",
  affiliateSalesTotal: "Affiliate sales",
  publishingAdvanceRebatesTotal: "Publishing advance rebates",
  creatorRewardsTotal: "Creator rewards",
  adsRevsharePayoutsTotal: "Ads revenue share",
  subscriptionsRevshareTotal: "Subscriptions",
  tradeSystemEarningsTotal: "Trade earnings",
  csAdjustmentTotal: "Roblox adjustments",
  individualToGroupTotal: "Robux transfers sent",
  purchasesTotal: "Purchases",
  tradeSystemCostsTotal: "Trade costs",
  adSpendTotal: "Ad spend",
  developerExchangeTotal: "DevEx",
};
const OUTGOING = new Set(["purchasesTotal", "individualToGroupTotal", "tradeSystemCostsTotal", "adSpendTotal", "developerExchangeTotal", "subscriptionsRevshareOutgoingTotal", "groupSubscriptionsRevshareOutgoingTotal"]);

/** Who is signed in (null if nobody). */
async function whoAmI(fetcher) {
  try {
    const me = await sessionFetch(fetcher, "https://users.roblox.com/v1/users/authenticated");
    return { userId: String(me.id), name: me.name, displayName: me.displayName || me.name };
  } catch (e) {
    if (e.kind === "auth") return null;
    throw e;
  }
}

async function avatarUrl(userId) {
  try {
    const j = await publicFetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
    return j.data?.[0]?.state === "Completed" ? j.data[0].imageUrl : null;
  } catch { return null; }
}

/** Public experiences owned by the user. */
async function ownedGames(userId) {
  try {
    const j = await publicFetch(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=2&limit=50&sortOrder=Desc`);
    const games = (j.data || []).map((g) => ({ universeId: String(g.id), placeId: String(g.rootPlace?.id || ""), name: g.name, visits: g.placeVisits || 0, updated: g.updated, iconUrl: null }));
    if (games.length) {
      const icons = await publicFetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${games.map((g) => g.universeId).join(",")}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`).catch(() => ({ data: [] }));
      for (const i of icons.data || []) { const g = games.find((x) => x.universeId === String(i.targetId)); if (g && i.state === "Completed") g.iconUrl = i.imageUrl; }
    }
    return games;
  } catch { return []; }
}

/** Robux balance + transaction totals for Day/Week/Month/Year. */
async function summary(fetcher, userId) {
  const [cur, ...frames] = await Promise.all([
    sessionFetch(fetcher, `https://economy.roblox.com/v1/users/${userId}/currency`),
    ...["Day", "Week", "Month", "Year"].map((tf) => sessionFetch(fetcher, `https://economy.roblox.com/v2/users/${userId}/transaction-totals?timeFrame=${tf}&transactionType=summary`)),
  ]);
  const shape = (t) => ({
    incoming: t.incomingRobuxTotal ?? 0,
    outgoing: Math.abs(t.outgoingRobuxTotal ?? 0),
    sales: t.salesTotal ?? 0,
    pending: t.pendingRobuxTotal ?? 0,
    lines: Object.entries(t)
      .filter(([k, v]) => typeof v === "number" && v !== 0 && k.endsWith("Total") && !["incomingRobuxTotal", "outgoingRobuxTotal", "pendingRobuxTotal"].includes(k))
      .map(([k, v]) => ({ key: k, label: LABELS[k] || k.replace(/Total$/, "").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), value: Math.abs(v), outgoing: OUTGOING.has(k) || v < 0 })),
  });
  const [day, week, month, year] = frames.map(shape);
  return { balance: cur.robux ?? 0, pending: year.pending || month.pending || day.pending, day, week, month, year, fetchedAt: Date.now() };
}

module.exports = { whoAmI, avatarUrl, ownedGames, summary };
