// VYRON — Electron main process. Hosts the backend and the window.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session, Tray, Menu, Notification, nativeImage, screen, globalShortcut } = require("electron");
const path = require("path");
const fs = require("fs");
const { Backend } = require("./src/core");
const { dispatch, lockedState } = require("./src/api");
const { AccountManager, loadAccountConfig } = require("./src/account");
const { ControlServer } = require("./src/control");

let win;
let backend;
let auth;
let control;
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

// Links the app may open in the normal browser.
const SAFE_LINK = /^https:\/\/(create\.roblox\.com|www\.roblox\.com|www\.ecb\.europa\.eu|claude\.ai|github\.com|www\.blender\.org|console\.firebase\.google\.com|console\.cloud\.google\.com)\//;

let tray = null;
let forceQuit = false;
let hintShown = false;
const ICON = path.join(__dirname, "renderer", "icon.png");
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function desktopNote(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: true }); // VYRON plays its own sound
  n.on("click", () => { showWindow(); onClick?.(); });
  n.show();
}
/* VYRON-style pop-up in the bottom-right corner (shown even when VYRON is in the tray). */
let popup = null;
const POP_W = 400, POP_H = 116, POP_MS = 7000;
function showPopup(a) {
  const look = backend?.d.settings.themeLook || {};
  const data = { title: a.title, body: a.body, kind: a.kind, taskId: a.taskId || "", bg: look.bg, accent: look.accent, light: !!look.light, ms: POP_MS };
  const wa = screen.getPrimaryDisplay().workArea;
  if (!popup || popup.isDestroyed()) {
    popup = new BrowserWindow({
      width: POP_W, height: POP_H, x: wa.x + wa.width - POP_W - 12, y: wa.y + wa.height - POP_H - 12,
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    popup.setAlwaysOnTop(true, "screen-saver");
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    popup.webContents.on("will-navigate", (e) => e.preventDefault());
    popup.on("closed", () => (popup = null));
  }
  popup.loadFile(path.join(__dirname, "renderer", "popup.html"), { hash: encodeURIComponent(JSON.stringify(data)) }).then(() => popup && !popup.isDestroyed() && popup.showInactive()).catch(() => {});
}
function hidePopup() { if (popup && !popup.isDestroyed()) popup.hide(); }

/** Tell the user, the way they chose in Settings: VYRON pop-up, Windows notification, or nothing. */
function alertUser(a) {
  const style = backend?.d.settings.notifyStyle || "vyron";
  if (style === "off") return;
  if (style === "windows") return desktopNote(a.title, a.body, () => a.taskId && win.webContents.send("event", "openTask", a.taskId));
  showPopup(a);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("VYRON");
  const menu = () => Menu.buildFromTemplate([
    { label: "Open VYRON", click: showWindow },
    { type: "separator" },
    { label: "Quit VYRON (stops Claude's tasks)", click: () => { forceQuit = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on("click", showWindow);
}

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
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (SAFE_LINK.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Closing the window keeps VYRON (and Claude's tasks) running in the tray.
  win.on("close", (e) => {
    if (forceQuit || !backend || backend.d.settings.keepRunning === false) return;
    e.preventDefault();
    win.hide();
    if (!hintShown) { hintShown = true; alertUser({ kind: "message", title: "VYRON is still running", body: "Claude keeps working in the background. Click the VYRON icon by the clock to open it, or right-click it to quit." }); }
  });
  win.on("maximize", () => win.webContents.send("event", "window", { maximized: true }));
  win.on("unmaximize", () => win.webContents.send("event", "window", { maximized: false }));
}

ipcMain.handle("call", async (_e, method, args) => {
  try {
    return { ok: true, value: await dispatch({ backend, auth, control }, method, args) };
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
  if (cmd === "popupClose") return hidePopup();
  if (cmd === "popupOpen") { hidePopup(); showWindow(); if (arg) win.webContents.send("event", "openTask", String(arg)); return null; }
  if (cmd === "testPopup") return showPopup({ kind: "done", title: "Claude finished", body: "This is how VYRON tells you when a task is done." });
  if (cmd === "openUrl" && SAFE_LINK.test(String(arg))) return shell.openExternal(arg);
  if (cmd === "hotkeysPause") { hotkeysPaused = !!arg; applyHotkeys(); return null; } // while a shortcut box is recording keys
  return null;
});

/* Keyboard shortcuts that open VYRON, Roblox Studio, Claude desktop and Blender from anywhere in Windows. */
let hotkeysPaused = false;
function applyHotkeys() {
  globalShortcut.unregisterAll();
  if (!backend || !started) return;
  const errors = {};
  if (!hotkeysPaused) for (const [id, key] of Object.entries(backend.hotkeys())) {
    if (!key) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(key, () => {
        if (id === "vyron") return showWindow();
        backend.openApp(id).then((r) => { if (!r.ok) alertUser({ kind: "message", title: "Couldn't open it", body: r.message }); }).catch((e) => alertUser({ kind: "message", title: "Couldn't open it", body: e.message }));
      });
    } catch { ok = false; }
    if (!ok) errors[id] = `${key} is taken by another program. Pick another shortcut.`;
  }
  backend.hotkeyErrors = errors;
  backend.hotkeysLive = !hotkeysPaused;
  backend.changed();
}
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  if (!gotLock) return;
  const dataDir = app.getPath("userData");
  backend = new Backend({ dataDir, encrypt, decrypt, host: robloxHost });
  // Sign-in gate: nothing in the backend starts until the user is signed in.
  // VYRON account: nothing in the backend starts until you are signed in.
  auth = new AccountManager({ dataDir, encrypt, decrypt, config: loadAccountConfig(__dirname) });
  auth.beforeSignOut = () => started && backend.accountPush();
  auth.openExternal = (url) => shell.openExternal(url);
  backend.authInfo = () => auth.public();
  const send = (type, payload) => win && !win.isDestroyed() && win.webContents.send("event", type, payload);
  // The Claude desktop app starts VYRON.exe in Node mode with the bridge script.
  const bridgeScript = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "src", "mcp-bridge.js") : path.join(__dirname, "src", "mcp-bridge.js");
  const bridge = { command: process.execPath, args: app.isPackaged ? [bridgeScript] : [path.join(__dirname), bridgeScript].slice(1), env: { ELECTRON_RUN_AS_NODE: "1", ...(process.env.VYRON_DATA_DIR ? { VYRON_DATA_DIR: process.env.VYRON_DATA_DIR } : {}) } };
  control = new ControlServer({ dataDir, getCtx: () => ({ backend, auth, control }), log: (t, l, s) => backend.log(t, l, s), version: app.getVersion(), bridge });
  control.onSeen = () => backend.changed();
  backend.controlInfo = (withKey) => (withKey ? { ...control.status(), token: control.cfg.token } : control.status());
  backend.on("notify", (n) => { send("notify", n); if (win && !win.isFocused()) win.flashFrame(true); if (win && (!win.isVisible() || !win.isFocused())) alertUser({ kind: "message", title: "Message from Claude", body: n.text }); });
  // Task done / failed / out of usage / needs your OK: sound in the app + a Windows notification.
  backend.on("alert", (a) => {
    send("alert", a);
    if (!win || !win.isVisible() || !win.isFocused()) alertUser(a);
    if (win && !win.isFocused()) win.flashFrame(true);
  });
  const C = backend.claude;
  const tip = () => tray && tray.setToolTip(C.running() ? `VYRON — Claude: ${C.running()} working${C.tasks.some((t) => t.queued) ? ", more waiting" : ""}` : "VYRON");
  C.on("change", tip);
  const startBackend = async () => {
    if (started) return;
    started = true;
    await backend.init();
    if (control.cfg.enabled) await control.start();
    applyHotkeys();
  };
  backend.on("hotkeys", applyHotkeys);
  robloxHost.showWindow = showWindow;
  robloxHost.openExternal = (u) => shell.openExternal(u);
  const sendState = () => send("state", !auth.locked && started ? backend.publicState() : lockedState(auth));
  backend.on("state", (s) => !auth.locked && send("state", s));
  backend.on("log", (l) => !auth.locked && send("log", l));
  auth.on("change", sendState);
  auth.on("signedIn", async () => { await startBackend(); sendState(); backend.accountSignedIn(auth).catch(() => {}); });
  auth.on("signedOut", async () => {
    // Restart into the sign-in screen with everything stopped (your data was saved to your account first).
    quitting = true;
    try { await backend.shutdown(); } finally { app.relaunch(); app.exit(0); }
  });
  createWindow();
  createTray();
  await auth.restore();
  if (!auth.locked) await startBackend();
  sendState();
});

app.on("before-quit", async (e) => {
  forceQuit = true;
  if (quitting || !backend) return;
  e.preventDefault();
  quitting = true;
  try { await control?.stop(); await backend?.shutdown(); } finally { app.exit(0); }
});
app.on("window-all-closed", () => app.quit());
