// Domino à 2 ou 3 joueurs : jeu double-six, 7 dominos chacun. Autorité serveur.
// À 3 joueurs : sans domino jouable, le joueur passe (pas de pioche).
// À 2 joueurs : sans domino jouable, le joueur pioche dans le sabot jusqu'à pouvoir jouer ou jusqu'à épuisement, puis passe.
// Fin de manche : un joueur n'a plus de dominos (« sorti ») ou le jeu est bloqué (le plus petit total gagne).
// Le gagnant de la manche marque les points de tous les dominos restants chez les autres.
// Objectif configurable (100 ou 120). Seuil « moitié » pour les victoires spéciales (50 ou 60).
import { HttpError, MIN_STAKE, MAX_STAKE } from "../rami/money.js";
import { shuffle } from "../rami/engine.js";

export const TURN_MS = 20000;
export const DEAL_MS = 5600;
export const BETWEEN_MS = 9000;
export const TARGET = 100;
export const ALLOWED_TARGETS = [100, 120];
export const ALLOWED_PLAYERS = [2, 3];

const bad = (m) => new HttpError(400, m);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const val = (t) => t.a + t.b;
const mkSet = () => { const t = []; let id = 0; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push({ id: id++, a, b }); return t; };
const N = (g) => g.N || g.seats?.length || 3;
const halfOf = (target) => Math.floor(Number(target) / 2);

export function parseConfig(b) {
  const stake = int(b.stake);
  if (!(stake >= MIN_STAKE && stake <= MAX_STAKE)) throw bad(`Mise : entre ${MIN_STAKE} et ${MAX_STAKE} Ar`);
  let maxPlayers = int(b.maxPlayers);
  if (!ALLOWED_PLAYERS.includes(maxPlayers)) maxPlayers = 3;
  let target = int(b.target);
  if (!ALLOWED_TARGETS.includes(target)) target = TARGET;
  const ru = b.rules || {};
  return {
    stake,
    maxPlayers,
    config: {
      target,
      rules: {
        first50: !!ru.first50,
        big50: !!ru.big50,
        outDouble6: !!ru.outDouble6,
      },
    },
  };
}

// Dominos jouables : { idDomino: ["L"|"R"|"C"] } (C = ouverture)
function legal(g, seat) {
  const out = {};
  const h = g.hands[seat];
  if (!g.chain.length) { for (const t of h) out[t.id] = ["C"]; return out; }
  const L = g.chain[0].l, R = g.chain[g.chain.length - 1].r;
  for (const t of h) {
    const s = [];
    if (t.a === L || t.b === L) s.push("L");
    if (t.a === R || t.b === R) s.push("R");
    if (s.length) out[t.id] = s;
  }
  return out;
}

function startRound(g) {
  const n = N(g);
  const tiles = shuffle(mkSet());
  g.hands = Array.from({ length: n }, () => tiles.splice(0, 7));
  g.stock = tiles;
  g.chain = []; g.round++; g.moveNo = 0; g.passes = 0; g.lastPlay = null; g.roundResult = null;
  g.phase = "play"; g.nextAt = null; g.opening = null;

  let starter = null;
  if (g.round === 1) {
    for (let double = 0; double <= 6 && starter === null; double++) {
      const found = g.hands.findIndex((hand) => hand.some((t) => t.a === double && t.b === double));
      if (found !== -1) starter = found;
    }
    if (starter === null) {
      let best = null;
      g.hands.forEach((hand, seat) => hand.forEach((t) => {
        const rank = val(t);
        if (!best || rank > best.rank) best = { rank, seat };
      }));
      starter = best.seat;
    }
  } else {
    starter = (g.starter + 1) % n;
  }
  g.starter = starter;
  g.nextStarter = null;
  g.turn = starter;
  g.dealNo = g.round;
  g.dealUntil = Date.now() + DEAL_MS;
  g.deadline = g.dealUntil + TURN_MS;
}

export function newGame(seats, cfg) {
  const n = seats.length;
  const g = {
    game: "domino",
    seats,
    N: n,
    rules: cfg.rules,
    target: cfg.target || TARGET,
    scores: Array.from({ length: n }, () => 0),
    round: 0,
    hands: [], stock: [], chain: [], turn: 0, starter: null, phase: "play",
    winner: null, win: null, result: null, roundResult: null, nextStarter: null,
  };
  startRound(g);
  return g;
}

const ready = (g, seat) => {
  if (g.winner !== null) throw bad("La partie est terminée");
  if (g.phase !== "play") throw bad("Manche terminée : la suivante arrive");
  if (Date.now() < g.dealUntil) throw bad("Distribution en cours");
  if (g.turn !== seat) throw bad("Ce n'est pas ton tour");
};

export function play(g, seat, tileId, side) {
  ready(g, seat);
  const n = N(g);
  const h = g.hands[seat], i = h.findIndex((t) => t.id === tileId);
  if (i < 0) throw bad("Domino inconnu");
  const lg = legal(g, seat)[tileId];
  if (!lg) throw bad("Ce domino ne peut pas être posé");
  const t = h[i];
  if (!g.chain.length) { g.chain.push({ id: t.id, l: t.a, r: t.b }); side = "C"; }
  else {
    if (!lg.includes(side)) throw bad("Ce domino ne se pose pas de ce côté");
    if (side === "L") { const e = g.chain[0].l; g.chain.unshift(t.b === e ? { id: t.id, l: t.a, r: t.b } : { id: t.id, l: t.b, r: t.a }); }
    else { const e = g.chain[g.chain.length - 1].r; g.chain.push(t.a === e ? { id: t.id, l: t.a, r: t.b } : { id: t.id, l: t.b, r: t.a }); }
  }
  h.splice(i, 1);
  g.lastPlay = { seat, id: t.id, side, n: ++g.moveNo };
  g.passes = 0; g.opening = null;
  if (!h.length) return endRound(g, seat, "out", t);
  g.turn = (seat + 1) % n;
  g.deadline = Date.now() + TURN_MS;
}

/** À 2 joueurs uniquement : pioche un domino du sabot. Reste au même tour si un coup devient possible. */
export function draw(g, seat) {
  ready(g, seat);
  const n = N(g);
  if (n !== 2) throw bad("La pioche n'est disponible qu'à 2 joueurs");
  if (Object.keys(legal(g, seat)).length) throw bad("Tu as un domino jouable");
  if (!g.stock.length) throw bad("Le sabot est vide : passe");
  const tile = g.stock.shift();
  g.hands[seat].push(tile);
  g.lastPlay = { seat, id: tile.id, side: "D", n: ++g.moveNo, draw: true };
  g.passes = 0;
  // Tour conserve : le joueur peut rejouer / repiocher. Nouveau délai.
  g.deadline = Date.now() + TURN_MS;
}

export function pass(g, seat) {
  ready(g, seat);
  const n = N(g);
  if (Object.keys(legal(g, seat)).length) throw bad("Tu as un domino jouable");
  // À 2 joueurs : on ne passe que si le sabot est vide
  if (n === 2 && g.stock.length) throw bad("Pioche d'abord dans le sabot");
  g.passes++;
  if (g.passes >= n) return endRound(g, null, "block", null);
  g.turn = (seat + 1) % n;
  g.deadline = Date.now() + TURN_MS;
}

function endRound(g, outSeat, kind, lastTile) {
  const n = N(g);
  const totals = g.hands.map((h) => h.reduce((s, t) => s + val(t), 0));
  let winner = null;
  if (kind === "out") winner = outSeat;
  else {
    const min = Math.min(...totals);
    const who = totals.map((x, i) => (x === min ? i : -1)).filter((i) => i >= 0);
    if (who.length === 1) winner = who[0];
  }
  const points = winner === null ? 0 : totals.reduce((s, x, i) => s + (i === winner ? 0 : x), 0);
  if (winner !== null) g.scores[winner] += points;
  g.roundResult = { n: g.round, kind, winner, points, totals, lastTile, hands: g.hands.map((h) => h.map((t) => ({ ...t }))) };

  let reason = null;
  const r = g.rules;
  const half = halfOf(g.target);
  if (winner !== null) {
    if (kind === "out" && r.outDouble6 && lastTile.a === 6 && lastTile.b === 6) reason = "Sorti sur le double 6";
    else if (r.big50 && points >= half) reason = `${points} points pris en une seule fois (≥ ${half})`;
    else if (r.first50 && g.scores[winner] >= half && g.scores.every((s, i) => i === winner || s === 0)) reason = `${half} points sans qu'aucun autre joueur n'ait marqué`;
    else if (g.scores[winner] >= g.target) reason = `${g.target} points atteints`;
  }
  if (reason) { g.winner = winner; g.win = { seat: winner, reason }; g.phase = "over"; }
  else { g.phase = "between"; g.nextAt = Date.now() + BETWEEN_MS; g.nextStarter = (g.starter + 1) % n; }
}

function autoPlay(g) {
  const seat = g.turn;
  const n = N(g);
  const lg = legal(g, seat);
  const best = g.hands[seat].filter((t) => lg[t.id]).sort((x, y) => val(y) - val(x))[0];
  if (best) return play(g, seat, best.id, lg[best.id][0]);
  // À 2 joueurs : pioche tant que le sabot n'est pas vide et qu'aucun coup n'est possible
  if (n === 2 && g.stock.length) return draw(g, seat);
  return pass(g, seat);
}

export function tick(g) {
  const now = Date.now();
  if (g.winner !== null) return false;
  if (g.phase === "between") { if (now >= g.nextAt) { startRound(g); return true; } return false; }
  if (g.phase === "play" && now > g.deadline) { autoPlay(g); return true; }
  return false;
}

export function act(g, seat, a) {
  if (a.type === "play") play(g, seat, Number(a.tileId), a.side);
  else if (a.type === "pass") pass(g, seat);
  else if (a.type === "draw") draw(g, seat);
  else throw bad("Action inconnue");
}

export function plan(t, g, locked) {
  const pot = locked.reduce((s, x) => s + x, 0);
  const paid = g.seats.map(() => 0);
  paid[g.winner] = pot;
  return { pot, winnerAmount: pot, bonus: [], paid };
}

export function view(g, seat, names, avatars = []) {
  const now = Date.now(), c = g.chain;
  const n = N(g);
  const myTurn = g.winner === null && g.phase === "play" && g.turn === seat && now >= g.dealUntil;
  return {
    kind: "domino", N: n, seat, names, avatars, scores: g.scores, target: g.target, round: g.round, turn: g.turn, phase: g.phase,
    msLeft: Math.max(0, g.deadline - now), dealMs: Math.max(0, g.dealUntil - now), dealTotal: DEAL_MS, dealNo: g.dealNo, turnMs: TURN_MS,
    hand: g.hands[seat] || [], counts: g.hands.map((h) => h.length), stock: g.stock.length,
    chain: c, ends: c.length ? { l: c[0].l, r: c[c.length - 1].r } : null,
    legal: myTurn ? legal(g, seat) : {}, canDraw: myTurn && N(g) === 2 && !Object.keys(legal(g, seat)).length && g.stock.length > 0,
    opening: g.opening, lastPlay: g.lastPlay,
    roundResult: g.roundResult, nextMs: g.phase === "between" ? Math.max(0, g.nextAt - now) : 0,
    winner: g.winner, win: g.win, result: g.result, rules: g.rules,
  };
}
