// VYRON sign-in: email + password and Google, through Firebase Authentication.
// - Email/password and token refresh use Firebase's REST API (Identity Toolkit).
// - Google uses the system browser with a loopback redirect + PKCE (Google does
//   not allow sign-in inside embedded windows), then signs in to Firebase.
// The refresh token and Google client secret are stored encrypted.
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const EventEmitter = require("events");

const IDTK = () => process.env.AF_IDTK_BASE || "https://identitytoolkit.googleapis.com/v1";
const SECURETOKEN = () => process.env.AF_SECURETOKEN_BASE || "https://securetoken.googleapis.com/v1";
const GOOGLE_AUTH = () => process.env.AF_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = () => process.env.AF_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

const MESSAGES = {
  EMAIL_EXISTS: "An account with this email already exists. Sign in instead.",
  EMAIL_NOT_FOUND: "Wrong email or password.",
  INVALID_PASSWORD: "Wrong email or password.",
  INVALID_LOGIN_CREDENTIALS: "Wrong email or password.",
  INVALID_EMAIL: "That email address isn't valid.",
  MISSING_PASSWORD: "Enter your password.",
  WEAK_PASSWORD: "Use a password with at least 6 characters.",
  USER_DISABLED: "This account has been disabled.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Wait a few minutes and try again.",
  OPERATION_NOT_ALLOWED: "This sign-in method is turned off in your Firebase project (Authentication → Sign-in method).",
  TOKEN_EXPIRED: "Your sign-in expired. Sign in again.",
  INVALID_REFRESH_TOKEN: "Your sign-in expired. Sign in again.",
  USER_NOT_FOUND: "This account no longer exists.",
  INVALID_IDP_RESPONSE: "Google sign-in failed. Try again.",
};

class AuthError extends Error { constructor(msg, kind = "auth") { super(msg); this.kind = kind; } }

async function post(url, body, form) {
  let r;
  try {
    r = await fetch(url, form
      ? { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new AuthError("No internet connection. Connect and try again.", "network"); }
  let j = {};
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    const raw = j.error?.message || j.error_description || j.error || `HTTP ${r.status}`;
    const code = String(raw).split(" ")[0].replace(/:$/, "");
    if (/API key not valid|API_KEY_INVALID/i.test(JSON.stringify(j))) throw new AuthError("The Firebase API key in sign-in setup is not valid.", "config");
    throw new AuthError(MESSAGES[code] || String(raw), "auth");
  }
  return j;
}

class AuthManager extends EventEmitter {
  constructor({ dataDir, encrypt, decrypt, openExternal, bundledConfig }) {
    super();
    this.file = path.join(dataDir, "vyron-auth.json");
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.openExternal = openExternal || (async () => {});
    this.bundled = bundledConfig || null;
    this.cfg = null; // { apiKey, googleClientId, googleClientSecret, allowedEmails[] }
    this.session = null; // { refreshToken, uid, email, name, photo, provider, verified }
    this.user = null; // public profile once unlocked
    this.pendingVerify = null; // { idToken, email } for email accounts awaiting verification
    this.googleWait = null;
    this.offline = false;
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw.cfg) this.cfg = { ...raw.cfg, googleClientSecret: raw.cfg.googleClientSecret ? this.decrypt(raw.cfg.googleClientSecret) : "" };
      if (raw.session?.refreshToken) this.session = { ...raw.session, refreshToken: this.decrypt(raw.session.refreshToken) };
    } catch { /* first run */ }
    if (!this.cfg && this.bundled?.apiKey) this.cfg = { ...this.bundled };
  }

  save() {
    const out = {
      cfg: this.cfg ? { ...this.cfg, googleClientSecret: this.cfg.googleClientSecret ? this.encrypt(this.cfg.googleClientSecret) : "" } : null,
      session: this.session ? { ...this.session, refreshToken: this.encrypt(this.session.refreshToken) } : null,
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(out, null, 2));
  }

  get configured() { return !!this.cfg?.apiKey; }
  get signedIn() { return !!this.user; }
  get googleEnabled() { return !!(this.cfg?.googleClientId); }

  public() {
    return {
      configured: this.configured, signedIn: this.signedIn, googleEnabled: this.googleEnabled,
      user: this.user, pendingVerify: this.pendingVerify ? { email: this.pendingVerify.email } : null,
      waitingForGoogle: !!this.googleWait, offline: this.offline,
      allowList: (this.cfg?.allowedEmails || []).length > 0,
      canEditSetup: !this.configured || this.signedIn || !this.cfg?.everSignedIn,
    };
  }

  /** First-time setup. Only allowed when not configured yet, or when signed in. */
  setConfig({ apiKey, googleClientId, googleClientSecret, allowedEmails }) {
    if (this.configured && !this.signedIn && this.cfg.everSignedIn) throw new AuthError("Sign in first to change sign-in settings.");
    apiKey = String(apiKey || "").trim();
    if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) throw new AuthError("That doesn't look like a Firebase Web API key (it starts with AIza).", "config");
    const emails = (Array.isArray(allowedEmails) ? allowedEmails : String(allowedEmails || "").split(/[\s,;]+/)).map((e) => e.trim().toLowerCase()).filter(Boolean);
    this.cfg = {
      apiKey,
      googleClientId: String(googleClientId || "").trim(),
      googleClientSecret: String(googleClientSecret || "").trim() || this.cfg?.googleClientSecret || "",
      allowedEmails: emails,
      everSignedIn: !!this.cfg?.everSignedIn,
    };
    this.save();
    this.emit("change");
  }

  _key() { if (!this.configured) throw new AuthError("Sign-in is not set up yet.", "config"); return this.cfg.apiKey; }

  _allowed(email) {
    const list = this.cfg.allowedEmails || [];
    if (list.length && !list.includes(String(email || "").toLowerCase())) throw new AuthError(`${email} is not allowed to use this copy of VYRON.`, "forbidden");
  }

  async _finish({ refreshToken, uid, email, name, photo, provider, verified }) {
    this._allowed(email);
    this.session = { refreshToken, uid, email, name: name || "", photo: photo || "", provider, verified: !!verified };
    this.user = { uid, email, name: name || email.split("@")[0], photo: photo || null, provider };
    this.pendingVerify = null;
    this.offline = false;
    this.cfg.everSignedIn = true;
    this.save();
    this.emit("change");
    this.emit("signedIn", this.user);
    return this.user;
  }

  /** Called at start: restore the saved session if it is still valid. */
  async restore() {
    if (!this.configured || !this.session?.refreshToken) return false;
    try {
      const t = await post(`${SECURETOKEN()}/token?key=${this._key()}`, { grant_type: "refresh_token", refresh_token: this.session.refreshToken }, true);
      const look = await post(`${IDTK()}/accounts:lookup?key=${this._key()}`, { idToken: t.id_token });
      const u = look.users?.[0];
      if (!u) throw new AuthError(MESSAGES.USER_NOT_FOUND);
      if (this.session.provider === "password" && !u.emailVerified) { this.session = null; this.save(); return false; }
      await this._finish({ refreshToken: t.refresh_token, uid: u.localId, email: u.email, name: u.displayName, photo: u.photoUrl, provider: this.session.provider, verified: u.emailVerified });
      return true;
    } catch (e) {
      if (e.kind === "network" && this.session.verified) {
        // Offline: keep working with the last verified session.
        this._allowed(this.session.email);
        this.user = { uid: this.session.uid, email: this.session.email, name: this.session.name || this.session.email, photo: this.session.photo || null, provider: this.session.provider };
        this.offline = true;
        this.emit("change");
        this.emit("signedIn", this.user);
        return true;
      }
      this.session = null;
      this.save();
      this.emit("change");
      return false;
    }
  }

  async signUp({ email, password }) {
    email = String(email || "").trim();
    this._allowed(email);
    const r = await post(`${IDTK()}/accounts:signUp?key=${this._key()}`, { email, password, returnSecureToken: true });
    await post(`${IDTK()}/accounts:sendOobCode?key=${this._key()}`, { requestType: "VERIFY_EMAIL", idToken: r.idToken });
    this.pendingVerify = { email, idToken: r.idToken, refreshToken: r.refreshToken, uid: r.localId };
    this.emit("change");
    return { needsVerification: true, email };
  }

  async signIn({ email, password }) {
    email = String(email || "").trim();
    this._allowed(email);
    const r = await post(`${IDTK()}/accounts:signInWithPassword?key=${this._key()}`, { email, password, returnSecureToken: true });
    const look = await post(`${IDTK()}/accounts:lookup?key=${this._key()}`, { idToken: r.idToken });
    const u = look.users?.[0] || {};
    if (!u.emailVerified) {
      this.pendingVerify = { email, idToken: r.idToken, refreshToken: r.refreshToken, uid: r.localId };
      this.emit("change");
      return { needsVerification: true, email };
    }
    return this._finish({ refreshToken: r.refreshToken, uid: r.localId, email: u.email || email, name: u.displayName, photo: u.photoUrl, provider: "password", verified: true });
  }

  async resendVerification() {
    if (!this.pendingVerify) throw new AuthError("Nothing to verify.");
    await post(`${IDTK()}/accounts:sendOobCode?key=${this._key()}`, { requestType: "VERIFY_EMAIL", idToken: this.pendingVerify.idToken });
  }

  /** After the user clicked the link in the email. */
  async checkVerified() {
    const p = this.pendingVerify;
    if (!p) throw new AuthError("Nothing to verify.");
    const t = await post(`${SECURETOKEN()}/token?key=${this._key()}`, { grant_type: "refresh_token", refresh_token: p.refreshToken }, true);
    const look = await post(`${IDTK()}/accounts:lookup?key=${this._key()}`, { idToken: t.id_token });
    const u = look.users?.[0] || {};
    if (!u.emailVerified) throw new AuthError("Your email isn't verified yet. Click the link in the email we sent, then try again.", "unverified");
    return this._finish({ refreshToken: t.refresh_token, uid: u.localId, email: u.email, name: u.displayName, photo: u.photoUrl, provider: "password", verified: true });
  }

  cancelVerify() { this.pendingVerify = null; this.emit("change"); }

  async resetPassword({ email }) {
    email = String(email || "").trim();
    if (!email) throw new AuthError("Enter your email first.");
    await post(`${IDTK()}/accounts:sendOobCode?key=${this._key()}`, { requestType: "PASSWORD_RESET", email });
  }

  /** Google: system browser + loopback redirect with PKCE. */
  async signInWithGoogle() {
    this._key();
    if (!this.googleEnabled) throw new AuthError("Google sign-in is not set up. Add a Google OAuth client ID in sign-in setup.", "config");
    if (this.googleWait) this.googleWait.cancel();
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");

    const code = await new Promise((resolve, reject) => {
      const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>VYRON</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#090a0f;color:#eef1f7;font:15px system-ui"><div style="text-align:center"><div style="font:700 22px system-ui;letter-spacing:.3em">VYRON</div><h2 style="font-weight:600">${title}</h2><p style="color:#a7aec0">${text}</p></div>`;
      const srv = http.createServer((req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (!u.searchParams.has("code") && !u.searchParams.has("error")) { res.writeHead(404).end(); return; }
        const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(ok ? page("You're signed in", "You can close this tab and go back to VYRON.") : page("Sign-in was cancelled", "Go back to VYRON and try again."));
        cleanup();
        ok ? resolve(u.searchParams.get("code")) : reject(new AuthError("Google sign-in was cancelled."));
      });
      const timer = setTimeout(() => { cleanup(); reject(new AuthError("Google sign-in timed out. Try again.")); }, 5 * 60 * 1000);
      const cleanup = () => { clearTimeout(timer); srv.close(); this.googleWait = null; this.emit("change"); };
      this.googleWait = { cancel: () => { cleanup(); reject(new AuthError("Google sign-in was cancelled.")); } };
      srv.listen(0, "127.0.0.1", () => {
        this.redirectUri = `http://127.0.0.1:${srv.address().port}`;
        const url = `${GOOGLE_AUTH()}?` + new URLSearchParams({
          client_id: this.cfg.googleClientId, redirect_uri: this.redirectUri, response_type: "code", scope: "openid email profile",
          code_challenge: challenge, code_challenge_method: "S256", state, prompt: "select_account",
        });
        this.lastGoogleUrl = url;
        this.emit("change");
        Promise.resolve(this.openExternal(url)).catch(() => {});
      });
    });

    const tok = await post(GOOGLE_TOKEN(), {
      client_id: this.cfg.googleClientId, client_secret: this.cfg.googleClientSecret || "", code, code_verifier: verifier,
      redirect_uri: this.redirectUri, grant_type: "authorization_code",
    }, true);
    if (!tok.id_token) throw new AuthError("Google did not return an identity token.");
    const r = await post(`${IDTK()}/accounts:signInWithIdp?key=${this._key()}`, {
      postBody: `id_token=${tok.id_token}&providerId=google.com`, requestUri: "http://localhost", returnSecureToken: true, returnIdpCredential: true,
    });
    return this._finish({ refreshToken: r.refreshToken, uid: r.localId, email: r.email, name: r.displayName || r.fullName, photo: r.photoUrl, provider: "google", verified: true });
  }

  cancelGoogle() { this.googleWait?.cancel(); }

  signOut() {
    this.session = null;
    this.user = null;
    this.pendingVerify = null;
    this.save();
    this.emit("change");
    this.emit("signedOut");
  }
}

function loadBundledConfig(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "auth-config.json"), "utf8")); } catch { return null; }
}

module.exports = { AuthManager, AuthError, loadBundledConfig };
