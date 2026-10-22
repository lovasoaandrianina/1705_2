// Domino à 3 joueurs : jeu double-six, 7 dominos chacun. Autorité serveur.
// Sans domino jouable, le joueur passe ; aucune pioche n’est autorisée.
// Fin de manche : un joueur n'a plus de dominos (« sorti ») ou le jeu est bloqué (le plus petit total gagne).
// Le gagnant de la manche marque les points de tous les dominos restants chez les autres. Premier à 100 gagne.
import { HttpError, MIN_STAKE, MAX_STAKE } from "../rami/money.js";
import { shuffle } from "../rami/engine.js";

export const TURN_MS = 20000;   // 10 s de réflexion par décision
export const DEAL_MS = 5600;    // mélange (2,4 s) + distribution (2,8 s) + pause : visibles par tous
export const BETWEEN_MS = 9000; // pause entre deux manches (mains dévoilées)
export const TARGET = 100;

const bad = (m) => new HttpError(400, m);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const val = (t) => t.a + t.b;
const mkSet = () => { const t = []; let id = 0; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push({ id: id++, a, b }); return t; };

export function parseConfig(b) {
  const stake = int(b.stake);
  if (!(stake >= MIN_STAKE && stake <= MAX_STAKE)) throw bad(`Mise : entre ${MIN_STAKE} et ${MAX_STAKE} Ar`);
  const ru = b.rules || {};
  return {
    stake, maxPlayers: 3, // le Domino se joue à 3 joueurs, impérativement
    config: { target: TARGET, rules: { first50: !!ru.first50, big50: !!ru.big50, outDouble6: !!ru.outDouble6 } },
  };
}

// Dominos jouables : { idDomino: ["L"|"R"|"C"] } (C = ouverture)
// Le joueur qui a le double prioritaire ouvre, mais peut choisir n’importe quel domino.
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
  const tiles = shuffle(mkSet());
  g.hands = [0, 1, 2].map(() => tiles.splice(0, 7));
  g.stock = tiles; // réserve non utilisée : aucune pioche pendant la manche
  g.chain = []; g.round++; g.moveNo = 0; g.passes = 0; g.lastPlay = null; g.roundResult = null;
  g.phase = "play"; g.nextAt = null; g.opening = null;

  let starter = null;
  if (g.round === 1) {
    // Première manche uniquement : priorité au plus petit double, du 0-0 au 6-6.
    // Le joueur désigné peut ouvrir avec n'importe quel domino de sa main.
    for (let double = 0; double <= 6 && starter === null; double++) {
      const found = g.hands.findIndex((hand) => hand.some((t) => t.a === double && t.b === double));
      if (found !== -1) starter = found;
    }
    // Cas rare où aucun double n'est distribué : le plus gros domino départage.
    if (starter === null) {
      let best = null;
      g.hands.forEach((hand, seat) => hand.forEach((t) => {
        const rank = val(t);
        if (!best || rank > best.rank) best = { rank, seat };
      }));
      starter = best.seat;
    }
  } else {
    // À partir de la deuxième manche, le départ tourne dans le sens horaire,
    // indépendamment du gagnant de la manche précédente.
    starter = (g.starter + 1) % 3;
  }
  g.starter = starter;
  g.nextStarter = null;
  g.turn = starter;
  g.dealNo = g.round;
  g.dealUntil = Date.now() + DEAL_MS;
  g.deadline = g.dealUntil + TURN_MS;
}

export function newGame(seats, cfg) {
  const g = {
    game: "domino", seats, rules: cfg.rules, target: cfg.target || TARGET, scores: [0, 0, 0], round: 0,
    hands: [], stock: [], chain: [], turn: 0, starter: null, phase: "play", winner: null, win: null, result: null, roundResult: null, nextStarter: null,
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
  g.turn = (seat + 1) % 3;
  g.deadline = Date.now() + TURN_MS;
}

// Sans domino jouable, le joueur passe automatiquement : aucune pioche n’est proposée.
export function pass(g, seat) {
  ready(g, seat);
  if (Object.keys(legal(g, seat)).length) throw bad("Tu as un domino jouable");
  g.passes++;
  if (g.passes >= 3) return endRound(g, null, "block", null); // trois passes consécutives : jeu bloqué
  g.turn = (seat + 1) % 3;
  g.deadline = Date.now() + TURN_MS;
}

/* Fin de manche. « out » : le premier sans domino marque les points restants chez les autres.
   « block » : le plus petit total gagne la manche (égalité : personne ne marque). Puis victoires spéciales et objectif. */
function endRound(g, outSeat, kind, lastTile) {
  const totals = g.hands.map((h) => h.reduce((s, t) => s + val(t), 0));
  let winner = null;
  if (kind === "out") winner = outSeat;
  else { const min = Math.min(...totals), who = totals.map((x, i) => (x === min ? i : -1)).filter((i) => i >= 0); if (who.length === 1) winner = who[0]; }
  const points = winner === null ? 0 : totals.reduce((s, x, i) => s + (i === winner ? 0 : x), 0);
  if (winner !== null) g.scores[winner] += points;
  g.roundResult = { n: g.round, kind, winner, points, totals, lastTile, hands: g.hands.map((h) => h.map((t) => ({ ...t }))) };

  let reason = null;
  const r = g.rules;
  if (winner !== null) {
    if (kind === "out" && r.outDouble6 && lastTile.a === 6 && lastTile.b === 6) reason = "Sorti sur le double 6";
    else if (r.big50 && points >= 50) reason = `${points} points pris en une seule fois`;
    else if (r.first50 && g.scores[winner] >= 50 && g.scores.every((s, i) => i === winner || s === 0)) reason = "50 points sans qu'aucun autre joueur n'ait marqué";
    else if (g.scores[winner] >= g.target) reason = `${g.target} points atteints`;
  }
  if (reason) { g.winner = winner; g.win = { seat: winner, reason }; g.phase = "over"; }
  else { g.phase = "between"; g.nextAt = Date.now() + BETWEEN_MS; g.nextStarter = (g.starter + 1) % 3; }
}

// Joueur absent : il joue son plus gros domino jouable, sinon passe sans piocher.
function autoPlay(g) {
  const seat = g.turn;
  const lg = legal(g, seat);
  const best = g.hands[seat].filter((t) => lg[t.id]).sort((x, y) => val(y) - val(x))[0];
  if (best) return play(g, seat, best.id, lg[best.id][0]);
  return pass(g, seat);
}

// Avance le temps : prochaine manche après la pause, jeu automatique après 10 s
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
  else throw bad("Action inconnue");
}

// Le pot revient entièrement au gagnant de la partie (commission prélevée ensuite sur son gain net)
export function plan(t, g, locked) {
  const pot = locked.reduce((s, x) => s + x, 0);
  const paid = g.seats.map(() => 0);
  paid[g.winner] = pot;
  return { pot, winnerAmount: pot, bonus: [], paid };
}

export function view(g, seat, names) {
  const now = Date.now(), c = g.chain;
  const myTurn = g.winner === null && g.phase === "play" && g.turn === seat && now >= g.dealUntil;
  return {
    kind: "domino", N: 3, seat, names, scores: g.scores, target: g.target, round: g.round, turn: g.turn, phase: g.phase,
    msLeft: Math.max(0, g.deadline - now), dealMs: Math.max(0, g.dealUntil - now), dealTotal: DEAL_MS, dealNo: g.dealNo, turnMs: TURN_MS,
    hand: g.hands[seat] || [], counts: g.hands.map((h) => h.length), stock: g.stock.length,
    chain: c, ends: c.length ? { l: c[0].l, r: c[c.length - 1].r } : null,
    legal: myTurn ? legal(g, seat) : {}, opening: g.opening, lastPlay: g.lastPlay,
    roundResult: g.roundResult, nextMs: g.phase === "between" ? Math.max(0, g.nextAt - now) : 0,
    winner: g.winner, win: g.win, result: g.result, rules: g.rules,
  };
}