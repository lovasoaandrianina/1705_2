// Poker : cartes, mélange sécurisé et évaluation des mains (7 cartes → meilleur jeu de 5).
// Carte = entier 0..51 : rang = (c % 13) + 2 (2..14, 14 = As), couleur = floor(c / 13) (0 ♣, 1 ♦, 2 ♥, 3 ♠).
import crypto from "node:crypto";

export const rnd = (n) => crypto.randomInt(n);
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const newDeck = () => shuffle(Array.from({ length: 52 }, (_, i) => i));

const B1 = 15, B2 = 225, B3 = 3375, B4 = 50625, B5 = 759375;

// Meilleure quinte dans un masque de rangs (bit 1 = As bas) : renvoie la carte haute, ou 0
function bestStraight(mask) {
  for (let h = 14; h >= 5; h--) { const need = 31 << (h - 4); if ((mask & need) === need) return h; }
  return 0;
}

// Score numérique : plus il est grand, meilleure est la main. Catégorie × 15^5 + départage par les kickers.
export function score7(cs) {
  const cnt = new Array(15).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cs) {
    const r = (c % 13) + 2, s = (c / 13) | 0;
    cnt[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
  }
  if (cnt[14]) mask |= 2;
  const fs = sc.findIndex((n) => n >= 5);
  if (fs >= 0) {
    let m = sm[fs];
    if (m & (1 << 14)) m |= 2;
    const h = bestStraight(m);
    if (h) return 8 * B5 + h * B4; // quinte flush
  }
  const quads = [], trips = [], pairs = [];
  for (let r = 14; r >= 2; r--) { const n = cnt[r]; if (n === 4) quads.push(r); else if (n === 3) trips.push(r); else if (n === 2) pairs.push(r); }
  const others = (ex, k) => {
    const o = [];
    for (let r = 14; r >= 2 && o.length < k; r--) if (cnt[r] && !ex.includes(r)) o.push(r);
    while (o.length < k) o.push(0);
    return o;
  };
  if (quads.length) return 7 * B5 + quads[0] * B4 + others([quads[0]], 1)[0] * B3;
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const p = trips.length > 1 ? Math.max(trips[1], pairs[0] || 0) : pairs[0];
    return 6 * B5 + trips[0] * B4 + p * B3;
  }
  if (fs >= 0) {
    const rs = [];
    for (let r = 14; r >= 2 && rs.length < 5; r--) if (sm[fs] & (1 << r)) rs.push(r);
    return 5 * B5 + rs[0] * B4 + rs[1] * B3 + rs[2] * B2 + rs[3] * B1 + rs[4];
  }
  const st = bestStraight(mask);
  if (st) return 4 * B5 + st * B4;
  if (trips.length) { const [a, b] = others([trips[0]], 2); return 3 * B5 + trips[0] * B4 + a * B3 + b * B2; }
  if (pairs.length >= 2) return 2 * B5 + pairs[0] * B4 + pairs[1] * B3 + others([pairs[0], pairs[1]], 1)[0] * B2;
  if (pairs.length === 1) { const [a, b, c] = others([pairs[0]], 3); return B5 + pairs[0] * B4 + a * B3 + b * B2 + c * B1; }
  const [a, b, c, d, e] = others([], 5);
  return a * B4 + b * B3 + c * B2 + d * B1 + e;
}

const RN = { 11: "Valet", 12: "Dame", 13: "Roi", 14: "As" };
const rn = (r) => RN[r] || String(r);
const de = (r) => (r === 14 ? "d'As" : `de ${rn(r)}${r >= 11 && r <= 13 ? "s" : ""}`);

export function handName(score) {
  const cat = Math.floor(score / B5), d1 = Math.floor(score / B4) % 15, d2 = Math.floor(score / B3) % 15;
  switch (cat) {
    case 8: return d1 === 14 ? "Quinte flush royale" : `Quinte flush (${rn(d1)} haute)`;
    case 7: return `Carré ${de(d1)}`;
    case 6: return `Full (${rn(d1)} + ${rn(d2)})`;
    case 5: return `Couleur (${rn(d1)} haute)`;
    case 4: return `Quinte (${rn(d1)} haute)`;
    case 3: return `Brelan ${de(d1)}`;
    case 2: return `Double paire (${rn(d1)} et ${rn(d2)})`;
    case 1: return `Paire ${de(d1)}`;
    default: return `Carte haute (${rn(d1)})`;
  }
}
