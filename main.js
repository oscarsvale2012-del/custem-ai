// VYRON — Electron main process. Hosts the backend and the window.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { Backend } = require("./src/backend");
const { dispatch, lockedState } = require("./src/api");
const { AuthManager, loadBundledConfig } = require("./src/auth");

let win;
let backend;
let auth;
let started = false;
let quitting = false;

app.setName("VYRON");
// Testing: run a separate copy with its own data (and its own single-instance lock).
if (process.env.VYRON_DATA_DIR) app.setPath("userData", process.env.VYRON_DATA_DIR);
if (process.platform === "win32") app.setAppUserModelId("com.vyron.app");

// Only one VYRON window at a time: opening it again focuses the running one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

/* Earlier versions were called AgentForge. Move their data (projects, agents,
   encrypted keys, Roblox sign-in) to VYRON's folder on first start. The
   "Local State" file holds the key that decrypts saved secrets, so it moves too. */
(function migrateFromAgentForge() {
  try {
    const newDir = app.getPath("userData");
    const oldDir = path.join(app.getPath("appData"), "AgentForge");
    if (path.resolve(oldDir).toLowerCase() === path.resolve(newDir).toLowerCase()) return;
    if (!fs.existsSync(path.join(oldDir, "agentforge-data.json")) || fs.existsSync(path.join(newDir, "agentforge-data.json"))) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const item of ["agentforge-data.json", "Local State", "history", "snapshots", "Partitions"]) {
      const from = path.join(oldDir, item);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(newDir, item), { recursive: true });
    }
  } catch (e) {
    console.error("Could not move AgentForge data:", e.message);
  }
})();

const encrypt = (s) => (safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(s).toString("base64") : "plain:" + Buffer.from(s).toString("base64"));
const decrypt = (s) => {
  if (s.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(s.slice(4), "base64"));
  if (s.startsWith("plain:")) return Buffer.from(s.slice(6), "base64").toString();
  return s; // v0.1 stored plain values
};

/* ---------- Roblox account session ----------
   The user signs in on roblox.com in its own window. The session lives in a
   separate, persistent cookie store that is only used for roblox.com requests
   and never reaches the interface. */
const ROBLOX_PARTITION = "persist:roblox";
const rbx = () => session.fromPartition(ROBLOX_PARTITION);
const isRoblox = (u) => { try { const h = new URL(u).hostname; return new URL(u).protocol === "https:" && (h === "roblox.com" || h.endsWith(".roblox.com")); } catch { return false; } };
const hasRobloxSession = async () => (await rbx().cookies.get({ domain: "roblox.com", name: ".ROBLOSECURITY" })).length > 0;

const robloxHost = {
  robloxFetch: (url) => {
    if (!isRoblox(url)) throw new Error("Only roblox.com can be called with the Roblox session");
    return rbx().fetch(url, { headers: { Accept: "application/json" } });
  },
  robloxLogin: () => new Promise((resolve) => {
    const w = new BrowserWindow({
      parent: win, modal: true, width: 520, height: 780, title: "Sign in to Roblox", autoHideMenuBar: true, backgroundColor: "#ffffff",
      webPreferences: { partition: ROBLOX_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const done = async (url) => {
      if (!/\/(login|newlogin|signup|account\/signupredir)/i.test(new URL(url).pathname) && (await hasRobloxSession())) w.close();
    };
    w.webContents.on("did-navigate", (_e, url) => done(url).catch(() => {}));
    w.webContents.on("did-navigate-in-page", (_e, url) => done(url).catch(() => {}));
    // Stay on roblox.com; anything else opens in the normal browser.
    w.webContents.on("will-navigate", (e, url) => { if (!isRoblox(url)) { e.preventDefault(); shell.openExternal(url); } });
    w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
    w.on("closed", () => resolve());
    w.loadURL("https://www.roblox.com/login");
  }),
  robloxLogout: async () => { await rbx().clearStorageData(); },
};

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: "#0a0b10",
    title: "VYRON",
    icon: path.join(__dirname, "renderer", "icon.png"),
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(create\.roblox\.com|www\.roblox\.com|console\.anthropic\.com|platform\.openai\.com|github\.com|console\.firebase\.google\.com|console\.cloud\.google\.com)\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("maximize", () => win.webContents.send("event", "window", { maximized: true }));
  win.on("unmaximize", () => win.webContents.send("event", "window", { maximized: false }));
}

ipcMain.handle("call", async (_e, method, args) => {
  try {
    return { ok: true, value: await dispatch({ backend, auth }, method, args) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});
ipcMain.handle("host", async (_e, cmd, arg) => {
  if (cmd === "pickFolder") {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: "Choose your Rojo project folder" });
    return r.canceled ? null : r.filePaths[0];
  }
  if (cmd === "openPath" && typeof arg === "string") return shell.openPath(arg);
  if (cmd === "minimize") win.minimize();
  if (cmd === "toggleMaximize") (win.isMaximized() ? win.unmaximize() : win.maximize());
  if (cmd === "close") win.close();
  if (cmd === "isDesktop") return true;
  return null;
});

app.whenReady().then(async () => {
  if (!gotLock) return;
  const dataDir = app.getPath("userData");
  backend = new Backend({ dataDir, encrypt, decrypt, host: robloxHost });
  // Sign-in gate: nothing in the backend starts until the user is signed in.
  auth = new AuthManager({
    dataDir, encrypt, decrypt,
    openExternal: (url) => shell.openExternal(url),
    bundledConfig: loadBundledConfig(__dirname),
  });
  backend.authInfo = () => auth.public();
  const send = (type, payload) => win && !win.isDestroyed() && win.webContents.send("event", type, payload);
  const startBackend = async () => { if (!started) { started = true; await backend.init(); } };
  const sendState = () => send("state", !auth.locked && started ? backend.publicState() : lockedState(auth));
  backend.on("state", (s) => !auth.locked && send("state", s));
  backend.on("log", (l) => !auth.locked && send("log", l));
  auth.on("change", sendState);
  auth.on("signedIn", async () => { await startBackend(); sendState(); });
  auth.on("signedOut", async () => {
    if (!auth.required) return sendState(); // sign-in is optional: keep working
    // Sign-in is required: restart into the sign-in screen with everything stopped.
    quitting = true;
    try { await backend.shutdown(); } finally { app.relaunch(); app.exit(0); }
  });
  createWindow();
  await auth.restore();
  if (!auth.locked) await startBackend();
  sendState();
});

app.on("before-quit", async (e) => {
  if (quitting || !backend) return;
  e.preventDefault();
  quitting = true;
  try { await backend?.shutdown(); } finally { app.exit(0); }
});
app.on("window-all-closed", () => app.quit());
