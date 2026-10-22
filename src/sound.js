// Sons de jeu synthétisés avec WebAudio : aucun fichier à charger, rien à héberger.
// Optimisé pour Safari iOS et Chrome mobile (déblocage AudioContext après geste utilisateur).
import { useEffect, useRef } from "react";

let ctx = null, master = null, noiseBuf = null;
let unlocked = false;
let muted = (() => { try { return localStorage.getItem("snd_muted") === "1"; } catch { return false; } })();
const subs = new Set();

function createCtx() {
  if (ctx) return ctx;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** Débloque l'AudioContext (obligatoire sur iOS Safari / Chrome Android). */
function unlock() {
  const c = createCtx();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
  // Buffer silencieux : force le déblocage sur certains WebKit
  if (!unlocked) {
    try {
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
      unlocked = true;
    } catch { /* ignore */ }
  }
}

function ac() {
  const c = createCtx();
  if (!c) return null;
  if (c.state === "suspended") c.resume().catch(() => {});
  return c;
}

// les navigateurs (surtout mobiles) exigent un geste utilisateur avant le son
if (typeof window !== "undefined") {
  const unlockOnce = () => {
    unlock();
    // on garde les listeners : le contexte peut se resuspendre (app en arrière-plan, interruption)
  };
  for (const ev of ["pointerdown", "touchstart", "touchend", "keydown", "click", "mousedown"]) {
    window.addEventListener(ev, unlockOnce, { passive: true, capture: true });
  }
  // reprise quand l'onglet redevient visible
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") unlock();
  });
  // iOS : reprise après interruption audio (appel, Siri…)
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", unlockOnce);
  }
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("snd_muted", m ? "1" : "0"); } catch { /* stockage indisponible */ }
  if (!m) unlock(); // en réactivant, on force le déblocage
  subs.forEach((f) => f());
}
export const onMuteChange = (f) => { subs.add(f); return () => subs.delete(f); };

function tone(f, d, { type = "sine", vol = 0.25, at = 0, to = null, a = 0.005, swell = false } = {}) {
  const c = ac(); if (!c || muted) return;
  try {
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(0.01, to), t + d);
    g.gain.setValueAtTime(0.0001, t);
    if (swell) { g.gain.exponentialRampToValueAtTime(vol, t + d * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    else { g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.03);
  } catch { /* ne jamais casser le jeu */ }
}
function noise(d, { vol = 0.3, at = 0, type = "bandpass", f = 2000, q = 1, to = null, swell = false } = {}) {
  const c = ac(); if (!c || muted) return;
  try {
    if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
    const t = c.currentTime + at, s = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf; flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f, t);
    if (to) flt.frequency.exponentialRampToValueAtTime(Math.max(0.01, to), t + d);
    if (swell) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + d * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    else { g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    s.connect(flt); flt.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.03);
  } catch { /* ignore */ }
}

const chip = (at = 0, k = 0) => { tone(2500 + k * 180, 0.07, { type: "triangle", vol: 0.17, at }); tone(3400 + k * 140, 0.06, { type: "triangle", vol: 0.1, at: at + 0.04 }); noise(0.03, { vol: 0.15, at, f: 5200 }); };

const S = {
  click: () => tone(900, 0.04, { type: "square", vol: 0.04 }),
  msg: () => { tone(880, 0.09, { vol: 0.11 }); tone(1320, 0.14, { vol: 0.09, at: 0.07 }); },
  pop: () => tone(700, 0.08, { vol: 0.1, to: 1100 }),
  // domino / cartes
  tile: () => { noise(0.06, { vol: 0.7, f: 2200, q: 2 }); tone(190, 0.09, { type: "triangle", vol: 0.35, to: 90 }); tone(1400, 0.03, { type: "square", vol: 0.05 }); },
  card: () => noise(0.13, { vol: 0.45, type: "highpass", f: 2500, to: 6000 }),
  deal: () => [0, 0.09, 0.18].forEach((t) => noise(0.1, { vol: 0.4, at: t, type: "highpass", f: 2800, to: 6500 })),
  shuffle: () => { for (let i = 0; i < 16; i++) noise(0.05, { vol: 0.3, at: i * 0.075 + Math.random() * 0.03, type: "bandpass", f: 1500 + Math.random() * 2500, q: 0.7 }); },
  draw: () => noise(0.12, { vol: 0.4, type: "highpass", f: 2000, to: 4500 }),
  discard: () => { noise(0.09, { vol: 0.6, f: 900, q: 1 }); tone(160, 0.07, { type: "triangle", vol: 0.25, to: 100 }); },
  pass: () => { tone(220, 0.14, { type: "triangle", vol: 0.22, to: 150 }); tone(150, 0.18, { type: "triangle", vol: 0.18, at: 0.1, to: 100 }); },
  // alertes
  turn: () => { tone(660, 0.12, { vol: 0.16 }); tone(990, 0.2, { vol: 0.16, at: 0.1 }); },
  tick: () => tone(1200, 0.035, { type: "square", vol: 0.06 }),
  claim: () => { tone(1568, 0.9, { vol: 0.18 }); tone(2093, 0.7, { vol: 0.1, at: 0.05 }); tone(784, 0.9, { vol: 0.14 }); },
  roundend: () => { tone(523, 0.15, { type: "triangle", vol: 0.18 }); tone(784, 0.3, { type: "triangle", vol: 0.18, at: 0.13 }); },
  win: () => { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.3, { type: "triangle", vol: 0.2, at: k * 0.11 })); [1047, 1319, 1568].forEach((f) => tone(f, 0.8, { type: "triangle", vol: 0.13, at: 0.5 })); },
  lose: () => [392, 330, 262].forEach((f, k) => tone(f, 0.4, { type: "sine", vol: 0.2, at: k * 0.22 })),
  // poker
  chip: () => chip(),
  bet: () => [0, 0.06, 0.12, 0.19].forEach((t, k) => chip(t, k)),
  allin: () => { [0, 0.06, 0.12, 0.19, 0.27, 0.35, 0.43].forEach((t, k) => chip(t, k % 4)); tone(70, 0.7, { vol: 0.3, at: 0.1, to: 45 }); },
  pot: () => [0, 0.07, 0.14, 0.21, 0.28].forEach((t, k) => chip(t, k)),
  check: () => { tone(140, 0.07, { vol: 0.45, to: 90 }); tone(140, 0.07, { vol: 0.4, at: 0.13, to: 90 }); noise(0.03, { vol: 0.3, f: 600 }); },
  fold: () => noise(0.2, { vol: 0.35, f: 3500, to: 900, q: 0.8 }),
  // suspense : la tension monte, puis la carte se retourne
  riser: (d = 2) => { tone(110, d, { type: "sawtooth", vol: 0.05, to: 330, swell: true }); noise(d, { vol: 0.12, f: 400, to: 3200, q: 2, swell: true }); },
  flip: () => { noise(0.16, { vol: 0.5, f: 1800, to: 5200, q: 0.8 }); tone(500, 0.12, { vol: 0.07, to: 800 }); tone(1320, 0.45, { vol: 0.07, at: 0.08 }); },
};
export const play = (name, ...args) => { try { unlock(); S[name]?.(...args); } catch { /* le son ne doit jamais casser le jeu */ } };

// Appelle cb(nouvelle, ancienne) quand la valeur change (pas au premier affichage)
export function useWatch(val, cb) {
  const prev = useRef(val);
  useEffect(() => { if (prev.current !== val) { const p = prev.current; prev.current = val; cb(val, p); } }, [val]); // eslint-disable-line
}
