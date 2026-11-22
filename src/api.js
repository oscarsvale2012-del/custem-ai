// The list of backend methods the renderer may call. Anything not listed
// here cannot be reached from the UI. Sign-in is optional; only when the user
// turned on "require sign-in" and is signed out is everything else locked.
const METHODS = [
  "publicState", "saveSettings",
  "claudeSend", "claudeStop", "claudeNewChat", "claudeNewTask", "claudeRemoveTask", "claudeStartTask", "claudeLogin", "claudeCheck", "pcAnswer", "pcRevoke",
  "listIdeas", "setPicked", "addCustomIdea", "removeCustomIdea", "ideaPrompt", "buildIdeas",
  "connectStudio", "detectStudios", "addProject", "updateProject", "removeProject", "setActiveProject", "refreshGame",
  "accountSyncNow", "linkRoblox", "unlinkRoblox", "setRobloxApiKey", "clearRobloxApiKey", "refreshRevenue", "refreshRates",
];
// Read-only helpers the connector uses (not reachable from the UI's bridge list above).
const INTERNAL = ["revenueKr", "notify", "pcAction"];

/** VYRON account (always required). Reachable while locked. */
const AUTH = {
  accountStatus: (a) => a.public(),
  accountSignIn: (a, x) => a.signIn(x || {}),
  accountSignUp: (a, x) => a.signUp(x || {}),
  accountLoginCode: (a, x) => a.sendLoginCode(x || {}),
  accountForgot: (a, x) => a.forgotPassword(x || {}),
  accountVerify: (a, x) => a.verifyCode(x || {}),
  accountResend: (a) => a.resendCode(),
  accountCancel: (a) => a.cancel(),
  accountSetPassword: (a, x) => a.setPassword(x || {}),
  accountSignOut: (a) => a.signOut(),
  accountGoogle: (a) => a.signInWithGoogle(a.openExternal),
  accountCancelGoogle: (a) => a.cancelGoogle(),
};

/** ctx = { backend, auth }. auth may be null (tests / no sign-in). */
function lockedState(auth) { return { locked: true, auth: auth.public() }; }

async function dispatch(ctx, method, args) {
  if (!ctx.backend) ctx = { backend: ctx, auth: null };
  const { backend, auth } = ctx;
  args = Array.isArray(args) ? args : [];
  if (AUTH[method]) {
    if (!auth) throw new Error("Accounts are not available here");
    return AUTH[method](auth, ...args);
  }
  if (!METHODS.includes(method) && !CONTROL[method] && !(ctx.internal && INTERNAL.includes(method))) throw new Error("Unknown method " + method);
  if (auth && auth.locked) {
    if (method === "publicState") return lockedState(auth);
    throw new Error("Sign in to your VYRON account first");
  }
  if (CONTROL[method]) {
    if (!ctx.control) throw new Error("Claude control is only available in the desktop app");
    return CONTROL[method](ctx.control, ...args);
  }
  return backend[method](...args);
}

/** The "Control VYRON from Claude" switch (Settings). */
const CONTROL = {
  controlStatus: (c) => c.status(),
  controlSetEnabled: (c, on) => c.setEnabled(!!on),
  controlNewKey: (c) => c.newKey(),
  controlDesktop: (c, on) => c.setDesktop(!!on),
};

module.exports = { METHODS, dispatch, lockedState };
