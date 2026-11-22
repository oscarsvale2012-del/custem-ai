// VYRON accounts: sign-up with an email code, log in, forgot password with a
// code, log in with a code, the app lock, and saving data to the account.
// Runs against test/fake-supabase.js (same answers as Supabase).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { AccountManager } = require("../src/account");
const { Backend } = require("../src/core");
const { dispatch, lockedState } = require("../src/api");
const { fakeSupabase } = require("./fake-supabase");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); }
}
const enc = (s) => "x:" + Buffer.from(s).toString("hex");
const dec = (s) => Buffer.from(s.slice(2), "hex").toString();

(async () => {
  const sb = fakeSupabase();
  const url = await sb.listen();
  const config = { url, key: sb.key };
  const TMP = path.join(__dirname, "..", ".testdata-account");
  fs.rmSync(TMP, { recursive: true, force: true });
  const pcA = path.join(TMP, "pcA"), pcB = path.join(TMP, "pcB");
  const mk = (dir) => new AccountManager({ dataDir: dir, encrypt: enc, decrypt: dec, config });
  const mkBackend = (dir) => new Backend({ dataDir: dir, encrypt: enc, decrypt: dec, studio: false, claude: { exe: null }, fetchImpl: async () => { throw new Error("offline"); } });
  let A = mk(pcA);
  const ctx = { backend: {}, auth: A };

  console.log("Lock");
  await test("VYRON is locked until you sign in; only account actions work", async () => {
    await A.restore();
    assert(A.locked);
    const s = await dispatch(ctx, "publicState");
    assert.equal(s.locked, true);
    await assert.rejects(dispatch(ctx, "addProject", [{}]), /Sign in to your VYRON account first/);
    assert.equal(lockedState(A).auth.configured, true);
  });
  await test("a copy without the account service stays locked with a clear message", async () => {
    const X = new AccountManager({ dataDir: path.join(TMP, "x"), encrypt: enc, decrypt: dec, config: null });
    assert(X.locked && !X.configured);
    await assert.rejects(X.signIn({ email: "a@b.co", password: "x" }), /isn't connected/);
  });

  console.log("Create an account");
  await test("checks email and password", async () => {
    await assert.rejects(A.signUp({ email: "nope", password: "longenough" }), /valid email/);
    await assert.rejects(A.signUp({ email: "me@test.com", password: "short" }), /at least 8/);
  });
  await test("sign up → code by email → wrong code refused → right code signs in", async () => {
    let signedIn = 0; A.on("signedIn", () => signedIn++);
    const r = await A.signUp({ email: "Me@Test.com", password: "secret123" });
    assert(r.needCode && A.public().pending.kind === "signup" && A.locked);
    assert.equal(sb.sent.at(-1).type, "signup");
    await assert.rejects(A.verifyCode({ code: "000000" }), /wrong or has expired/);
    await A.verifyCode({ code: sb.lastCode("me@test.com") });
    assert(!A.locked && A.user.email === "me@test.com" && signedIn === 1);
  });
  await test("the password is never saved on this PC, the session is encrypted", () => {
    const raw = fs.readFileSync(path.join(pcA, "vyron-account.json"), "utf8");
    assert(!raw.includes("secret123"));
    assert(!raw.includes(A.session.refresh));
  });
  await test("the same email can't make a second account", async () => {
    const B = mk(path.join(TMP, "dup"));
    await assert.rejects(B.signUp({ email: "me@test.com", password: "another123" }), /already an account/);
  });

  console.log("Log in");
  await test("wrong password is refused", async () => {
    const B = mk(path.join(TMP, "b1"));
    await assert.rejects(B.signIn({ email: "me@test.com", password: "wrong-pass" }), /Wrong email or password/);
  });
  await test("not confirmed yet → a new code is sent", async () => {
    const B = mk(path.join(TMP, "b2"));
    await B.signUp({ email: "late@test.com", password: "secret123" });
    const C = mk(path.join(TMP, "b3"));
    await assert.rejects(C.signIn({ email: "late@test.com", password: "secret123" }), /Confirm your email first/);
    assert.equal(C.public().pending.kind, "signup");
    await C.verifyCode({ code: sb.lastCode("late@test.com") });
    assert(C.signedIn);
  });
  await test("log in with an email code (no password)", async () => {
    const B = mk(path.join(TMP, "b4"));
    await assert.rejects(B.sendLoginCode({ email: "nobody@test.com" }), /No account/);
    await B.sendLoginCode({ email: "me@test.com" });
    await B.verifyCode({ code: sb.lastCode("me@test.com") });
    assert(B.signedIn && B.user.email === "me@test.com");
  });
  await test("forgot password → code → stays locked until a new password is set → old one stops working", async () => {
    const B = mk(path.join(TMP, "b5"));
    await B.forgotPassword({ email: "me@test.com" });
    assert.equal(sb.sent.at(-1).type, "recovery");
    const r = await B.verifyCode({ code: sb.lastCode("me@test.com") });
    assert(r.setPassword && B.locked && B.public().mustSetPassword);
    await assert.rejects(B.setPassword({ password: "short" }), /at least 8/);
    await B.setPassword({ password: "newsecret456" });
    assert(!B.locked);
    await assert.rejects(mk(path.join(TMP, "b6")).signIn({ email: "me@test.com", password: "secret123" }), /Wrong/);
    const D = mk(path.join(TMP, "b7")); await D.signIn({ email: "me@test.com", password: "newsecret456" }); assert(D.signedIn);
  });
  await test("Continue with Google: browser → back to VYRON → signed in (PKCE)", async () => {
    const G = mk(path.join(TMP, "g1"));
    let opened = null;
    await G.signInWithGoogle(async (link) => { opened = link; const r = await fetch(link); assert.match(await r.text(), /You're signed in/); }, 47293);
    assert(/provider=google/.test(opened) && /code_challenge_method=s256/.test(opened) && /redirect_to=http%3A%2F%2F127\.0\.0\.1%3A47293/.test(opened));
    assert(G.signedIn && G.user.email === "gamer@gmail.com");
    assert.equal(G.public().waitingForGoogle, false);
  });
  await test("Google sign-in can be cancelled, and a wrong code verifier is refused", async () => {
    const G = mk(path.join(TMP, "g2"));
    const p = G.signInWithGoogle(() => {}, 47294);
    await new Promise((r) => setTimeout(r, 50));
    assert(G.public().waitingForGoogle);
    G.cancelGoogle();
    await assert.rejects(p, /cancelled/);
    const r = await fetch(`${url}/auth/v1/token?grant_type=pkce`, { method: "POST", headers: { apikey: sb.key, "Content-Type": "application/json" }, body: JSON.stringify({ auth_code: "nope", code_verifier: "x" }) });
    assert.equal(r.status, 400);
  });
  await test("asking for codes too fast is slowed down", async () => {
    const B = mk(path.join(TMP, "b8"));
    await B.sendLoginCode({ email: "me@test.com" });
    await assert.rejects(B.resendCode(), /Wait a few seconds/);
  });

  console.log("Staying signed in");
  await test("after restarting VYRON you're still signed in", async () => {
    const again = mk(pcA);
    await again.restore();
    assert(again.signedIn && again.user.email === "me@test.com");
    A = again; ctx.auth = A; // sign-ins are renewed once; this is now the live one
  });
  await test("an expired session renews by itself", async () => {
    sb.expireAll();
    A.session.expiresAt = 0;
    await A.pull();
    assert(A.session.expiresAt > Date.now());
  });
  await test("no internet: still signed in (offline), syncing waits", async () => {
    const off = new AccountManager({ dataDir: pcA, encrypt: enc, decrypt: dec, config, fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
    await off.restore();
    assert(off.signedIn && off.public().offline);
  });

  console.log("Your data in your account");
  const beA = mkBackend(pcA);
  await beA.init();
  await test("first sign-in saves this PC's data to the account", async () => {
    beA.setActiveProject(await beA.addProject({ name: "Pet Tycoon" }));
    beA.addCustomIdea({ title: "Cat Cafe Wars", pitch: "Cats run rival cafes." });
    beA.setRobloxApiKey("SECRET-OPEN-CLOUD-KEY-1234567890");
    await beA.accountSignedIn(A);
    const row = sb.rows.get(A.user.id);
    assert(row && row.data.projects[0].name === "Pet Tycoon" && row.data.customIdeas[0].title === "Cat Cafe Wars");
    assert(!JSON.stringify(row).includes("SECRET-OPEN-CLOUD-KEY"), "secrets must stay on the PC");
    assert(A.public().sync.at);
  });
  await test("signing out saves first; signing in on another PC brings everything back", async () => {
    beA.addCustomIdea({ title: "Space Bakery", pitch: "Bake bread on the moon." });
    A.beforeSignOut = () => beA.accountPush();
    let out = 0; A.once("signedOut", () => out++);
    await A.signOut();
    assert(out === 1 && A.locked);
    assert(sb.rows.get([...sb.users.values()].find((u) => u.email === "me@test.com").id).data.customIdeas.some((i) => i.title === "Space Bakery"));
    const B = mk(pcB), beB = mkBackend(pcB);
    await beB.init();
    await B.signIn({ email: "me@test.com", password: "newsecret456" });
    await beB.accountSignedIn(B);
    const s = beB.publicState();
    assert.equal(s.projects[0].name, "Pet Tycoon");
    assert(s.ideas.custom.some((i) => i.title === "Space Bakery"));
    assert.equal(s.revenue.hasApiKey, false, "the Roblox key isn't copied to other PCs");
    await beB.shutdown();
  });
  await test("someone else signing in on the same PC doesn't see the first person's data", async () => {
    const O = mk(pcA);
    await O.signUp({ email: "friend@test.com", password: "friend1234" });
    await O.verifyCode({ code: sb.lastCode("friend@test.com") });
    await beA.accountSignedIn(O);
    const s = beA.publicState();
    assert.equal(s.projects.length, 0);
    assert.equal(s.ideas.custom.length, 0);
    assert.equal(s.revenue.hasApiKey, false);
  });
  await test("one account can't read or overwrite another account's data", async () => {
    const O = mk(path.join(TMP, "o2"));
    await O.signIn({ email: "friend@test.com", password: "friend1234" });
    const meId = [...sb.users.values()].find((u) => u.email === "me@test.com").id;
    const r = await fetch(`${url}/rest/v1/vyron_data?user_id=eq.${meId}&select=data`, { headers: { apikey: sb.key, Authorization: "Bearer " + (await O.token()) } });
    assert.deepEqual(await r.json(), []);
    O.user = { ...O.user, id: meId }; // try to write as someone else
    await assert.rejects(O.push({ v: 1 }), /security|answered 403/);
  });

  await beA.shutdown();
  sb.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
