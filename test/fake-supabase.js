// Dev/test only: a small fake Supabase (Auth + the vyron_data table) that answers
// like the real one, so VYRON accounts can be tested without a real project.
// Codes that would be emailed are kept in `codes` so tests can read them.
const http = require("http");
const crypto = require("crypto");

function fakeSupabase({ key = "test-anon-key" } = {}) {
  const users = new Map(); // email -> { id, email, password, confirmed }
  const codes = new Map(); // email -> { code, type }
  const access = new Map(); // access token -> { id, exp }
  const refresh = new Map(); // refresh token -> id
  const rows = new Map(); // user id -> { data, updated_at }
  const sent = [];
  const pkce = new Map(); // code -> { challenge, email }
  let googleEmail = "gamer@gmail.com";
  const tok = () => crypto.randomBytes(16).toString("hex");
  const byId = (id) => [...users.values()].find((u) => u.id === id);
  const mail = (email, type) => { const code = String(crypto.randomInt(100000, 999999)); codes.set(email, { code, type }); sent.push({ email, type, code }); };
  const session = (u) => { const a = tok(), r = tok(); access.set(a, { id: u.id, exp: Date.now() + 3600e3 }); refresh.set(r, u.id); return { access_token: a, refresh_token: r, expires_in: 3600, token_type: "bearer", user: { id: u.id, email: u.email } }; };

  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }); res.end(o === undefined ? "" : JSON.stringify(o)); };
      if (req.method === "OPTIONS") return send(204);
      const u0 = new URL(req.url, "http://x");
      if (u0.pathname === "/auth/v1/authorize") { // pretend the person picked their Google account
        const code = tok(); pkce.set(code, { challenge: u0.searchParams.get("code_challenge"), email: googleEmail });
        res.writeHead(302, { Location: u0.searchParams.get("redirect_to") + "?code=" + code }); return res.end();
      }
      if (req.headers.apikey !== key) return send(401, { message: "Invalid API key" });
      const u = new URL(req.url, "http://x");
      const j = body ? JSON.parse(body) : {};
      const bearer = String(req.headers.authorization || "").replace(/^Bearer /, "");
      const me = access.get(bearer);
      const authed = me && me.exp > Date.now() ? byId(me.id) : null;
      const email = String(j.email || "").toLowerCase();
      const p = u.pathname;

      if (p === "/auth/v1/signup" && req.method === "POST") {
        const ex = users.get(email);
        if (ex && ex.confirmed) return send(200, { id: crypto.randomUUID(), email, identities: [] });
        if (String(j.password || "").length < 8) return send(422, { error_code: "weak_password", msg: "Password should be at least 8 characters." });
        const user = ex || { id: crypto.randomUUID(), email, confirmed: false };
        user.password = j.password; users.set(email, user);
        mail(email, "signup");
        return send(200, { id: user.id, email, identities: [{ id: user.id }] });
      }
      if (p === "/auth/v1/token" && req.method === "POST") {
        if (u.searchParams.get("grant_type") === "refresh_token") {
          const id = refresh.get(j.refresh_token);
          if (!id) return send(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
          refresh.delete(j.refresh_token);
          return send(200, session(byId(id)));
        }
        if (u.searchParams.get("grant_type") === "pkce") {
          const g = pkce.get(j.auth_code); pkce.delete(j.auth_code);
          if (!g || crypto.createHash("sha256").update(String(j.code_verifier)).digest("base64url") !== g.challenge) return send(400, { error_code: "bad_code_verifier", msg: "code challenge does not match previously saved code verifier" });
          let gu = users.get(g.email); if (!gu) { gu = { id: crypto.randomUUID(), email: g.email, confirmed: true, password: null }; users.set(g.email, gu); }
          return send(200, session(gu));
        }
        const user = users.get(email);
        if (!user || user.password !== j.password) return send(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
        if (!user.confirmed) return send(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
        return send(200, session(user));
      }
      if (p === "/auth/v1/otp" && req.method === "POST") {
        if (!users.get(email)?.confirmed) return send(422, { error_code: "otp_disabled", msg: "Signups not allowed for otp" });
        mail(email, "email"); return send(200, {});
      }
      if (p === "/auth/v1/recover" && req.method === "POST") { if (users.get(email)) mail(email, "recovery"); return send(200, {}); }
      if (p === "/auth/v1/resend" && req.method === "POST") { if (users.get(email)) mail(email, j.type); return send(200, {}); }
      if (p === "/auth/v1/verify" && req.method === "POST") {
        const c = codes.get(email), user = users.get(email);
        const okType = c && (c.type === j.type || (j.type === "email" && c.type === "email"));
        if (!user || !okType || c.code !== String(j.token)) return send(403, { error_code: "otp_expired", msg: "Token has expired or is invalid" });
        codes.delete(email); user.confirmed = true;
        return send(200, session(user));
      }
      if (p === "/auth/v1/user" && req.method === "PUT") {
        if (!authed) return send(401, { msg: "invalid JWT" });
        if (String(j.password || "").length < 8) return send(422, { msg: "Password should be at least 8 characters." });
        authed.password = j.password; return send(200, { id: authed.id, email: authed.email });
      }
      if (p === "/auth/v1/logout" && req.method === "POST") { access.delete(bearer); return send(204); }

      if (p === "/rest/v1/vyron_data") {
        if (!authed) return send(401, { message: "JWT expired" });
        if (req.method === "GET") {
          const want = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
          const r = want === authed.id ? rows.get(want) : null; // row level security
          return send(200, r ? [{ data: r.data, updated_at: r.updated_at }] : []);
        }
        if (req.method === "POST") {
          if (j.user_id !== authed.id) return send(403, { code: "42501", message: "new row violates row-level security policy for table \"vyron_data\"" });
          rows.set(j.user_id, { data: j.data, updated_at: j.updated_at || new Date().toISOString() });
          return send(201);
        }
      }
      send(404, { message: "not found " + p });
    });
  });
  return {
    srv, users, codes, rows, sent, key,
    setGoogleEmail: (e) => (googleEmail = e),
    lastCode: (email) => codes.get(String(email).toLowerCase())?.code,
    expireAll: () => { for (const v of access.values()) v.exp = 0; },
    listen: (port = 0, host = "127.0.0.1") => new Promise((r) => srv.listen(port, host, () => r(`http://${host}:${srv.address().port}`))),
    close: () => srv.close(),
  };
}

module.exports = { fakeSupabase };
