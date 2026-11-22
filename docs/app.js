/* VYRON website: account (Supabase Auth over REST) + download. */
"use strict";
const C = window.VYRON_CONFIG || {};
const URL0 = String(C.supabaseUrl || "").replace(/\/+$/, "");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const st = { mode: "login", pending: null, msg: "", bad: false, email: "", release: null };

/* ---------- session (this browser only) ---------- */
const store = {
  get() { try { return JSON.parse(localStorage.getItem("vyron.session") || "null"); } catch { return null; } },
  set(s) { try { s ? localStorage.setItem("vyron.session", JSON.stringify(s)) : localStorage.removeItem("vyron.session"); } catch { /* private mode */ } },
};
let session = store.get();

function friendly(status, j) {
  const raw = String(j?.msg || j?.error_description || j?.message || j?.error || "").trim(), r = (raw + " " + (j?.error_code || "")).toLowerCase();
  if (status === 429 || /rate limit|too many/.test(r)) return "Too many tries or emails. Wait a few minutes and try again.";
  if (/invalid login credentials|invalid_credentials/.test(r)) return "Wrong email or password.";
  if (/email not confirmed/.test(r)) return "EMAIL_NOT_CONFIRMED";
  if (/already registered|user_already_exists/.test(r)) return "There's already an account with this email. Log in instead.";
  if (/refresh token/.test(r)) return 'Your sign-in has expired. Log in again.';
  if (/token has expired or is invalid|otp_expired|invalid otp/.test(r)) return "That code is wrong or has expired. Ask for a new one.";
  if (/user not found|otp_disabled|signups not allowed for otp/.test(r)) return "No account with this email. Create one first.";
  return raw || `Something went wrong (${status}).`;
}
async function api(method, path, body, token) {
  if (!URL0 || !C.supabaseKey) throw new Error("The VYRON account service isn't connected yet.");
  let r;
  try {
    r = await fetch(URL0 + path, { method, headers: { apikey: C.supabaseKey, "Content-Type": "application/json", Authorization: "Bearer " + (token || C.supabaseKey) }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error("Can't reach the VYRON account service. Check your internet."); }
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ }
  if (!r.ok) throw new Error(friendly(r.status, j));
  return j;
}
function keep(j, mustSetPassword = false) {
  session = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: j.user?.email, mustSetPassword };
  store.set(session);
}
async function token() {
  if (!session) throw new Error("Log in first.");
  if (Date.now() > session.exp - 60000) { const m = session.mustSetPassword; keep(await api("POST", "/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh }), m); }
  return session.access;
}
/* ---------- Continue with Google (PKCE: Google → Supabase → back here with ?code=) ---------- */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function google() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  try { sessionStorage.setItem("vyron.pkce", verifier); } catch { /* */ }
  const back = location.origin + location.pathname;
  location.href = `${URL0}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=s256`;
}
async function finishGoogle() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), err = q.get("error_description") || q.get("error");
  if (!code && !err) return;
  history.replaceState(null, "", location.pathname + "#account");
  if (err) return say("Google sign-in: " + err, true);
  let verifier = null; try { verifier = sessionStorage.getItem("vyron.pkce"); sessionStorage.removeItem("vyron.pkce"); } catch { /* */ }
  try { keep(await api("POST", "/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier })); say("You're logged in with Google!"); loadRelease(); }
  catch (e) { say(e.message, true); }
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const val = (id) => ($("#" + id)?.value || "").trim();

/* ---------- views ---------- */
const G = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
function msg() { return st.msg ? `<div class="msg ${st.bad ? "bad" : ""}">${esc(st.msg)}</div>` : ""; }
function draw() {
  const v = $("#view");
  $("#navAccount").textContent = session && !session.mustSetPassword ? "My account" : "Log in";
  $("#ctaMain").textContent = session && !session.mustSetPassword ? "Download VYRON" : "Create your account";
  if (!URL0 || !C.supabaseKey) { v.innerHTML = `<h2>Coming soon</h2><p class="muted">Accounts open soon. Check back later.</p>`; return; }
  if (session?.mustSetPassword) {
    v.innerHTML = `<h2>Choose a new password</h2><p class="muted">For ${esc(session.email)}. At least 8 characters.</p>${msg()}
      <label><span>New password</span><input id="p1" type="password" autocomplete="new-password"></label>
      <label><span>Repeat new password</span><input id="p2" type="password" autocomplete="new-password"></label>
      <button class="btn primary wide" data-a="newPassword" data-primary>Save password</button>`;
  } else if (session) {
    const r = st.release;
    v.innerHTML = `<div class="who"><div class="av">${esc((session.email || "?")[0].toUpperCase())}</div><div><b>Signed in</b><div class="muted">${esc(session.email)}</div></div></div>${msg()}
      <div class="dl"><a class="btn primary wide" id="dlBtn" href="${esc(r?.url || `https://github.com/${C.github}/releases/latest`)}">${r ? `Download VYRON ${esc(r.version)} for Windows` : "Download VYRON for Windows"}</a>
      <small>${r ? `${esc(r.size)} · installer` : "Opens the latest release"} · If Windows warns you, click More info → Run anyway.</small></div>
      <ol class="steps"><li>Install and open VYRON.</li><li>Log in with this account — VYRON stays locked until you do.</li><li>Sign in to Claude inside VYRON once.</li></ol>
      <div class="links"><a data-a="changePassword">Change password</a><a data-a="signOut">Sign out</a></div>`;
  } else if (st.pending) {
    const what = { signup: "to confirm your email", login: "to log you in", recovery: "to reset your password" }[st.pending.kind];
    v.innerHTML = `<h2>Check your email</h2><p class="muted">We sent a code ${what}: <b>${esc(st.pending.email)}</b>. Check spam too.</p>${msg()}
      <label><span>Code</span><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
      <button class="btn primary wide" data-a="verify" data-primary>Continue</button>
      <div class="links"><a data-a="resend">Send a new code</a><a data-a="cancel">Use another email</a></div>`;
  } else if (st.mode === "signup") {
    v.innerHTML = `<h2>Create your VYRON account</h2><p class="muted">Free. You need it to use the VYRON app.</p>${msg()}
      <button class="btn wide google" data-a="google">${G}Sign up with Google</button><div class="or">or with email</div>
      <label><span>Email</span><input id="email" type="email" autocomplete="email" value="${esc(st.email)}"></label>
      <label><span>Password (at least 8 characters)</span><input id="p1" type="password" autocomplete="new-password"></label>
      <label><span>Repeat password</span><input id="p2" type="password" autocomplete="new-password"></label>
      <button class="btn primary wide" data-a="signUp" data-primary>Create account</button>
      <div class="links"><a data-a="mode" data-m="login">I already have an account</a></div>`;
  } else if (st.mode === "forgot" || st.mode === "code") {
    const f = st.mode === "forgot";
    v.innerHTML = `<h2>${f ? "Forgot your password?" : "Log in with an email code"}</h2><p class="muted">${f ? "We'll email you a code, then you choose a new password." : "No password needed — we'll email you a code."}</p>${msg()}
      <label><span>Email</span><input id="email" type="email" autocomplete="email" value="${esc(st.email)}"></label>
      <button class="btn primary wide" data-a="${f ? "forgot" : "loginCode"}" data-primary>Email me a code</button>
      <div class="links"><a data-a="mode" data-m="login">Back to log in</a></div>`;
  } else {
    v.innerHTML = `<h2>Log in</h2><p class="muted">Log in to download VYRON.</p>${msg()}
      <button class="btn wide google" data-a="google">${G}Continue with Google</button><div class="or">or</div>
      <label><span>Email</span><input id="email" type="email" autocomplete="email" value="${esc(st.email)}"></label>
      <label><span>Password</span><input id="p1" type="password" autocomplete="current-password"></label>
      <button class="btn primary wide" data-a="signIn" data-primary>Log in</button>
      <div class="links"><a data-a="mode" data-m="forgot">Forgot password?</a><a data-a="mode" data-m="code">Log in with an email code</a></div>
      <div class="or">new here?</div><button class="btn wide" data-a="mode" data-m="signup">Create an account</button>`;
  }
  const first = v.querySelector("input"); if (first && document.activeElement?.tagName !== "INPUT" && location.hash === "#account") first.focus({ preventScroll: true });
}
const say = (m, bad = false) => { st.msg = m; st.bad = bad; };
const pend = (email, kind) => { st.pending = { email, kind, at: Date.now() }; say(""); };

const ACT = {
  google: () => google(),
  mode: (el) => { st.email = val("email") || st.email; st.mode = el.dataset.m; say(""); },
  async signIn() {
    const email = val("email").toLowerCase(); st.email = email;
    if (!validEmail(email)) throw new Error("Type a valid email address.");
    try { keep(await api("POST", "/auth/v1/token?grant_type=password", { email, password: $("#p1").value })); say("Welcome back!"); loadRelease(); }
    catch (e) { if (e.message !== "EMAIL_NOT_CONFIRMED") throw e; await api("POST", "/auth/v1/resend", { type: "signup", email }).catch(() => {}); pend(email, "signup"); say("Confirm your email first — we sent you a new code."); }
  },
  async signUp() {
    const email = val("email").toLowerCase(); st.email = email;
    if (!validEmail(email)) throw new Error("Type a valid email address.");
    if ($("#p1").value.length < 8) throw new Error("Use a password with at least 8 characters.");
    if ($("#p1").value !== $("#p2").value) throw new Error("The passwords don't match.");
    const j = await api("POST", "/auth/v1/signup", { email, password: $("#p1").value });
    if (j?.access_token) { keep(j); say("Your account is ready!"); loadRelease(); return; }
    if (j && Array.isArray(j.identities) && j.identities.length === 0) throw new Error("There's already an account with this email. Log in instead.");
    pend(email, "signup");
  },
  async forgot() { const email = val("email").toLowerCase(); if (!validEmail(email)) throw new Error("Type a valid email address."); st.email = email; await api("POST", "/auth/v1/recover", { email }); pend(email, "recovery"); },
  async loginCode() { const email = val("email").toLowerCase(); if (!validEmail(email)) throw new Error("Type a valid email address."); st.email = email; await api("POST", "/auth/v1/otp", { email, create_user: false }); pend(email, "login"); },
  async verify() {
    const token = val("code").replace(/\s+/g, "");
    if (!/^\d{6,10}$/.test(token)) throw new Error("Type the code from the email (6 digits).");
    const p = st.pending;
    const j = await api("POST", "/auth/v1/verify", { type: { signup: "signup", login: "email", recovery: "recovery" }[p.kind], email: p.email, token });
    keep(j, p.kind === "recovery");
    st.pending = null;
    say(p.kind === "recovery" ? "" : "You're logged in!");
    loadRelease();
  },
  async resend() {
    const p = st.pending;
    if (Date.now() - p.at < 30000) throw new Error("Wait a few seconds before asking for another code.");
    if (p.kind === "signup") await api("POST", "/auth/v1/resend", { type: "signup", email: p.email });
    else if (p.kind === "login") await api("POST", "/auth/v1/otp", { email: p.email, create_user: false });
    else await api("POST", "/auth/v1/recover", { email: p.email });
    p.at = Date.now(); say("A new code is on its way.");
  },
  cancel: () => { st.pending = null; say(""); },
  async newPassword() {
    const a = $("#p1").value; if (a.length < 8) throw new Error("Use a password with at least 8 characters."); if (a !== $("#p2").value) throw new Error("The passwords don't match.");
    await api("PUT", "/auth/v1/user", { password: a }, await token());
    session.mustSetPassword = false; store.set(session); say("Password saved. You're logged in!");
  },
  changePassword: () => { session.mustSetPassword = true; store.set(session); say(""); },
  async signOut() { try { await api("POST", "/auth/v1/logout", {}, session.access); } catch { /* already gone */ } session = null; store.set(null); st.mode = "login"; say("You're signed out."); },
};

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-a]");
  if (!el) return;
  e.preventDefault();
  const btn = el.tagName === "BUTTON" ? el : null, label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
  try { say(""); await ACT[el.dataset.a](el); }
  catch (err) { say(err.message, true); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } draw(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest?.("#view input")) { e.preventDefault(); $("#view [data-primary]")?.click(); } });

/* ---------- latest app download (from GitHub releases) ---------- */
async function loadRelease() {
  if (st.release || !C.github) return;
  try {
    const r = await (await fetch(`https://api.github.com/repos/${C.github}/releases/latest`)).json();
    const a = (r.assets || []).find((x) => /^VYRON-Setup-.*\.exe$/.test(x.name));
    if (a) st.release = { url: a.browser_download_url, version: String(r.tag_name || "").replace(/^v/, ""), size: Math.round(a.size / 1048576) + " MB" };
  } catch { /* falls back to the releases page */ }
  draw();
}

/* ---------- sky ---------- */
(() => {
  const cv = $("#sky"), cx = cv.getContext("2d"); let W, H, D, P = [];
  const size = () => { D = devicePixelRatio || 1; W = cv.width = innerWidth * D; H = cv.height = innerHeight * D; P = Array.from({ length: 700 }, (_, i) => { const arm = i % 3, d = Math.pow(Math.random(), 0.6); return { d, a: arm * 2.094 + d * 5.2 + (Math.random() - 0.5) * 0.7 * (1.2 - d), s: 0.6 + Math.random() * 1.4, t: Math.random() * 6 }; }); };
  addEventListener("resize", size); size();
  (function f(now) {
    requestAnimationFrame(f); const t = now / 1000; cx.clearRect(0, 0, W, H);
    for (const p of P) { const a = p.a + t * 0.02 * (1.4 - p.d), r = p.d * Math.max(W, H) * 0.55; cx.fillStyle = `rgba(200,180,255,${(0.3 + 0.6 * (1 - p.d)) * (0.65 + 0.35 * Math.sin(t * 2 + p.t))})`; cx.fillRect(W * 0.7 + Math.cos(a) * r, H * 0.35 + Math.sin(a) * r * 0.5, p.s * D, p.s * D); }
  })(0);
})();

finishGoogle().then(() => { if (session && !session.mustSetPassword) loadRelease(); draw(); });
draw();
