// PC control for Claude: screenshots, mouse and keyboard on Windows.
// Runs small PowerShell scripts (System.Drawing / SendKeys / user32). Text is
// passed as base64 so nothing typed can break out of the script.
// Screenshots are scaled down; click coordinates are in screenshot pixels and
// mapped back to the real screen here.
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_W = 1600;
const HEAD = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class VyW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, int d, UIntPtr e);
}
"@
[VyW]::SetProcessDPIAware() | Out-Null
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
`;
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");

function ps(script, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(HEAD + script, "utf16le").toString("base64");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true, timeout, maxBuffer: 1 << 20 }, (err, out, errOut) => {
      if (err) return reject(new Error(String(errOut || err.message).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300)));
      resolve(String(out).trim());
    });
  });
}

/** SendKeys text: special characters are wrapped in braces. */
function sendKeysText(text) { return String(text).replace(/[+^%~(){}[\]]/g, (c) => "{" + c + "}").replace(/\r?\n/g, "{ENTER}"); }

const KEYS = { enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", backspace: "{BACKSPACE}", delete: "{DELETE}", del: "{DELETE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", space: " ", insert: "{INSERT}" };
for (let i = 1; i <= 12; i++) KEYS["f" + i] = `{F${i}}`;
/** "ctrl+shift+s" → "^+s". Windows-key combos aren't possible with SendKeys. */
function keyCombo(combo) {
  const parts = String(combo).toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("No key given");
  let mods = "";
  const key = parts.pop();
  for (const m of parts) {
    if (m === "ctrl" || m === "control") mods += "^";
    else if (m === "shift") mods += "+";
    else if (m === "alt") mods += "%";
    else throw new Error(`Unsupported modifier "${m}" (use ctrl, shift, alt)`);
  }
  const k = KEYS[key] || (key.length === 1 ? sendKeysText(key) : null);
  if (!k) throw new Error(`Unknown key "${key}"`);
  return mods + k;
}

class PcDriver {
  constructor() { this.last = null; } // last screenshot geometry, for mapping clicks

  async screenshot() {
    const file = path.join(os.tmpdir(), `vyron-shot-${process.pid}.jpg`);
    const out = await ps(`
$w = $vs.Width; $h = $vs.Height
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
$c = [System.Windows.Forms.Cursor]::Position
$sw = [Math]::Min(${MAX_W}, $w); $sh = [int]($h * $sw / $w)
$out = New-Object System.Drawing.Bitmap $sw, $sh
$g2 = [System.Drawing.Graphics]::FromImage($out)
$g2.InterpolationMode = 'HighQualityBicubic'
$g2.DrawImage($bmp, 0, 0, $sw, $sh)
$out.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose(); $g2.Dispose(); $bmp.Dispose(); $out.Dispose()
"{""left"":$($vs.Left),""top"":$($vs.Top),""realW"":$w,""realH"":$h,""w"":$sw,""h"":$sh,""cx"":$($c.X),""cy"":$($c.Y)}"`);
    const g = JSON.parse(out.split("\n").pop());
    const data = fs.readFileSync(file).toString("base64");
    fs.rmSync(file, { force: true });
    this.last = g;
    return { ...g, data, mime: "image/jpeg" };
  }

  toReal(x, y) {
    const g = this.last;
    if (!g) throw new Error("Take a screenshot first, so clicks land in the right place");
    if (!(x >= 0 && y >= 0 && x <= g.w && y <= g.h)) throw new Error(`Point (${x}, ${y}) is outside the ${g.w}×${g.h} screenshot`);
    return [Math.round(g.left + (x * g.realW) / g.w), Math.round(g.top + (y * g.realH) / g.h)];
  }

  async click(x, y, button = "left", double = false) {
    const [rx, ry] = this.toReal(x, y);
    const [d, u] = { left: [0x2, 0x4], right: [0x8, 0x10], middle: [0x20, 0x40] }[button] || [0x2, 0x4];
    const one = `[VyW]::mouse_event(${d},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [VyW]::mouse_event(${u},0,0,0,[UIntPtr]::Zero)`;
    await ps(`[VyW]::SetCursorPos(${rx},${ry}) | Out-Null; Start-Sleep -Milliseconds 60; ${one}${double ? `; Start-Sleep -Milliseconds 80; ${one}` : ""}`);
  }

  async move(x, y) { const [rx, ry] = this.toReal(x, y); await ps(`[VyW]::SetCursorPos(${rx},${ry}) | Out-Null`); }

  async scroll(x, y, amount) {
    const [rx, ry] = this.toReal(x, y);
    const delta = Math.max(-20, Math.min(20, Math.round(amount))) * 120;
    await ps(`[VyW]::SetCursorPos(${rx},${ry}) | Out-Null; Start-Sleep -Milliseconds 40; [VyW]::mouse_event(0x0800,0,0,${-delta},[UIntPtr]::Zero)`);
  }

  async type(text) {
    if (String(text).length > 2000) throw new Error("Text is too long (max 2000 characters)");
    await ps(`$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(sendKeysText(text))}')); [System.Windows.Forms.SendKeys]::SendWait($t)`);
  }

  async key(combo) {
    await ps(`$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(keyCombo(combo))}')); [System.Windows.Forms.SendKeys]::SendWait($t)`);
  }
}

module.exports = { PcDriver, keyCombo, sendKeysText };
