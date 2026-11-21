// Sign-in tests. A fake Firebase + Google server answers like the real ones,
// so every flow runs through the real AuthManager and the API lock. One check
// calls the real Firebase service with an invalid key.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}

const KEY = "AIzaTESTKEYtestkey0123456789abcd";
const users = new Map(); // email -> { uid, password, verified, name }
let n = 0;
let revoked = false;
let nextDirectEmail = "direct@gmail.com";
const userByUid = (uid) => [...users.values()].find((u) => u.uid === uid);

function fakeFirebase() {
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://x");
      const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      const fail = (m) => json(400, { error: { message: m } });
      const isForm = /x-www-form-urlencoded/.test(req.headers["content-type"] || "");
      const b = isForm ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body || "{}");
      if (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/st/")) {
        if (u.searchParams.get("key") !== KEY) return fail("API key not valid. Please pass a valid API key.");
      }
      switch (u.pathname) {
        case "/v1/accounts:signUp": {
          if (users.has(b.email)) return fail("EMAIL_EXISTS");
          if (String(b.password).length < 6) return fail("WEAK_PASSWORD : Password should be at least 6 characters");
          const uid = "u" + ++n; users.set(b.email, { uid, password: b.password, verified: false, email: b.email });
          return json(200, { idToken: "id-" + uid, refreshToken: "rt-" + uid, localId: uid });
        }
        case "/v1/accounts:signInWithPassword": {
          const x = users.get(b.email);
          if (!x || x.password !== b.password) return fail("INVALID_LOGIN_CREDENTIALS");
          return json(200, { idToken: "id-" + x.uid, refreshToken: "rt-" + x.uid, localId: x.uid });
        }
        case "/v1/accounts:sendOobCode": return json(200, { email: b.email || "" });
        case "/v1/accounts:lookup": {
          const x = userByUid(String(b.idToken).slice(3));
          return x ? json(200, { users: [{ localId: x.uid, email: x.email, emailVerified: x.verified, displayName: x.name }] }) : fail("USER_NOT_FOUND");
        }
        case "/v1/accounts:signInWithIdp": {
          const email = new URLSearchParams(b.postBody).get("id_token").replace("google-id-", "");
          let x = users.get(email);
          if (!x) { x = { uid: "u" + ++n, email, verified: true, name: "Google User" }; users.set(email, x); }
          return json(200, { idToken: "id-" + x.uid, refreshToken: "rt-" + x.uid, localId: x.uid, email, displayName: x.name, photoUrl: "https://example.com/p.png" });
        }
        case "/st/token": {
          const x = userByUid(String(b.refresh_token).slice(3));
          return x ? json(200, { id_token: "id-" + x.uid, refresh_token: "rt-" + x.uid, user_id: x.uid }) : fail("INVALID_REFRESH_TOKEN");
        }
        case "/g/token": {
          if (String(b.client_id).startsWith("direct")) {
            // Direct Google sign-in: real-shaped ID token (header.payload.signature).
            const jwt = (email, aud = b.client_id) => "h." + Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud, sub: "g-123", email, email_verified: true, name: "Direct User", picture: "https://example.com/d.png", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".s";
            if (b.grant_type === "refresh_token") return b.refresh_token === "g-refresh" && !revoked ? json(200, { id_token: jwt("direct@gmail.com") }) : json(400, { error: "invalid_grant" });
            return b.code === "good-code" && b.code_verifier ? json(200, { id_token: jwt(nextDirectEmail), refresh_token: "g-refresh" }) : json(400, { error: "invalid_grant" });
          }
          return b.code === "good-code" && b.code_verifier ? json(200, { id_token: "google-id-guser@gmail.com" }) : json(400, { error: "invalid_grant" });
        }
        case "/g/revoke": revoked = true; return json(200, {});
        default: res.writeHead(404).end();
      }
    });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

(async () => {
  const srv = await fakeFirebase();
  const P = srv.address().port;
  Object.assign(process.env, {
    AF_IDTK_BASE: `http://127.0.0.1:${P}/v1`, AF_SECURETOKEN_BASE: `http://127.0.0.1:${P}/st`,
    AF_GOOGLE_TOKEN_URL: `http://127.0.0.1:${P}/g/token`, AF_GOOGLE_AUTH_URL: `http://127.0.0.1:${P}/g/auth`,
    AF_GOOGLE_REVOKE_URL: `http://127.0.0.1:${P}/g/revoke`,
  });
  const { AuthManager } = require("../src/auth");
  const { dispatch } = require("../src/api");
  const { Backend } = require("../src/backend");
  const TMP = path.join(__dirname, "..", ".testdata-auth");
  fs.rmSync(TMP, { recursive: true, force: true });
  const enc = (s) => "x:" + Buffer.from(s).toString("hex");
  const dec = (s) => Buffer.from(s.slice(2), "hex").toString();
  // "Browser": follows the Google URL straight to the app's loopback redirect.
  const browser = async (url) => {
    const q = new URL(url).searchParams;
    assert.equal(q.get("code_challenge_method"), "S256");
    await fetch(`${q.get("redirect_uri")}/?code=good-code&state=${q.get("state")}`);
  };
  const mk = () => new AuthManager({ dataDir: TMP, encrypt: enc, decrypt: dec, openExternal: browser });
  const auth = mk();
  const backend = new Backend({ dataDir: TMP, encrypt: enc, decrypt: dec });
  const ctx = { backend, auth };

  console.log("Lock");
  await test("before sign-in the app is locked", async () => {
    const s = await dispatch(ctx, "publicState");
    assert.equal(s.locked, true);
    assert.equal(s.auth.configured, false);
    await assert.rejects(dispatch(ctx, "addProvider", [{ type: "openai" }]), /Sign in to VYRON first/);
    await assert.rejects(dispatch(ctx, "build", ["x"]), /Sign in/);
  });
  await test("setup rejects something that isn't a Firebase key", async () => {
    await assert.rejects(dispatch(ctx, "authSetup", [{ apiKey: "hello" }]), /Firebase Web API key/);
  });
  await test("setup saves config; the client secret is encrypted on disk", async () => {
    await dispatch(ctx, "authSetup", [{ apiKey: KEY, googleClientId: "cid.apps.googleusercontent.com", googleClientSecret: "GOCSPX-secret", allowedEmails: "me@test.com, guser@gmail.com" }]);
    assert.equal(auth.public().configured, true);
    assert.equal(auth.public().googleEnabled, true);
    assert(!fs.readFileSync(path.join(TMP, "vyron-auth.json"), "utf8").includes("GOCSPX-secret"));
  });
  await test("a typo in setup can be fixed before the first sign-in", async () => {
    await dispatch(ctx, "authSetup", [{ apiKey: KEY, googleClientId: "cid.apps.googleusercontent.com", allowedEmails: "me@test.com, guser@gmail.com" }]);
    assert.equal(auth.public().canEditSetup, true);
  });

  console.log("Email accounts");
  await test("only allowed emails can create an account", async () => {
    await assert.rejects(dispatch(ctx, "authSignUp", [{ email: "stranger@test.com", password: "secret12" }]), /not allowed/);
  });
  await test("sign up → must verify email before entering", async () => {
    const r = await dispatch(ctx, "authSignUp", [{ email: "me@test.com", password: "secret12" }]);
    assert.equal(r.needsVerification, true);
    assert.equal(auth.public().pendingVerify.email, "me@test.com");
    await assert.rejects(dispatch(ctx, "authCheckVerified"), /isn't verified yet/);
    assert.equal(auth.signedIn, false);
  });
  await test("after clicking the email link, continue signs in and unlocks", async () => {
    users.get("me@test.com").verified = true;
    const u = await dispatch(ctx, "authCheckVerified");
    assert.equal(u.email, "me@test.com");
    assert.equal(auth.signedIn, true);
    const s = await dispatch(ctx, "publicState");
    assert(!s.locked && Array.isArray(s.agents));
    assert(!JSON.stringify(s).includes("rt-"), "refresh token leaked to the UI");
  });
  await test("the session is saved encrypted and restored on the next start", async () => {
    assert(!fs.readFileSync(path.join(TMP, "vyron-auth.json"), "utf8").includes("rt-u1"));
    const again = mk();
    assert.equal(again.signedIn, false);
    assert.equal(await again.restore(), true);
    assert.equal(again.user.email, "me@test.com");
  });
  await test("sign out locks the app again", async () => {
    await dispatch(ctx, "authSignOut");
    assert.equal((await dispatch(ctx, "publicState")).locked, true);
    assert.equal(await mk().restore(), false);
  });
  await test("after the first sign-in, setup can't be changed while signed out", async () => {
    assert.equal(auth.public().canEditSetup, false);
    await assert.rejects(dispatch(ctx, "authSetup", [{ apiKey: KEY }]), /Sign in first/);
  });
  await test("wrong password shows a clear message", async () => {
    await assert.rejects(dispatch(ctx, "authSignIn", [{ email: "me@test.com", password: "nope123" }]), /Wrong email or password/);
  });
  await test("email + password sign-in works", async () => {
    const u = await dispatch(ctx, "authSignIn", [{ email: "me@test.com", password: "secret12" }]);
    assert.equal(u.provider, "password");
    await dispatch(ctx, "authSignOut");
  });
  await test("an existing email can't sign up twice", async () => {
    await assert.rejects(dispatch(ctx, "authSignUp", [{ email: "me@test.com", password: "secret12" }]), /already exists/);
  });

  console.log("Google");
  await test("Continue with Google: browser → loopback → Firebase → unlocked", async () => {
    const u = await dispatch(ctx, "authGoogle");
    assert.equal(u.email, "guser@gmail.com");
    assert.equal(u.provider, "google-firebase");
    assert.equal(auth.signedIn, true);
    assert.equal(auth.public().waitingForGoogle, false);
  });
  await test("offline start keeps the last verified session", async () => {
    const saved = process.env.AF_SECURETOKEN_BASE;
    process.env.AF_SECURETOKEN_BASE = "http://127.0.0.1:9/st";
    try { const a = mk(); assert.equal(await a.restore(), true); assert.equal(a.public().offline, true); }
    finally { process.env.AF_SECURETOKEN_BASE = saved; }
  });

  console.log("Google only (no Firebase)");
  const TMPD = TMP + "-direct";
  fs.rmSync(TMPD, { recursive: true, force: true });
  const mkD = () => new AuthManager({ dataDir: TMPD, encrypt: enc, decrypt: dec, openExternal: browser });
  const d = mkD();
  const dctx = { backend, auth: d };
  await test("setup needs only a Google client ID", async () => {
    await assert.rejects(dispatch(dctx, "authSetup", [{ googleClientId: "not-a-client-id" }]), /apps\.googleusercontent\.com/);
    await dispatch(dctx, "authSetup", [{ googleClientId: "direct-cid.apps.googleusercontent.com", googleClientSecret: "GOCSPX-d", allowedEmails: "direct@gmail.com" }]);
    const p = d.public();
    assert(p.configured && p.googleEnabled && !p.emailEnabled);
    await assert.rejects(dispatch(dctx, "authSignIn", [{ email: "a@b.com", password: "secret12" }]), /Continue with Google/);
  });
  await test("Continue with Google signs in directly and unlocks", async () => {
    const u = await dispatch(dctx, "authGoogle");
    assert.equal(u.email, "direct@gmail.com");
    assert.equal(u.provider, "google");
    assert.equal((await dispatch(dctx, "publicState")).locked, undefined);
  });
  await test("next start restores the Google sign-in", async () => {
    assert(!fs.readFileSync(path.join(TMPD, "vyron-auth.json"), "utf8").includes("g-refresh"), "refresh token not encrypted");
    const again = mkD();
    assert.equal(await again.restore(), true);
    assert.equal(again.user.email, "direct@gmail.com");
  });
  await test("a Google account that isn't allowed is refused", async () => {
    await dispatch(dctx, "authSignOut");
    nextDirectEmail = "someone-else@gmail.com";
    await assert.rejects(dispatch(dctx, "authGoogle"), /not allowed/);
    nextDirectEmail = "direct@gmail.com";
    assert.equal(d.signedIn, false);
  });
  await test("a token issued for another app is rejected", async () => {
    const bad = "h." + Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "other.apps.googleusercontent.com", email: "x@gmail.com", email_verified: true, exp: 9e9 })).toString("base64url") + ".s";
    assert.throws(() => d._claims(bad), /another app/);
  });
  await test("sign out revokes the Google grant; restore then fails", async () => {
    await dispatch(dctx, "authGoogle");
    await dispatch(dctx, "authSignOut");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(revoked, true);
    assert.equal(await mkD().restore(), false);
  });
  await test("a client ID built into the installer works with no setup", async () => {
    const tmpB = TMP + "-bundled";
    const b = new AuthManager({ dataDir: tmpB, encrypt: enc, decrypt: dec, bundledConfig: { googleClientId: "direct-b.apps.googleusercontent.com", googleClientSecret: "s" } });
    const p = b.public();
    assert(p.configured && p.googleEnabled && p.bundled);
    fs.rmSync(tmpB, { recursive: true, force: true });
  });
  fs.rmSync(TMPD, { recursive: true, force: true });

  console.log("Real Firebase");
  await test("real Firebase rejects an invalid API key with a clear message", async () => {
    const saved = process.env.AF_IDTK_BASE; delete process.env.AF_IDTK_BASE;
    const tmp2 = TMP + "-real";
    try {
      const a = new AuthManager({ dataDir: tmp2, encrypt: enc, decrypt: dec });
      a.setConfig({ apiKey: "AIzaSyInvalidInvalidInvalidInvalid000" });
      await assert.rejects(a.signIn({ email: "x@test.com", password: "secret12" }), /not valid/);
    } finally { process.env.AF_IDTK_BASE = saved; fs.rmSync(tmp2, { recursive: true, force: true }); }
  });

  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
