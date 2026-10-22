// Adaptateur « Rami » pour le service de tables (tables.js) : config, actions, minuterie, répartition du pot.
import * as E from "./engine.js";
import { HttpError, MIN_STAKE, MAX_STAKE } from "./money.js";

const bad = (m) => new HttpError(400, m);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

export function parseConfig(b) {
  const stake = int(b.stake), maxPlayers = int(b.maxPlayers);
  if (!(stake >= MIN_STAKE && stake <= MAX_STAKE)) throw bad(`Mise : entre ${MIN_STAKE} et ${MAX_STAKE} Ar`);
  if (!(maxPlayers >= 3 && maxPlayers <= 5)) throw bad("Une table accueille 3 à 5 joueurs");
  const ru = b.rules || {}, op = b.options || {};
  const bonus = (o, name) => {
    const on = !!(o && o.on), amount = on ? int(o.amount) : 0;
    if (on && !(amount >= 1)) throw bad(`${name} : montant invalide`);
    return { on, amount };
  };
  const options = { x2: !!op.x2, carre: bonus(op.carre, "Carré"), ten: bonus(op.ten, "10 cartes") };
  const cap = stake * (maxPlayers - 1); // pot d'une table pleine moins une mise : le gagnant garde au moins sa mise
  if (options.carre.amount + options.ten.amount > cap) throw bad(`Les primes ne peuvent pas dépasser ${cap} Ar au total`);
  return { stake, maxPlayers, config: { rules: { needSet: !!ru.needSet, needRun: !!ru.needRun, joker: !!ru.joker }, options } };
}

export const newGame = (seats, cfg) => E.newGame(seats, cfg);

export function act(g, seat, a, cfg) {
  if (a.type === "draw") E.draw(g, seat, a.from === "discard" ? "discard" : "stock");
  else if (a.type === "discard") E.discard(g, seat, Number(a.cardId));
  else if (a.type === "rami") E.rami(g, seat, cfg);
  else if (a.type === "undo") E.undo(g, seat);
  else if (a.type === "claim") E.claim(g, seat, a.kind === "ten" ? "ten" : "carre");
  else throw bad("Action inconnue");
}

// Joueur absent : jeu automatique après 10 s
export function tick(g) {
  if (g.winner === null && Date.now() > g.deadline) { E.autoPlay(g); return true; }
  return false;
}

// Pot = somme des mises. Le premier carré et le premier « 10 cartes » touchent leur prime, le gagnant empoche le reste (il garde au moins une mise).
export function plan(t, g, locked) {
  const pot = locked.reduce((s, x) => s + x, 0), o = t.config.options;
  let rest = pot;
  const bonus = [];
  for (const [key, label] of [["carre", "Carré"], ["ten", "10 cartes"]]) {
    const seat = g.claims?.[key];
    if (seat === null || seat === undefined || !o[key]?.on) continue;
    const amount = Math.min(o[key].amount, Math.max(0, rest - t.stake));
    if (amount <= 0) continue;
    rest -= amount;
    bonus.push({ key, label, seat, amount });
  }
  const paid = g.seats.map(() => 0);
  bonus.forEach((b) => (paid[b.seat] += b.amount));
  paid[g.winner] += rest;
  return { pot, winnerAmount: rest, bonus, paid };
}

export const view = E.viewFor;