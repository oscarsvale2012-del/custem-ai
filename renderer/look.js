/* VYRON looks and sounds: themes (colors + animated backgrounds) and sounds
   made with the Web Audio API (no sound files, all original). */
"use strict";

/* ---------------- themes ----------------
   [id, name, group, light?, bg, bg2, accent, aura2, fx, fxColor] */
const THEME_LIST = [
  ["vyron-dark", "VYRON Dark", "Classic", 0, "#090a0f", "#0e1016", "#a9c1ff", "#a9c1ff", "net", "255,255,255"],
  ["vyron-light", "VYRON Light", "Classic", 1, "#f3f4f8", "#ffffff", "#4f6fd8", "#4f6fd8", "net", "40,60,120"],
  ["midnight", "Midnight", "Classic", 0, "#070b16", "#0c1222", "#7aa2ff", "#3a5cc7", "stars", "170,195,255"],
  ["mono", "Mono", "Classic", 0, "#0b0b0b", "#131313", "#e6e6e6", "#888888", "none", "255,255,255"],
  ["paper", "Paper", "Classic", 1, "#f6f3ee", "#fffdf9", "#9a6b3c", "#d9b48a", "none", "120,90,60"],

  ["galaxy", "Galaxy", "Space", 0, "#07040f", "#0e0a1c", "#b89cff", "#6a3cff", "galaxy", "200,180,255"],
  ["andromeda", "Andromeda", "Space", 0, "#03060f", "#08101f", "#7cc7ff", "#2f6fff", "galaxy", "160,210,255"],
  ["milky-way", "Milky Way", "Space", 0, "#0a0907", "#14110d", "#ffd59a", "#c98b3a", "stars", "255,236,200"],
  ["nebula", "Nebula", "Space", 0, "#0b0612", "#150c20", "#ff8ad8", "#8a4dff", "nebula", "255,170,230"],
  ["supernova", "Supernova", "Space", 0, "#0f0705", "#1b0d08", "#ffab5c", "#ff4d6d", "nebula", "255,190,120"],
  ["black-hole", "Black Hole", "Space", 0, "#040303", "#0b0807", "#ff9d3c", "#ff5a1f", "galaxy", "255,170,90"],
  ["warp-speed", "Warp Speed", "Space", 0, "#02070c", "#071420", "#5ef2ff", "#2a7dff", "warp", "150,240,255"],
  ["cosmic-blue", "Cosmic Blue", "Space", 0, "#040a1a", "#0a1630", "#64a8ff", "#1f4fd1", "stars", "140,190,255"],
  ["saturn", "Saturn", "Space", 0, "#0c0a05", "#16130a", "#f3cf6b", "#b88a2a", "galaxy", "245,215,140"],
  ["mars", "Mars", "Space", 0, "#120604", "#1d0c08", "#ff7a52", "#b8321a", "embers", "255,130,90"],
  ["moon", "Moon", "Space", 0, "#0d0e11", "#16181c", "#d7dce6", "#8b93a6", "stars", "230,235,245"],

  ["aurora", "Aurora Borealis", "Nature", 0, "#03100d", "#071a16", "#5ff0b4", "#2fb3ff", "aurora", "90,240,180"],
  ["aurora-violet", "Violet Aurora", "Nature", 0, "#0a0614", "#130c22", "#c58bff", "#5ff0d0", "aurora", "190,140,255"],
  ["ocean", "Ocean Deep", "Nature", 0, "#02111a", "#06202d", "#4fe3d6", "#1a7fd1", "bubbles", "120,230,240"],
  ["forest", "Forest Night", "Nature", 0, "#06100a", "#0c1a11", "#9be27a", "#3f9d4e", "fireflies", "210,255,140"],
  ["sakura", "Sakura", "Nature", 1, "#fbf1f4", "#ffffff", "#d9467a", "#ff9ec0", "petals", "235,120,160"],
  ["snowfall", "Snowfall", "Nature", 0, "#0a1018", "#121b27", "#bfe3ff", "#7fb4e8", "snow", "235,245,255"],
  ["rainy", "Rainy Day", "Nature", 0, "#0b0f14", "#141a22", "#8fb3d9", "#4d6f94", "rain", "170,200,230"],
  ["sunset", "Sunset", "Nature", 0, "#140812", "#200d1a", "#ff9f6e", "#ff4f8b", "embers", "255,160,120"],
  ["volcano", "Volcano", "Nature", 0, "#100403", "#1c0806", "#ff5a36", "#ffb02e", "embers", "255,110,60"],
  ["ice", "Ice", "Nature", 1, "#eef6fb", "#ffffff", "#2f8fd8", "#8fd3ff", "snow", "120,170,220"],

  ["synthwave", "Synthwave", "Neon", 0, "#0d0517", "#170a26", "#ff4fd8", "#7b5cff", "grid", "255,90,220"],
  ["cyberpunk", "Cyberpunk", "Neon", 0, "#0a0a05", "#14140a", "#f7e64a", "#00e5ff", "grid", "0,230,255"],
  ["matrix", "Matrix", "Neon", 0, "#020802", "#061206", "#3dff6e", "#1a9e3a", "matrix", "70,255,120"],
  ["terminal", "Hacker Terminal", "Neon", 0, "#0a0702", "#130e05", "#ffb000", "#b37400", "matrix", "255,180,40"],
  ["neon-tokyo", "Neon Tokyo", "Neon", 0, "#0a0510", "#12091c", "#ff3d9a", "#3dd6ff", "rain", "255,90,180"],
  ["arcade", "Arcade", "Neon", 0, "#05080a", "#0a1216", "#4dff9a", "#ff4d6d", "grid", "80,255,160"],

  ["roblox-red", "Studio Red", "Game", 0, "#0e0606", "#180a0a", "#ff5a5a", "#ff9e3d", "net", "255,140,140"],
  ["brainrot", "Brainrot", "Game", 0, "#0b0a02", "#151405", "#d4ff3d", "#ff3df0", "bubbles", "220,255,80"],
  ["gold-rush", "Gold Rush", "Game", 0, "#0d0a03", "#171206", "#ffcf4a", "#ff9b1f", "embers", "255,210,90"],
  ["candy", "Candy", "Game", 1, "#fff2f8", "#ffffff", "#e0418f", "#7a5cff", "bubbles", "230,100,170"],
  ["lava-obby", "Lava Obby", "Game", 0, "#0f0503", "#1a0906", "#ff6a2b", "#ffd23d", "embers", "255,120,50"],
  ["dungeon", "Dungeon", "Game", 0, "#0b0907", "#14110d", "#e0a35e", "#7d4f2a", "fireflies", "255,190,110"],
];
const THEMES = THEME_LIST.map(([id, name, group, light, bg, bg2, accent, aura2, fx, fxc]) => ({ id, name, group, light: !!light, bg, bg2, accent, aura2, fx, fxc }));
const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

let FX = { id: "net", rgb: "255,255,255", light: false };
let appliedTheme = null;
function applyTheme(t) {
  if (appliedTheme === t.id) return;
  appliedTheme = t.id;
  const r = document.documentElement;
  r.dataset.theme = t.light ? "light" : "dark";
  const [ar, ag, ab] = hexRgb(t.accent), [br, bg, bb] = hexRgb(t.aura2);
  const lum = (0.299 * ar + 0.587 * ag + 0.114 * ab) / 255;
  for (const [k, v] of Object.entries({
    "--bg": t.bg, "--bg-2": t.bg2, "--accent": t.accent, "--idle": t.accent, "--accent-ink": lum > 0.6 ? "#0b1020" : "#ffffff",
    "--aura1": `rgba(${ar},${ag},${ab},${t.light ? 0.12 : 0.1})`, "--aura2": `rgba(${br},${bg},${bb},${t.light ? 0.12 : 0.14})`,
  })) r.style.setProperty(k, v);
  FX = { id: t.fx, rgb: t.fxc, light: t.light };
  fxReset();
}

/* ---------------- animated backgrounds ---------------- */
const cv = document.getElementById("bg"), cx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1, P = [], T0 = performance.now();
const rnd = (a, b) => a + Math.random() * (b - a);
function fxReset() {
  DPR = devicePixelRatio || 1; W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR;
  const area = (innerWidth * innerHeight) / 22000;
  const n = { net: Math.min(70, area), stars: area * 5, galaxy: 900, nebula: area * 2, warp: 260, aurora: area * 2, snow: area * 2.2, rain: area * 2.2, matrix: Math.ceil(innerWidth / 16), fireflies: 40, bubbles: 38, embers: 70, petals: 34, grid: area * 1.5, none: 0 }[FX.id] || 0;
  P = Array.from({ length: Math.floor(n) }, (_, i) => spawn(i, true));
}
function spawn(i, first) {
  const f = FX.id;
  if (f === "galaxy") { const arm = i % 3, d = Math.pow(Math.random(), 0.6); return { arm, d, a: arm * 2.094 + d * 5.2 + rnd(-0.35, 0.35) * (1.2 - d), s: rnd(0.7, 2), tw: rnd(0, 6) }; }
  if (f === "warp") return { a: rnd(0, 6.283), z: first ? rnd(0, 1) : 0, v: rnd(0.003, 0.01) };
  if (f === "matrix") return { x: i * 16 * DPR, y: first ? rnd(-H, H) : rnd(-H / 2, 0), v: rnd(2, 6) * DPR, ch: [] };
  if (f === "rain") return { x: rnd(0, W), y: first ? rnd(0, H) : -20, v: rnd(9, 16) * DPR, l: rnd(10, 22) * DPR };
  if (f === "snow" || f === "petals") return { x: rnd(0, W), y: first ? rnd(0, H) : -10, v: rnd(0.3, 1.1) * DPR, r: rnd(1, f === "petals" ? 5 : 2.6) * DPR, ph: rnd(0, 6), rot: rnd(0, 6) };
  if (f === "embers") return { x: rnd(0, W), y: first ? rnd(0, H) : H + 10, v: rnd(0.4, 1.3) * DPR, r: rnd(0.6, 2.2) * DPR, ph: rnd(0, 6), life: rnd(0.4, 1) };
  if (f === "bubbles") return { x: rnd(0, W), y: first ? rnd(0, H) : H + 30, v: rnd(0.3, 0.9) * DPR, r: rnd(3, 16) * DPR, ph: rnd(0, 6) };
  if (f === "fireflies") return { x: rnd(0, W), y: rnd(0, H), vx: rnd(-0.3, 0.3), vy: rnd(-0.3, 0.3), ph: rnd(0, 6), r: rnd(1.2, 2.6) * DPR };
  return { x: rnd(0, W), y: rnd(0, H), vx: rnd(-0.18, 0.18), vy: rnd(-0.18, 0.18), r: rnd(0.4, 1.6), tw: rnd(0, 6) };
}
addEventListener("resize", fxReset);
const MX = "アイウエオカキクケコサシスセソ0123456789VYRON";
function fxFrame(now) {
  requestAnimationFrame(fxFrame);
  if (window.__fxOff || document.hidden) { cx.clearRect(0, 0, W, H); return; }
  const t = (now - T0) / 1000, c = FX.rgb, f = FX.id, A = FX.light ? 0.55 : 1;
  if (f === "matrix") { cx.fillStyle = FX.light ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.12)"; cx.fillRect(0, 0, W, H); }
  else cx.clearRect(0, 0, W, H);
  if (f === "none") return;
  if (f === "nebula" || f === "aurora" || f === "galaxy") {
    // soft colour clouds behind the particles
    for (let k = 0; k < 3; k++) {
      const x = W * (0.25 + 0.25 * k + 0.08 * Math.sin(t * 0.05 + k * 2)), y = H * (0.35 + 0.15 * Math.cos(t * 0.04 + k)), r = Math.max(W, H) * (f === "galaxy" ? 0.25 : 0.4);
      const g = cx.createRadialGradient(x, y, 0, x, y, r);
      const col = k === 1 ? getComputedStyle(document.documentElement).getPropertyValue("--aura2") : `rgba(${c},${f === "aurora" ? 0.07 : 0.06})`;
      g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
      cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    }
  }
  if (f === "aurora") {
    for (let k = 0; k < 3; k++) {
      cx.beginPath();
      for (let x = 0; x <= W; x += 20 * DPR) { const y = H * (0.22 + k * 0.08) + Math.sin(x / (260 * DPR) + t * (0.3 + k * 0.1) + k) * 40 * DPR + Math.sin(x / (90 * DPR) + t * 0.7) * 10 * DPR; x ? cx.lineTo(x, y) : cx.moveTo(x, y); }
      cx.strokeStyle = `rgba(${c},${0.12 - k * 0.03})`; cx.lineWidth = (60 - k * 15) * DPR; cx.filter = "blur(18px)"; cx.stroke(); cx.filter = "none";
    }
  }
  if (f === "grid") {
    const hz = H * 0.62; cx.strokeStyle = `rgba(${c},${0.22 * A})`; cx.lineWidth = DPR;
    for (let i = -20; i <= 20; i++) { cx.beginPath(); cx.moveTo(W / 2 + i * 40 * DPR, hz); cx.lineTo(W / 2 + i * 260 * DPR, H); cx.stroke(); }
    for (let i = 0; i < 14; i++) { const p = ((i + (t * 0.6) % 1) / 14) ** 2, y = hz + (H - hz) * p; cx.globalAlpha = p; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke(); }
    cx.globalAlpha = 1;
    const g = cx.createLinearGradient(0, hz - 140 * DPR, 0, hz); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(${c},${0.12 * A})`); cx.fillStyle = g; cx.fillRect(0, hz - 140 * DPR, W, 140 * DPR);
  }
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (f === "galaxy") {
      const ang = p.a + t * 0.02 * (1.4 - p.d), rad = p.d * Math.min(W, H) * 0.62;
      const x = W / 2 + Math.cos(ang) * rad, y = H / 2 + Math.sin(ang) * rad * 0.55;
      cx.fillStyle = `rgba(${c},${(0.4 + 0.6 * (1 - p.d)) * (0.65 + 0.35 * Math.sin(t * 2 + p.tw)) * A})`;
      cx.fillRect(x, y, p.s * DPR, p.s * DPR);
    } else if (f === "warp") {
      p.z += p.v; if (p.z > 1) P[i] = spawn(i);
      const d = p.z * p.z * Math.max(W, H) * 0.7, d0 = Math.max(0, p.z - 0.04) ** 2 * Math.max(W, H) * 0.7;
      cx.strokeStyle = `rgba(${c},${p.z * 0.9 * A})`; cx.lineWidth = (0.5 + p.z * 1.8) * DPR;
      cx.beginPath(); cx.moveTo(W / 2 + Math.cos(p.a) * d0, H / 2 + Math.sin(p.a) * d0); cx.lineTo(W / 2 + Math.cos(p.a) * d, H / 2 + Math.sin(p.a) * d); cx.stroke();
    } else if (f === "matrix") {
      cx.fillStyle = `rgba(${c},${0.85 * A})`; cx.font = `${14 * DPR}px monospace`;
      cx.fillText(MX[(Math.random() * MX.length) | 0], p.x, p.y); p.y += p.v; if (p.y > H + 20) P[i] = spawn(i);
    } else if (f === "rain") {
      cx.strokeStyle = `rgba(${c},${0.28 * A})`; cx.lineWidth = DPR; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.l * 0.15, p.y + p.l); cx.stroke();
      p.y += p.v; p.x -= p.v * 0.15; if (p.y > H) P[i] = spawn(i);
    } else if (f === "snow") {
      p.y += p.v; p.x += Math.sin(t + p.ph) * 0.4 * DPR; if (p.y > H + 5) P[i] = spawn(i);
      cx.fillStyle = `rgba(${c},${0.55 * A})`; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill();
    } else if (f === "petals") {
      p.y += p.v; p.x += Math.sin(t * 0.8 + p.ph) * 0.8 * DPR; p.rot += 0.01; if (p.y > H + 10) P[i] = spawn(i);
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = `rgba(${c},${0.45})`; cx.beginPath(); cx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 7); cx.fill(); cx.restore();
    } else if (f === "embers") {
      p.y -= p.v; p.x += Math.sin(t * 1.5 + p.ph) * 0.5 * DPR; if (p.y < -10) P[i] = spawn(i);
      const a = Math.min(1, (p.y / H) * 1.4) * p.life;
      cx.fillStyle = `rgba(${c},${a * 0.8 * A})`; cx.shadowColor = `rgba(${c},.8)`; cx.shadowBlur = 8 * DPR; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); cx.shadowBlur = 0;
    } else if (f === "bubbles") {
      p.y -= p.v; p.x += Math.sin(t + p.ph) * 0.4 * DPR; if (p.y < -30) P[i] = spawn(i);
      cx.strokeStyle = `rgba(${c},${0.3 * A})`; cx.lineWidth = DPR; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.stroke();
      cx.fillStyle = `rgba(${c},${0.08 * A})`; cx.fill();
    } else if (f === "fireflies") {
      p.x += p.vx * DPR + Math.sin(t + p.ph) * 0.2; p.y += p.vy * DPR + Math.cos(t * 0.8 + p.ph) * 0.2;
      if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
      const a = 0.5 + 0.5 * Math.sin(t * 2 + p.ph);
      cx.fillStyle = `rgba(${c},${a * 0.9 * A})`; cx.shadowColor = `rgba(${c},1)`; cx.shadowBlur = 14 * DPR; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); cx.shadowBlur = 0;
    } else if (f === "stars" || f === "nebula" || f === "aurora" || f === "grid") {
      if (f === "grid" && p.y > H * 0.6) continue;
      cx.fillStyle = `rgba(${c},${(0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.5 + p.tw))) * A})`;
      cx.beginPath(); cx.arc(p.x, p.y, p.r * DPR, 0, 7); cx.fill();
    } else { // net
      p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
    }
  }
  if (f === "net") {
    const D = 140 * DPR; cx.lineWidth = DPR * 0.6;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < D) { cx.strokeStyle = `rgba(${c},${(1 - d / D) * (FX.light ? 0.06 : 0.05)})`; cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke(); }
    }
    for (const p of P) { cx.fillStyle = `rgba(${c},${FX.light ? 0.18 : 0.28})`; cx.beginPath(); cx.arc(p.x, p.y, p.r * DPR, 0, 7); cx.fill(); }
  }
}
requestAnimationFrame(fxFrame);

/* ---------------- sounds ----------------
   Each sound: list of tones [frequency Hz, start s, length s, wave, volume, slideTo Hz?]
   plus optional "noise" bursts [start, length, volume, filter Hz]. */
const N = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note → Hz
const arp = (notes, step, len, wave = "sine", v = 0.3) => notes.map((n, i) => [N(n), i * step, len, wave, v]);
const SOUND_LIST = [
  ["chime", "Chime", "Gentle", arp([76, 83, 88], 0.09, 0.7)],
  ["ding", "Ding", "Gentle", [[N(88), 0, 0.9, "sine", 0.35], [N(100), 0, 0.5, "sine", 0.08]]],
  ["bell", "Bell", "Gentle", [[N(79), 0, 1.4, "sine", 0.3], [N(91), 0, 0.9, "sine", 0.12], [N(98), 0, 0.5, "sine", 0.06]]],
  ["glass", "Glass", "Gentle", [[N(96), 0, 0.6, "sine", 0.22], [N(103), 0.07, 0.6, "sine", 0.16]]],
  ["harp", "Harp", "Gentle", arp([67, 71, 74, 79, 83], 0.06, 0.8, "triangle", 0.22)],
  ["marimba", "Marimba", "Gentle", arp([72, 76, 79], 0.1, 0.35, "triangle", 0.35)],
  ["zen", "Zen Bowl", "Gentle", [[N(62), 0, 2.2, "sine", 0.3], [N(74.1), 0, 1.8, "sine", 0.1]]],
  ["soft-tap", "Soft Tap", "Gentle", [[N(84), 0, 0.12, "sine", 0.3]]],
  ["pluck", "Pluck", "Gentle", [[N(76), 0, 0.3, "triangle", 0.35], [N(88), 0.05, 0.25, "triangle", 0.15]]],

  ["success", "Success", "Happy", arp([72, 76, 79, 84], 0.08, 0.4, "triangle", 0.3)],
  ["level-up", "Level Up", "Happy", arp([67, 72, 76, 79, 84, 88], 0.06, 0.25, "square", 0.12)],
  ["coin", "Coin", "Happy", [[N(83), 0, 0.08, "square", 0.15], [N(88), 0.08, 0.35, "square", 0.15]]],
  ["power-up", "Power Up", "Happy", [[N(60), 0, 0.5, "square", 0.1, N(96)]]],
  ["fanfare", "Victory Fanfare", "Happy", [...arp([67, 67, 67], 0.12, 0.1, "sawtooth", 0.1), [N(72), 0.38, 0.6, "sawtooth", 0.12], [N(76), 0.38, 0.6, "triangle", 0.12]]],
  ["sparkle", "Sparkle", "Happy", arp([88, 95, 91, 100, 96, 103], 0.045, 0.3, "sine", 0.16)],
  ["achievement", "Achievement", "Happy", [...arp([79, 84], 0.1, 0.2, "triangle", 0.25), [N(88), 0.2, 0.7, "triangle", 0.25], [N(91), 0.2, 0.7, "sine", 0.1]]],
  ["pop", "Bubble Pop", "Happy", [[N(70), 0, 0.09, "sine", 0.4, N(95)]]],
  ["jump", "Jump", "Happy", [[N(64), 0, 0.22, "square", 0.12, N(84)]]],

  ["galaxy", "Galaxy Shimmer", "Space", [...arp([76, 83, 88, 95], 0.12, 1.4, "sine", 0.12), [N(64), 0, 1.6, "triangle", 0.08]]],
  ["space-ping", "Space Ping", "Space", [[N(93), 0, 1.0, "sine", 0.25], [N(93), 0.25, 0.8, "sine", 0.09], [N(93), 0.5, 0.6, "sine", 0.04]]],
  ["warp", "Warp", "Space", [[N(48), 0, 0.7, "sawtooth", 0.08, N(96)], [N(60), 0, 0.7, "sine", 0.1, N(108)]]],
  ["sonar", "Sonar", "Space", [[N(81), 0, 1.2, "sine", 0.3], [N(81), 0.6, 0.6, "sine", 0.06]]],
  ["laser", "Laser", "Space", [[N(100), 0, 0.25, "sawtooth", 0.08, N(60)]]],
  ["robot", "Robot Beep", "Space", [[N(84), 0, 0.08, "square", 0.12], [N(79), 0.11, 0.08, "square", 0.12], [N(88), 0.22, 0.12, "square", 0.12]]],
  ["satellite", "Satellite", "Space", [[N(90), 0, 0.06, "sine", 0.2], [N(90), 0.12, 0.06, "sine", 0.2], [N(97), 0.24, 0.4, "sine", 0.2]]],
  ["nebula", "Nebula Pad", "Space", [[N(60), 0, 1.8, "triangle", 0.12], [N(67), 0.05, 1.7, "triangle", 0.1], [N(72), 0.1, 1.6, "sine", 0.1]]],

  ["retro", "Retro 8-bit", "Game", arp([72, 79, 84, 91], 0.07, 0.09, "square", 0.12)],
  ["blip", "Blip", "Game", [[N(86), 0, 0.07, "square", 0.12]]],
  ["click", "Click", "Game", [], [[0, 0.03, 0.4, 3000]]],
  ["swoosh", "Swoosh", "Game", [], [[0, 0.35, 0.25, 1200]]],
  ["drop", "Drop", "Game", [[N(84), 0, 0.2, "sine", 0.35, N(60)]]],
  ["doorbell", "Doorbell", "Game", [[N(76), 0, 0.7, "sine", 0.3], [N(72), 0.35, 0.9, "sine", 0.3]]],
  ["notify", "Notify", "Game", [[N(81), 0, 0.15, "triangle", 0.3], [N(86), 0.12, 0.35, "triangle", 0.3]]],

  ["uh-oh", "Uh-oh", "Warning", [[N(67), 0, 0.2, "triangle", 0.3], [N(62), 0.2, 0.45, "triangle", 0.3]]],
  ["error", "Error Buzz", "Warning", [[N(45), 0, 0.3, "sawtooth", 0.12], [N(46), 0, 0.3, "square", 0.06]]],
  ["sad-trombone", "Sad Trombone", "Warning", [[N(62), 0, 0.3, "sawtooth", 0.09], [N(61), 0.3, 0.3, "sawtooth", 0.09], [N(60), 0.6, 0.3, "sawtooth", 0.09], [N(59), 0.9, 0.9, "sawtooth", 0.09, N(57)]]],
  ["warning", "Warning Pulse", "Warning", [[N(76), 0, 0.15, "square", 0.1], [N(76), 0.25, 0.15, "square", 0.1], [N(76), 0.5, 0.15, "square", 0.1]]],
  ["alarm", "Alarm", "Warning", [[N(84), 0, 0.15, "square", 0.1], [N(79), 0.15, 0.15, "square", 0.1], [N(84), 0.3, 0.15, "square", 0.1], [N(79), 0.45, 0.15, "square", 0.1]]],
  ["low-thud", "Low Thud", "Warning", [[N(40), 0, 0.35, "sine", 0.5, N(30)]]],
  ["heartbeat", "Heartbeat", "Warning", [[N(38), 0, 0.15, "sine", 0.5], [N(38), 0.22, 0.2, "sine", 0.4]]],
  ["empty-tank", "Empty Tank", "Warning", [[N(72), 0, 0.6, "triangle", 0.25, N(48)]]],
];
const SOUNDS = SOUND_LIST.map(([id, name, group, tones, noise]) => ({ id, name, group, tones, noise: noise || [] }));
const SOUND_EVENTS = [
  ["done", "Task done", "level-up"], ["failed", "Task failed / didn't work", "uh-oh"], ["usage", "Out of Claude usage", "empty-tank"],
  ["approval", "Claude needs your OK", "doorbell"], ["message", "Message from Claude", "ding"],
];

let AC = null;
function playSound(id, volume = 0.7) {
  const s = SOUNDS.find((x) => x.id === id);
  if (!s || volume <= 0) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    const out = AC.createGain(); out.gain.value = volume; out.connect(AC.destination);
    const t0 = AC.currentTime + 0.02;
    for (const [f, at, len, wave, v, to] of s.tones) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = wave; o.frequency.setValueAtTime(f, t0 + at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + at + len);
      g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(v, t0 + at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(out); o.start(t0 + at); o.stop(t0 + at + len + 0.05);
    }
    for (const [at, len, v, hz] of s.noise) {
      const buf = AC.createBuffer(1, Math.ceil(AC.sampleRate * len), AC.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = AC.createBufferSource(), bp = AC.createBiquadFilter(), g = AC.createGain();
      src.buffer = buf; bp.type = "bandpass"; bp.frequency.setValueAtTime(hz, t0 + at); bp.frequency.exponentialRampToValueAtTime(hz * 3, t0 + at + len);
      g.gain.setValueAtTime(v, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      src.connect(bp).connect(g).connect(out); src.start(t0 + at);
    }
  } catch { /* audio not available */ }
}
