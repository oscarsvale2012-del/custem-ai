// Renders renderer/icon.svg to build/icon.png (512x512) and renderer/icon.png.
// Run with:  npx electron build/render-icon.js
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "..", "renderer", "icon.svg"), "utf8").replace("<svg", '<svg width="512" height="512"');
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 600));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const png = img.resize({ width: 512, height: 512 }).toPNG();
  fs.writeFileSync(path.join(__dirname, "icon.png"), png);
  fs.writeFileSync(path.join(__dirname, "..", "renderer", "icon.png"), png);
  console.log("icon.png written", img.getSize());
  app.quit();
});
