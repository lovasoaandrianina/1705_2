// Poker Texas Hold'em No-Limit, cash game, 9 places, 100 % joueurs réels (2 à 9). La main démarre dès que 2 joueurs ont des jetons.
// Autorité serveur : le client n'envoie que « fold / check / call / raise ». L'état est du JSON pur (sauvegardé dans Turso).
import { HttpError } from "../rami/money.js";
import { newDeck, rnd, score7, handName } from "./cards.js";

export const SEATS = 9;
export const MIN_BUY = 2000, MAX_BUY = 20000;   // achat de jetons : 1 jeton = 1 Ar
export const TURN_MS = 25000;       // temps de réflexion d'un joueur
export const BETWEEN_MS = 7000;     // pause entre deux mains (résultat visible)
export const RUNOUT_MS = 3200;      // suspense entre les cartes quand tout le monde est à tapis
export const REVEAL_FLOP_MS = 2800; // le flop se retourne carte par carte avant que les enchères reprennent
export const REVEAL_MS = 2100;      // turn / river
export const SHOWDOWN_MS = 2000;    // suspense avant que les mains soient montrées
export const BUST_KICK_MS = 90000;  // un joueur sans jetons qui ne rachète pas est retiré de la table

const bad = (m) => new HttpError(400, m);
const blankHand = () => ({ inHand: false, hole: [], bet: 0, total: 0, folded: true, allin: false, acted: false, noRaise: false, lastAct: null });
const emptySeat = () => ({ empty: true, userId: null, name: "", stack: 0, invested: 0, pendingAdd: 0, leaving: false, timeouts: 0, bustedAt: 0, feesPaid: 0 });

export function newGame(sb, bb, feeBps = 0, buyIn = MIN_BUY) {
  const g = { game: "poker", sb, bb, buyIn, feeBps, feeLog: [], feesTotal: 0, seats: [], button: rnd(SEATS), handNo: 0, phase: "between", nextAt: Date.now() + 3000, hand: null, last: null };
  for (let i = 0; i < SEATS; i++) g.seats.push({ ...blankHand(), ...emptySeat() });
  return g;
}

export const humans = (g) => g.seats.map((s, i) => ({ s, i })).filter((x) => !x.s.empty);
export const seatOf = (g, userId) => g.seats.findIndex((s) => !s.empty && s.userId === userId);
export const hasHumans = (g) => humans(g).length > 0;

// Anciennes tables (avec des bots) : les bots disparaissent, les joueurs en attente sont assis
export function normalize(g) {
  if (!g.buyIn) g.buyIn = MIN_BUY;
  for (const s of g.seats) if (s.bot !== undefined || s.profile !== undefined) { if (s.bot) Object.assign(s, emptySeat(), { hole: [] }); delete s.bot; delete s.profile; }
  const q = g.queue || []; delete g.queue;
  for (const p of q) { try { seatHuman(g, p); } catch { /* table pleine : rare */ } }
  return g;
}

/* ── Arrivée d'un joueur : il prend une place libre (même en cours de main : il joue à partir de la main suivante) ── */
export function seatHuman(g, p) {
  const cand = [];
  g.seats.forEach((s, i) => { if (s.empty) cand.push(i); });
  if (!cand.length) throw bad("Table complète (9 joueurs)");
  const i = cand[rnd(cand.length)];
  Object.assign(g.seats[i], blankHand(), { empty: false, userId: p.userId, name: p.name, stack: p.buy, invested: p.buy, pendingAdd: 0, leaving: false, timeouts: 0, bustedAt: 0, feesPaid: 0 });
  return i;
}

// Départ volontaire : seulement quand le bouton dealer est sur le joueur (pas de « gagne un pot et part »).
// Exceptions : seul à la table, ou plus de jetons. Renvoie le nombre de mains avant que le bouton lui arrive.
export function leaveCheck(g, i) {
  const s = g.seats[i];
  if (g.seats.filter((x) => !x.empty).length < 2 || s.stack + s.pendingAdd === 0 || g.button === i) return { ok: true, in: 0 };
  const elig = (k) => !g.seats[k].empty && g.seats[k].stack > 0 && !g.seats[k].leaving;
  let n = 0, cur = g.button;
  for (let guard = 0; guard < SEATS * 2; guard++) {
    let nx = -1;
    for (let k = 1; k <= SEATS; k++) { const c = (cur + k) % SEATS; if (elig(c)) { nx = c; break; } }
    if (nx < 0) break;
    n++; cur = nx;
    if (cur === i) break;
  }
  return { ok: false, in: n };
}

// Un joueur peut encaisser dès qu'il n'a plus de cartes en jeu
export const exitable = (g, s) => !g.hand || !s.inHand || s.folded;

export function requestLeave(g, i) {
  const s = g.seats[i];
  if (s.empty) return;
  s.leaving = true;
  if (g.hand && s.inHand && !s.folded) {
    // quitter en cours de main = se coucher ; mais s'il est le dernier en lice, il remporte le pot (sinon les jetons seraient perdus)
    if (!g.seats.some((x, k) => k !== i && x.inHand && !x.folded)) { g.hand.waitUntil = 0; return endUncontested(g, i); }
    s.folded = true; s.lastAct = { t: "fold" };
    if (g.seats.filter((x) => x.inHand && !x.folded).length === 1) g.hand.waitUntil = 0; // il ne reste qu'un joueur : la main se termine tout de suite
    advance(g);
  }
}

// Libère la place et renvoie ce qu'il faut rendre au joueur
export function vacate(g, i) {
  const s = g.seats[i];
  const out = { userId: s.userId, payout: s.stack + s.pendingAdd, invested: s.invested, feesPaid: s.feesPaid || 0 };
  Object.assign(s, emptySeat(), { hole: [] });
  return out;
}

export function addChips(g, i, amount) {
  const s = g.seats[i];
  if (g.hand && s.inHand && !s.folded) s.pendingAdd += amount; else s.stack += amount;
  s.bustedAt = 0;
  s.invested += amount;
}

/* ── Début de main ── */
const put = (s, x) => { x = Math.min(x, s.stack); s.stack -= x; s.bet += x; s.total += x; if (s.stack === 0) s.allin = true; return x; };

function startHand(g) {
  for (const s of g.seats) { if (s.pendingAdd) { s.stack += s.pendingAdd; s.pendingAdd = 0; } }
  const elig = g.seats.map((s, i) => i).filter((i) => g.seats[i].stack > 0 && !g.seats[i].leaving);
  if (elig.length < 2) { g.nextAt = Date.now() + 2000; return; }

  for (const s of g.seats) Object.assign(s, blankHand());
  for (const i of elig) { const s = g.seats[i]; s.inHand = true; s.folded = false; }

  const after = (from, list) => { for (let k = 1; k <= SEATS; k++) { const i = (from + k) % SEATS; if (list.includes(i)) return i; } return -1; };
  g.button = after(g.button, elig);
  const headsUp = elig.length === 2;
  const sbI = headsUp ? g.button : after(g.button, elig);
  const bbI = after(sbI, elig);
  g.handNo++;
  const h = (g.hand = { n: g.handNo, deck: newDeck(), board: [], street: "preflop", currentBet: g.bb, minRaise: g.bb, fullLevel: g.bb, toAct: -1, deadline: 0, waitUntil: 0 });
  put(g.seats[sbI], g.sb); g.seats[sbI].lastAct = { t: "sb" };
  put(g.seats[bbI], g.bb); g.seats[bbI].lastAct = { t: "bb" };
  for (let r = 0; r < 2; r++) for (let k = 1; k <= SEATS; k++) { const i = (g.button + k) % SEATS; if (g.seats[i].inHand) g.seats[i].hole.push(h.deck.pop()); }
  g.phase = "hand";
  h.toAct = nextActor(g, bbI);
  stamp(g);
  advance(g);
}

const needsAction = (g, s) => s.inHand && !s.folded && !s.allin && (!s.acted || s.bet < g.hand.currentBet);
function nextActor(g, from) {
  for (let k = 1; k <= SEATS; k++) { const i = (from + k + SEATS) % SEATS; if (needsAction(g, g.seats[i])) return i; }
  return -1;
}
function stamp(g) { g.hand.deadline = Date.now() + TURN_MS; }

/* ── Boucle de la main : fin de tour d'enchères, flop / turn / river, abattage ── */
function advance(g) {
  const h = g.hand;
  if (!h) return;
  for (;;) {
    if (h.waitUntil && Date.now() < h.waitUntil) return;
    h.waitUntil = 0;
    const alive = g.seats.filter((s) => s.inHand && !s.folded);
    if (alive.length === 1) return endUncontested(g, g.seats.indexOf(alive[0]));
    const can = alive.filter((s) => !s.allin);
    const done = can.every((s) => s.acted && s.bet >= h.currentBet) || (can.length <= 1 && can.every((s) => s.bet >= h.currentBet));
    if (done) {
      refundUncalled(g); // la part du plus gros tapis que personne ne peut suivre est rendue avant toute carte
      if (h.street === "river") {
        if (!h.sd) { h.sd = true; h.waitUntil = Date.now() + SHOWDOWN_MS; return; } // petit suspense avant l'abattage
        return showdown(g);
      }
      nextStreet(g);
      // les cartes se révèlent lentement ; les enchères reprennent ensuite (tout le monde à tapis : les cartes sortent une à une)
      h.waitUntil = Date.now() + (can.length <= 1 ? RUNOUT_MS : h.street === "flop" ? REVEAL_FLOP_MS : REVEAL_MS);
      return;
    }
    const cur = g.seats[h.toAct];
    if (!cur || !needsAction(g, cur)) { h.toAct = nextActor(g, h.toAct >= 0 ? h.toAct : g.button); stamp(g); }
    return;
  }
}

// Mise non suivie : si le joueur A a misé plus que tout le monde peut suivre (ex. 20 000 contre un tapis de 15 000),
// l'excédent (5 000) lui est rendu tout de suite, avant l'affichage des cartes ; il n'entre jamais dans un pot.
function refundUncalled(g) {
  const h = g.hand;
  const order = g.seats.map((s, i) => i).filter((i) => g.seats[i].total > 0).sort((a, b) => g.seats[b].total - g.seats[a].total);
  if (!order.length) return;
  const top = g.seats[order[0]], second = order.length > 1 ? g.seats[order[1]].total : 0;
  const excess = top.total - second;
  if (excess <= 0 || top.folded || !top.inHand) return;
  top.total -= excess; top.bet = Math.max(0, top.bet - excess); top.stack += excess; top.allin = top.stack === 0;
  if (!h.refund) h.refund = { seat: order[0], name: top.name, amount: excess };
}

function nextStreet(g) {
  const h = g.hand;
  h.deck.pop(); // brûlée
  const n = h.street === "preflop" ? 3 : 1;
  for (let k = 0; k < n; k++) h.board.push(h.deck.pop());
  h.street = h.street === "preflop" ? "flop" : h.street === "flop" ? "turn" : "river";
  h.currentBet = 0; h.minRaise = g.bb; h.fullLevel = 0; h.toAct = -1;
  for (const s of g.seats) { s.bet = 0; s.acted = false; s.noRaise = false; if (s.lastAct && s.lastAct.t !== "fold") s.lastAct = null; }
}

/* ── Actions d'un joueur ── */
export function act(g, i, a, auto = false) {
  const h = g.hand;
  if (!h || g.phase !== "hand") throw bad("Pas de main en cours");
  if (h.toAct !== i) throw bad("Ce n'est pas ton tour");
  if (h.waitUntil) throw bad("Patiente un instant");
  const s = g.seats[i];
  const toCall = Math.min(h.currentBet - s.bet, s.stack);
  if (a.type === "fold") { s.folded = true; s.lastAct = { t: "fold" }; }
  else if (a.type === "check") {
    if (h.currentBet !== s.bet) throw bad("Tu ne peux pas checker : suis ou couche-toi");
    s.acted = true; s.lastAct = { t: "check" };
  } else if (a.type === "call") {
    if (toCall > 0) put(s, toCall);
    s.acted = true; s.lastAct = toCall > 0 ? { t: s.allin ? "allin" : "call", amt: s.bet } : { t: "check" };
  } else if (a.type === "raise") {
    let to = Math.floor(Number(a.to));
    if (!Number.isFinite(to)) throw bad("Montant invalide");
    const maxTo = s.bet + s.stack;
    if (to >= maxTo) to = maxTo;
    const allIn = to === maxTo;
    if (to <= h.currentBet) {
      if (!allIn) throw bad("Relance trop faible");
      return act(g, i, { type: "call" }, auto); // tapis qui ne dépasse pas la mise : c'est un simple « suivre »
    }
    if (s.noRaise) throw bad("Relance impossible (relance incomplète d'un joueur à tapis) : suis ou couche-toi");
    const minTo = h.currentBet + h.minRaise;
    if (to < minTo && !allIn) throw bad(`Relance minimum : ${minTo}`);
    put(s, to - s.bet);
    const prev = h.currentBet, full = to >= h.fullLevel + h.minRaise;
    h.currentBet = to;
    if (full) {
      h.minRaise = Math.max(h.minRaise, to - prev); h.fullLevel = to;
      for (const o of g.seats) if (o !== s && o.inHand && !o.folded && !o.allin) { o.acted = false; o.noRaise = false; }
    } else {
      for (const o of g.seats) if (o !== s && o.inHand && !o.folded && !o.allin && o.acted) o.noRaise = true; // relance incomplète : pas de re-relance
    }
    s.acted = true; s.noRaise = false;
    s.lastAct = { t: s.allin ? "allin" : prev === 0 ? "bet" : "raise", amt: to };
  } else throw bad("Action inconnue");
  if (!auto) s.timeouts = 0;
  advance(g);
}

/* ── Fin de main ── */
const clockwise = (g, i) => (i - g.button + SEATS) % SEATS;

export function sidePots(g) {
  const ss = g.seats.map((s, i) => ({ s, i })).filter((x) => x.s.total > 0);
  const levels = [...new Set(ss.map((x) => x.s.total))].sort((a, b) => a - b);
  const out = []; let prev = 0;
  for (const L of levels) {
    let amount = 0; const parts = {};
    for (const { s, i } of ss) { const x = Math.min(s.total, L) - Math.min(s.total, prev); if (x > 0) { amount += x; parts[i] = x; } }
    const eligible = g.seats.map((s, i) => i).filter((i) => g.seats[i].inHand && !g.seats[i].folded && g.seats[i].total >= L);
    out.push({ amount, parts, eligible });
    prev = L;
  }
  return out;
}

function pay(g, won, i, amt) { won[i] = (won[i] || 0) + amt; g.seats[i].stack += amt; }

function endUncontested(g, w) {
  const h = g.hand, pot = g.seats.reduce((a, s) => a + s.total, 0);
  const won = {}; pay(g, won, w, pot);
  finish(g, { n: h.n, board: h.board.slice(), winners: [{ seat: w, amount: pot, hand: null }], shown: {}, pot, uncontested: true }, won);
}

export function showdown(g) {
  const h = g.hand, pot = g.seats.reduce((a, s) => a + s.total, 0);
  const alive = g.seats.map((s, i) => i).filter((i) => g.seats[i].inHand && !g.seats[i].folded);
  const score = {};
  for (const i of alive) score[i] = score7([...g.seats[i].hole, ...h.board]);
  const won = {};
  for (const p of sidePots(g)) {
    if (!p.eligible.length) { for (const [i, x] of Object.entries(p.parts)) pay(g, won, +i, x); continue; } // mise jamais suivie : rendue
    const best = Math.max(...p.eligible.map((i) => score[i]));
    const ws = p.eligible.filter((i) => score[i] === best).sort((a, b) => clockwise(g, a) - clockwise(g, b));
    const share = Math.floor(p.amount / ws.length); let rem = p.amount - share * ws.length;
    for (const i of ws) { pay(g, won, i, share + (rem > 0 ? 1 : 0)); if (rem > 0) rem--; } // jeton impair : premier à gauche du bouton
  }
  const shown = {};
  for (const i of alive) shown[i] = { cards: g.seats[i].hole.slice(), name: handName(score[i]) };
  const winners = Object.entries(won).filter(([, a]) => a > 0).map(([i, amount]) => ({ seat: +i, amount, hand: score[i] !== undefined ? handName(score[i]) : null }));
  finish(g, { n: h.n, board: h.board.slice(), winners, shown, pot, uncontested: false }, won);
}

// Commission : prélevée sur le GAIN NET de chaque main gagnée (gain du pot − ce que le joueur y avait mis), directement sur ses jetons
function finish(g, last, won) {
  if (g.hand && g.hand.refund) last.refund = g.hand.refund;
  last.fees = [];
  g.feeLog = g.feeLog || [];
  for (const [i, amt] of Object.entries(won)) {
    const s = g.seats[i], net = amt - s.total;
    const fee = net > 0 ? Math.round((net * (g.feeBps || 0)) / 10000) : 0;
    if (!fee) continue;
    s.stack -= fee; s.feesPaid = (s.feesPaid || 0) + fee; g.feesTotal = (g.feesTotal || 0) + fee;
    g.feeLog.push({ userId: s.userId, base: net, fee, n: last.n });
    last.fees.push({ seat: +i, amount: fee });
  }
  for (const w of last.winners) { w.name = g.seats[w.seat].name; w.fee = (last.fees.find((f) => f.seat === w.seat) || {}).amount || 0; }
  g.last = last;
  for (const s of g.seats) {
    s.bet = 0; s.total = 0;
    if (s.pendingAdd) { s.stack += s.pendingAdd; s.pendingAdd = 0; }
    if (!s.empty && s.stack === 0 && !s.bustedAt) s.bustedAt = Date.now();
  }
  g.hand = null; g.phase = "between";
  g.nextAt = Date.now() + (last.uncontested ? 4500 : BETWEEN_MS);
}

/* ── Temps qui passe : joueurs absents, main suivante ── */
function autoAct(g) {
  const h = g.hand, i = h.toAct, s = g.seats[i];
  s.timeouts++;
  try { act(g, i, { type: h.currentBet === s.bet ? "check" : "fold" }, true); } catch { /* rien */ }
  if (s.timeouts >= 2) requestLeave(g, i); // deux tours sans réponse : il est retiré et ses jetons lui sont rendus
}

export function tick(g) {
  const now = Date.now();
  let changed = false;
  for (const s of g.seats) if (!s.empty && s.stack === 0 && s.pendingAdd === 0 && s.bustedAt && now - s.bustedAt > BUST_KICK_MS && !s.leaving) { s.leaving = true; changed = true; }
  if (g.phase === "between") { if (now >= g.nextAt) { startHand(g); return true; } return changed; }
  const h = g.hand;
  if (!h) return changed;
  if (h.waitUntil) { if (now >= h.waitUntil) { advance(g); return true; } return changed; }
  const s = g.seats[h.toAct];
  if (!s) { advance(g); return true; }
  if (now > h.deadline) { autoAct(g); return true; }
  return changed;
}

/* ── Vue envoyée à un joueur (ses cartes seulement ; celles des autres au abattage) ── */
export function view(g, uid) {
  const now = Date.now(), h = g.hand, me = seatOf(g, uid);
  const mine = me >= 0 ? g.seats[me] : null;
  const myTurn = !!(h && mine && h.toAct === me && !h.waitUntil && g.phase === "hand");
  let legal = null;
  if (myTurn) {
    const toCall = Math.min(h.currentBet - mine.bet, mine.stack), maxTo = mine.bet + mine.stack;
    legal = {
      canCheck: h.currentBet === mine.bet, toCall,
      canRaise: !mine.noRaise && maxTo > h.currentBet,
      minTo: Math.min(h.currentBet + h.minRaise, maxTo), maxTo, noRaise: mine.noRaise,
    };
  }
  const shown = g.phase === "between" && g.last ? g.last.shown : {};
  const pot = g.seats.reduce((a, s) => a + s.total, 0);
  const myScore = mine && h && mine.hole.length === 2 && h.board.length >= 3 && !mine.folded ? handName(score7([...mine.hole, ...h.board])) : null;
  return {
    kind: "poker", sb: g.sb, bb: g.bb, buyIn: g.buyIn || MIN_BUY, minBuy: MIN_BUY, maxBuy: MAX_BUY,
    refund: h ? h.refund || null : g.last && g.last.refund ? g.last.refund : null, me, button: g.button, handNo: g.handNo,
    phase: g.phase, street: h ? h.street : null, board: h ? h.board : g.last && g.phase === "between" ? g.last.board : [],
    pot: h ? pot : 0, toAct: h ? h.toAct : -1, msLeft: h ? Math.max(0, h.deadline - now) : 0, turnMs: TURN_MS,
    nextMs: g.phase === "between" ? Math.max(0, g.nextAt - now) : 0, runout: !!(h && h.waitUntil), sd: !!(h && h.sd), leave: me >= 0 ? leaveCheck(g, me) : { ok: true, in: 0 },
    seats: g.seats.map((s, i) => ({
      i, empty: !!s.empty, name: s.name, stack: s.stack, bet: s.bet, folded: s.inHand ? s.folded : true, inHand: s.inHand && !!h,
      allin: s.allin, lastAct: s.lastAct, leaving: s.leaving, pendingAdd: s.pendingAdd,
      cards: i === me ? s.hole : shown[i] ? shown[i].cards : h && s.inHand && !s.folded ? [null, null] : [],
      handName: shown[i] ? shown[i].name : null,
    })),
    legal, myHand: myScore, last: g.last,
    mine: mine ? { stack: mine.stack, pendingAdd: mine.pendingAdd, invested: mine.invested, feesPaid: mine.feesPaid || 0, leaving: mine.leaving, busted: mine.stack === 0 && mine.pendingAdd === 0 } : null,
  };
}
