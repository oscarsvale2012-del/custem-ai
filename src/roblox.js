// Roblox game information from Roblox's public web APIs, plus helpers for
// reading which places are open in Roblox Studio through the Studio MCP server.

const UA = { "User-Agent": "VYRON/0.2 (desktop app)", Accept: "application/json" };

async function getJson(url) {
  let r;
  try { r = await fetch(url, { headers: UA }); } catch { throw new Error("Cannot reach roblox.com"); }
  if (!r.ok) throw new Error(`Roblox API ${r.status} for ${new URL(url).hostname}`);
  return r.json();
}

async function universeFromPlace(placeId) {
  const j = await getJson(`https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`);
  if (!j.universeId) throw new Error("No game found for that Place ID");
  return String(j.universeId);
}

/** Look up a game by universeId or placeId. Returns real data or throws. */
async function lookupGame({ universeId, placeId }) {
  universeId = String(universeId || "").trim();
  placeId = String(placeId || "").trim();
  if (!universeId && placeId && placeId !== "0") universeId = await universeFromPlace(placeId);
  if (!universeId || universeId === "0") throw new Error("This place is not published yet, so Roblox has no icon or game page for it.");

  const [games, icons] = await Promise.all([
    getJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
    getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`).catch(() => ({ data: [] })),
  ]);
  const g = games.data?.[0];
  if (!g) throw new Error("Roblox did not return a game for Universe ID " + universeId);
  const icon = icons.data?.[0];
  return {
    universeId: String(g.id),
    placeId: String(g.rootPlaceId || placeId || ""),
    name: g.name,
    description: g.description || "",
    creator: g.creator?.name || "",
    playing: g.playing || 0,
    visits: g.visits || 0,
    updated: g.updated || null,
    iconUrl: icon && icon.state === "Completed" ? icon.imageUrl : null,
    fetchedAt: Date.now(),
  };
}

/** Parse list_roblox_studios output from the Studio MCP server. */
function parseStudios(text) {
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j.studios || [];
    return arr.map((s) => ({
      id: String(s.id ?? s.studio_id ?? ""),
      name: s.name || "Roblox Studio",
      mode: s.mode || "",
      state: s.state || "",
      placeId: s.placeId != null ? String(s.placeId) : "",
      universeId: s.universeId != null ? String(s.universeId) : "",
      file: s.file || "",
      persisted: !!s.persistedToCloud,
    }));
  } catch {
    throw new Error("Studio MCP returned an unexpected answer");
  }
}

module.exports = { lookupGame, parseStudios };
