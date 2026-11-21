// AgentForge — Electron main process. Hosts the backend and the window.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require("electron");
const path = require("path");
const { Backend } = require("./src/backend");
const { dispatch } = require("./src/api");

let win;
let backend;

const encrypt = (s) => (safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(s).toString("base64") : "plain:" + Buffer.from(s).toString("base64"));
const decrypt = (s) => {
  if (s.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(s.slice(4), "base64"));
  if (s.startsWith("plain:")) return Buffer.from(s.slice(6), "base64").toString();
  return s; // v0.1 stored plain values
};

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: "#0a0b10",
    title: "AgentForge",
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(create\.roblox\.com|www\.roblox\.com|console\.anthropic\.com|platform\.openai\.com|github\.com)\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("maximize", () => win.webContents.send("event", "window", { maximized: true }));
  win.on("unmaximize", () => win.webContents.send("event", "window", { maximized: false }));
}

ipcMain.handle("call", async (_e, method, args) => {
  try {
    return { ok: true, value: await dispatch(backend, method, args) };
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
  backend = new Backend({ dataDir: app.getPath("userData"), encrypt, decrypt });
  backend.on("state", (s) => win && !win.isDestroyed() && win.webContents.send("event", "state", s));
  backend.on("log", (l) => win && !win.isDestroyed() && win.webContents.send("event", "log", l));
  createWindow();
  await backend.init();
});

let quitting = false;
app.on("before-quit", async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  try { await backend?.shutdown(); } finally { app.exit(0); }
});
app.on("window-all-closed", () => app.quit());
