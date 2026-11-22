// VYRON account (Supabase Auth). VYRON stays locked until you sign in.
// - Email + password, email codes (sign-up check, forgot password, log in with a code).
// - The session is kept encrypted on this PC; your password is never stored.
// - Your VYRON data is saved to your account (table vyron_data, one row per user,
//   protected so only you can read or change it).
// Talks to the Supabase REST endpoints directly (/auth/v1, /rest/v1).
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const GOOGLE_PORT = 47212; // add http://127.0.0.1:47212/** to Supabase → Auth → URL Configuration → Redirect URLs

class AccountError extends Error { constructor(msg, kind = "auth") { super(msg); this.kind = kind; } }

const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function friendly(status, j) {
  const raw = String(j?.msg || j?.error_description || j?.message || j?.error || "").trim();
  const code = String(j?.error_code || j?.code || "");
  const r = raw.toLowerCase();
  if (status === 429 || /rate limit|too many/.test(r)) return "Too many tries or emails. Wait a few minutes and try again.";
  if (/invalid login credentials|invalid_credentials/.test(r + code)) return "Wrong email or password.";
  if (/email not confirmed/.test(r)) return "EMAIL_NOT_CONFIRMED";
  if (/already registered|already been registered|user_already_exists/.test(r + code)) return "There's already an account with this email. Log in instead.";
  if (/refresh token/.test(r)) return "Your sign-in has expired. Log in again.";
  if (/token has expired or is invalid|otp_expired|invalid otp/.test(r + " " + code)) return "That code is wrong or has expired. Ask for a new one.";
  if (/user not found|otp_disabled|signups not allowed for otp/.test(r + " " + code)) return "No account with this email. Create one first.";
  if (/signups not allowed|signup_disabled/.test(r + " " + code)) return "New accounts can't be created right now.";
  if (/password/.test(r)) return raw; // e.g. "Password should be at least 6 characters."
  return raw || `The account service answered ${status}.`;
}

/** Built-in project (src/account-config.json), or env vars for tests. */
function loadAccountConfig(dir) {
  if (process.env.VYRON_SUPABASE_URL) return { url: process.env.VYRON_SUPABASE_URL, key: process.env.VYRON_SUPABASE_KEY || "" };
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, "src", "account-config.json"), "utf8")); return j.url && j.key ? j : null; } catch { return null; }
}

class AccountManager extends EventEmitter {
  /** opts: { dataDir, encrypt, decrypt, config: {url, key}, fetchImpl } */
  constructor({ dataDir, encrypt, decrypt, config, fetchImpl }) {
    super();
    this.file = path.join(dataDir, "vyron-account.json");
    this.enc = encrypt; this.dec = decrypt;
    this.cfg = config && config.url && config.key ? { url: String(config.url).replace(/\/+$/, ""), key: config.key } : null;
    this.fetch = fetchImpl || globalThis.fetch;
    this.user = null; this.session = null; this.pending = null; this.offline = false;
    this.mustSetPassword = false;
    this.sync = { at: null, error: null, busy: false };
  }

  get configured() { return !!this.cfg; }
  get signedIn() { return !!this.user && !this.mustSetPassword; }
  get locked() { return !this.signedIn; } // always required: VYRON only works when signed in
  get required() { return true; }

  public() {
    return {
      configured: this.configured, signedIn: this.signedIn, locked: this.locked, required: true,
      user: this.user ? { id: this.user.id, email: this.user.email } : null,
      pending: this.pending ? { email: this.pending.email, kind: this.pending.kind, sentAt: this.pending.sentAt } : null,
      mustSetPassword: this.mustSetPassword, offline: this.offline, waitingForGoogle: !!this.googleWait,
      sync: { ...this.sync },
    };
  }

  /* ---------- HTTP ---------- */
  async api(method, pth, body, token) {
    if (!this.cfg) throw new AccountError("This copy of VYRON isn't connected to the account service yet.", "config");
    let r;
    try {
      r = await this.fetch(this.cfg.url + pth, {
        method, headers: { apikey: this.cfg.key, "Content-Type": "application/json", Authorization: "Bearer " + (token || this.cfg.key) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
    } catch (e) { throw new AccountError("Can't reach the VYRON account service. Check your internet.", "network"); }
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!r.ok) throw new AccountError(friendly(r.status, j), r.status >= 500 ? "server" : "auth");
    return j;
  }

  /* ---------- session storage ---------- */
  load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return null; } }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const s = this.session;
    fs.writeFileSync(this.file, JSON.stringify(s ? { user: this.user, refresh: this.enc(s.refresh), access: this.enc(s.access), expiresAt: s.expiresAt, mustSetPassword: this.mustSetPassword } : {}));
  }
  setSession(j) {
    if (!j?.access_token) throw new AccountError("Sign-in didn't finish. Try again.");
    this.session = { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
    this.user = { id: j.user?.id, email: j.user?.email };
    this.offline = false;
    this.pending = null;
    this.save();
  }
  finishSignIn() {
    this.emit("change");
    if (this.signedIn) this.emit("signedIn", this.user);
  }

  /** Start: use the saved session (refreshing it). Works offline with a saved session. */
  async restore() {
    const s = this.load();
    if (!s?.refresh || !s.user) { this.emit("change"); return; }
    let refresh, access;
    try { refresh = this.dec(s.refresh); access = this.dec(s.access); } catch { this.emit("change"); return; }
    this.user = s.user;
    this.mustSetPassword = !!s.mustSetPassword;
    this.session = { refresh, access, expiresAt: s.expiresAt || 0 };
    try { await this.refresh(); }
    catch (e) {
      if (e.kind === "network") this.offline = true; // keep working offline; sync waits
      else { this.clear(); }
    }
    this.finishSignIn();
  }
  async refresh() {
    const j = await this.api("POST", "/auth/v1/token?grant_type=refresh_token", { refresh_token: this.session.refresh });
    const keep = this.mustSetPassword;
    this.setSession(j);
    this.mustSetPassword = keep;
    this.save();
  }
  /** A valid access token (refreshes when it is about to expire). */
  async token() {
    if (!this.session) throw new AccountError("Not signed in", "auth");
    if (Date.now() > this.session.expiresAt - 60000) await this.refresh();
    return this.session.access;
  }
  clear() {
    this.user = null; this.session = null; this.pending = null; this.mustSetPassword = false; this.offline = false;
    this.sync = { at: null, error: null, busy: false };
    try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
  }

  /* ---------- flows ---------- */
  checkInput(email, password) {
    email = cleanEmail(email);
    if (!validEmail(email)) throw new AccountError("Type a valid email address.");
    if (password !== undefined && String(password).length < 8) throw new AccountError("Use a password with at least 8 characters.");
    return email;
  }
  setPending(email, kind) { this.pending = { email, kind, sentAt: Date.now() }; this.emit("change"); }

  async signUp({ email, password }) {
    email = this.checkInput(email, password);
    const j = await this.api("POST", "/auth/v1/signup", { email, password });
    if (j?.access_token) { this.setSession(j); return this.finishSignIn(); } // email check is off in the project
    if (j && Array.isArray(j.identities) && j.identities.length === 0) throw new AccountError("There's already an account with this email. Log in instead.");
    this.setPending(email, "signup");
    return { needCode: true };
  }

  async signIn({ email, password }) {
    email = this.checkInput(email);
    if (!password) throw new AccountError("Type your password.");
    try {
      const j = await this.api("POST", "/auth/v1/token?grant_type=password", { email, password });
      this.setSession(j);
      this.finishSignIn();
    } catch (e) {
      if (e.message !== "EMAIL_NOT_CONFIRMED") throw e;
      await this.api("POST", "/auth/v1/resend", { type: "signup", email }).catch(() => {});
      this.setPending(email, "signup");
      throw new AccountError("Confirm your email first — we sent you a new code.", "verify");
    }
  }

  /** Log in without a password: a code is emailed. */
  async sendLoginCode({ email }) {
    email = this.checkInput(email);
    await this.api("POST", "/auth/v1/otp", { email, create_user: false });
    this.setPending(email, "login");
  }

  /** Forgot password: a code is emailed; after it, choose a new password. */
  async forgotPassword({ email }) {
    email = this.checkInput(email);
    await this.api("POST", "/auth/v1/recover", { email });
    this.setPending(email, "recovery");
  }

  async verifyCode({ code }) {
    const p = this.pending;
    if (!p) throw new AccountError("Ask for a code first.");
    const token = String(code || "").replace(/\s+/g, "");
    if (!/^\d{6,10}$/.test(token)) throw new AccountError("Type the code from the email (6 digits).");
    const type = { signup: "signup", login: "email", recovery: "recovery" }[p.kind];
    const j = await this.api("POST", "/auth/v1/verify", { type, email: p.email, token });
    this.setSession(j);
    if (p.kind === "recovery") { this.mustSetPassword = true; this.save(); this.emit("change"); return { setPassword: true }; }
    this.finishSignIn();
  }

  async resendCode() {
    const p = this.pending;
    if (!p) throw new AccountError("Nothing to resend.");
    if (Date.now() - p.sentAt < 30000) throw new AccountError("Wait a few seconds before asking for another code.");
    if (p.kind === "signup") await this.api("POST", "/auth/v1/resend", { type: "signup", email: p.email });
    else if (p.kind === "login") await this.api("POST", "/auth/v1/otp", { email: p.email, create_user: false });
    else await this.api("POST", "/auth/v1/recover", { email: p.email });
    p.sentAt = Date.now();
    this.emit("change");
  }

  /** Continue with Google: opens the browser; Google sends you back to VYRON on this PC. */
  async signInWithGoogle(openExternal, port = GOOGLE_PORT) {
    if (!this.cfg) throw new AccountError("This copy of VYRON isn't connected to the account service yet.", "config");
    if (this.googleWait) return;
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const redirect = `http://127.0.0.1:${port}/auth/callback`;
    const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>VYRON</title><body style="font:16px system-ui;background:#0e0a1c;color:#eef1f7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#a7aec0">${text}</p></div>`;
    const result = await new Promise((resolve, reject) => {
      const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, redirect);
        if (u.pathname !== "/auth/callback") { res.writeHead(404).end(); return; }
        const code = u.searchParams.get("code"), err = u.searchParams.get("error_description") || u.searchParams.get("error");
        if (!code) { res.writeHead(400, { "Content-Type": "text/html" }).end(page("Sign-in didn't finish", "You can close this tab and try again in VYRON.")); return done(new AccountError(err ? "Google sign-in: " + err : "Google sign-in didn't finish.")); }
        try {
          const j = await this.api("POST", "/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
          res.writeHead(200, { "Content-Type": "text/html" }).end(page("You're signed in ✓", "Go back to VYRON — you can close this tab."));
          done(null, j);
        } catch (e) { res.writeHead(400, { "Content-Type": "text/html" }).end(page("Sign-in didn't finish", "You can close this tab and try again in VYRON.")); done(e); }
      });
      const timer = setTimeout(() => done(new AccountError("Google sign-in took too long. Try again.")), 5 * 60 * 1000);
      const done = (e, j) => { clearTimeout(timer); srv.close(); this.googleWait = null; this.emit("change"); e ? reject(e) : resolve(j); };
      this.googleWait = { cancel: () => done(new AccountError("Google sign-in was cancelled.", "cancelled")) };
      srv.once("error", () => done(new AccountError("Couldn't start Google sign-in (port " + port + " is busy).")));
      srv.listen(port, "127.0.0.1", () => {
        this.emit("change");
        openExternal(`${this.cfg.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`);
      });
    });
    this.setSession(result);
    this.finishSignIn();
  }
  cancelGoogle() { this.googleWait?.cancel(); }

  cancel() { this.pending = null; if (this.mustSetPassword) this.clear(); this.emit("change"); }

  /** New password (after "forgot password", or from Settings while signed in). */
  async setPassword({ password }) {
    if (String(password || "").length < 8) throw new AccountError("Use a password with at least 8 characters.");
    await this.api("PUT", "/auth/v1/user", { password }, await this.token());
    const was = this.mustSetPassword;
    this.mustSetPassword = false;
    this.save();
    if (was) this.finishSignIn(); else this.emit("change");
  }

  /** Sign out. `beforeSignOut` (set by the app) saves your data to the account first. */
  async signOut() {
    if (!this.user) return;
    try { await this.beforeSignOut?.(); } catch (e) { /* still sign out */ }
    try { if (this.session) await this.api("POST", "/auth/v1/logout", {}, this.session.access); } catch { /* token may be gone */ }
    this.clear();
    this.emit("change");
    this.emit("signedOut");
  }

  /* ---------- your data ---------- */
  async pull() {
    const t = await this.token();
    const rows = await this.api("GET", `/rest/v1/vyron_data?user_id=eq.${encodeURIComponent(this.user.id)}&select=data,updated_at`, undefined, t);
    return rows?.[0] ? { data: rows[0].data, updatedAt: Date.parse(rows[0].updated_at) || 0 } : null;
  }
  async push(data) {
    const t = await this.token();
    const r = await this.fetch(this.cfg.url + "/rest/v1/vyron_data?on_conflict=user_id", {
      method: "POST",
      headers: { apikey: this.cfg.key, Authorization: "Bearer " + t, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: this.user.id, data, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(30000),
    }).catch(() => { throw new AccountError("Can't reach the VYRON account service.", "network"); });
    if (!r.ok) { let j = null; try { j = await r.json(); } catch { /* */ } throw new AccountError(/42P01|does not exist|Could not find the table/.test(JSON.stringify(j)) ? "The vyron_data table is missing in Supabase (run the setup SQL)." : friendly(r.status, j), "server"); }
  }
}

module.exports = { AccountManager, AccountError, loadAccountConfig, friendly };
