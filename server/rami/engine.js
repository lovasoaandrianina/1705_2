// Moteur de Rami côté serveur : distribution, tours, règles de la table, primes du pot, détection du gain.
export const TURN_MS = 20000; // 10 s de réflexion par décision (pioche, puis défausse) ; au-delà : jeu automatique
export const VOTE_MS = 20000; // temps pour répondre au vote du ×2
const isRed = (s) => s === 1 || s === 2;
const fail = (m) => { throw Object.assign(new Error(m), { status: 400 }); };

export const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const mkDeck = () => {
  const d = [];
  for (let k = 0; k < 2; k++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ id: k * 52 + s * 13 + r - 1, r, s });
  return d;
};

// Joker : même valeur que la carte retournée, couleur opposée (6 rouge → les 6 noirs)
export const jokerSpec = (c) => ({ r: c.r, suits: isRed(c.s) ? [0, 3] : [1, 2] });
export const isJoker = (c, J) => !!J && c.r === J.r && J.suits.includes(c.s);

/* Recherche d'une partition de la main en brelans/carrés/suites.
   ctx.needSet / needRun : obligations de la table (pour gagner).
   ctx.milestone + maxSkips : « au moins N cartes rangées » (les autres cartes restent libres). */
function solve(grid, wilds, ctx) {
  let s = -1, r = -1;
  outer: for (let rr = 1; rr <= 13; rr++)
    for (let ss = 0; ss < 4; ss++) if (grid[ss][rr].length) { s = ss; r = rr; break outer; }
  if (s < 0) {
    if (ctx.sets < ctx.needSet || ctx.runs < ctx.needRun) return false;
    if (ctx.milestone) return ctx.skips + wilds.length <= ctx.maxSkips; // un joker non placé compte comme carte libre
    if (wilds.length) ctx.out.push({ kind: "extra", cards: [...wilds] });
    return true;
  }
  const others = [0, 1, 2, 3].filter((x) => x !== s && grid[x][r].length);
  for (let m = 0; m < 1 << others.length; m++) {
    const sub = others.filter((_, i) => m & (1 << i));
    const k = 1 + sub.length;
    for (let w = 0; w <= Math.min(wilds.length, 4 - k); w++) {
      if (k + w < 3) continue;
      const got = [grid[s][r].pop(), ...sub.map((x) => grid[x][r].pop())];
      const ws = Array.from({ length: w }, () => wilds.pop());
      ctx.sets++;
      const ok = solve(grid, wilds, ctx);
      ctx.sets--;
      grid[s][r].push(got[0]);
      sub.forEach((x, i) => grid[x][r].push(got[i + 1]));
      for (let i = w - 1; i >= 0; i--) wilds.push(ws[i]);
      if (ok) { ctx.out.push({ kind: "set", cards: [...got, ...ws] }); return true; }
    }
  }
  const tryRun = (seq) => { // seq : rangs des vraies cartes (>0) ou -1 pour un joker
    const reals = seq.filter((j) => j > 0);
    const wn = seq.length - reals.length;
    const got = reals.map((j) => grid[s][j].pop());
    const ws = Array.from({ length: wn }, () => wilds.pop());
    ctx.runs++;
    const ok = solve(grid, wilds, ctx);
    ctx.runs--;
    reals.forEach((j, i) => grid[s][j].push(got[i]));
    for (let i = wn - 1; i >= 0; i--) wilds.push(ws[i]);
    if (!ok) return false;
    let a = 0, b = 0;
    ctx.out.push({ kind: "run", cards: seq.map((j) => (j > 0 ? got[a++] : ws[b++])) });
    return true;
  };
  for (let lead = 0; lead <= 2 && lead <= wilds.length && r - lead >= 1; lead++) {
    const dfs = (j, seq) => {
      if (seq.length >= 3 && tryRun(seq)) return true;
      if (j > 13) return false;
      if (grid[s][j].length && dfs(j + 1, [...seq, j])) return true;
      if (seq.filter((x) => x < 0).length < wilds.length && dfs(j + 1, [...seq, -1])) return true;
      return false;
    };
    if (dfs(r + 1, [...Array(lead).fill(-1), r])) return true;
  }
  if (r === 1) { // suite finissant par l'As haut (…Q-K-A)
    for (let k = 12; k >= 2; k--) {
      const seq = [];
      for (let j = k; j <= 13; j++) seq.push(grid[s][j].length ? j : -1);
      seq.push(1);
      if (seq.filter((x) => x < 0).length <= wilds.length && tryRun(seq)) return true;
    }
  }
  if (ctx.skips < ctx.maxSkips) { // cette carte reste libre (hors combinaison)
    const c = grid[s][r].pop();
    ctx.skips++;
    const ok = solve(grid, wilds, ctx);
    ctx.skips--;
    grid[s][r].push(c);
    if (ok) return true;
  }
  return false;
}

const prep = (cards, J) => {
  const grid = [0, 1, 2, 3].map(() => Array.from({ length: 14 }, () => []));
  const wilds = [];
  cards.forEach((c) => (isJoker(c, J) ? wilds.push(c) : grid[c.s][c.r].push(c)));
  return { grid, wilds };
};
const mkCtx = (o = {}) => ({ out: [], sets: 0, runs: 0, skips: 0, maxSkips: 0, milestone: false, needSet: 0, needRun: 0, ...o });

// Toutes les cartes en combinaisons (victoire), en respectant les obligations de la table
export function meldsOf(cards, J, rules = {}) {
  const { grid, wilds } = prep(cards, J);
  const ctx = mkCtx({ needSet: +!!rules.needSet, needRun: +!!rules.needRun });
  return solve(grid, wilds, ctx) ? ctx.out : null;
}
// « 10 cartes » : au moins n cartes de la main sont rangées en combinaisons valides
export function meldedAtLeast(cards, J, n) {
  if (cards.length < n) return false;
  const { grid, wilds } = prep(cards, J);
  return solve(grid, wilds, mkCtx({ milestone: true, maxSkips: cards.length - n }));
}
// Validation d'une combinaison de 3 ou 4 cartes. Un joker ne compte que s'il
// remplace exactement une valeur/couleur manquante dans un groupe valide.
function validGroup(group, J) {
  if (group.length < 3 || group.length > 4) return false;
  const wild = group.filter(c => isJoker(c, J));
  const real = group.filter(c => !isJoker(c, J));
  if (!real.length) return false;
  // Brelan/carré : même rang, couleurs distinctes, joker(s) = couleurs manquantes.
  const ranks = new Set(real.map(c => c.r));
  const suits = new Set(real.map(c => c.s));
  if (ranks.size === 1 && suits.size === real.length && real.length + wild.length <= 4) return true;
  // Suite : même couleur et rangs consécutifs, avec jokers aux rangs manquants.
  const suitSet = new Set(real.map(c => c.s));
  if (suitSet.size !== 1 || new Set(real.map(c => c.r)).size !== real.length) return false;
  const suit = real[0].s;
  const ranksInGroup = real.map(c => c.r);
  // As bas (A-2-3) ou haut (Q-K-A), mais jamais cyclique au milieu.
  const candidates = [];
  for (let a = 1; a <= 14 - group.length + 1; a++) {
    const seq = Array.from({length: group.length}, (_,i) => a+i).map(r => r === 14 ? 1 : r);
    if (new Set(seq).size !== seq.length) continue;
    if (seq.filter(r => ranksInGroup.includes(r)).length === real.length) candidates.push(seq);
  }
  return candidates.some(seq => ranksInGroup.every(r => seq.includes(r)) && seq.filter(r => !ranksInGroup.includes(r)).length === wild.length);
}
function combinations(items, size, start=0, prefix=[], out=[]) {
  if (prefix.length === size) { out.push(prefix); return out; }
  for (let i=start; i<=items.length-(size-prefix.length); i++) combinations(items,size,i+1,[...prefix,items[i]],out);
  return out;
}
// « Carré » : quatre cartes formant un carré (même rang) ou une suite de 4.
export function findCarre(cards, J) {
  for (const group of combinations(cards, 4)) if (validGroup(group, J)) return group;
  return null;
}
// « 10 cartes » : au moins dix cartes réparties en combinaisons valides, jokers inclus.
export function tenGroups(cards, J) {
  if (cards.length < 10 || !meldedAtLeast(cards, J, 10)) return null;
  const { grid, wilds } = prep(cards, J);
  const ctx = mkCtx({ milestone: true, maxSkips: cards.length - 10 });
  return solve(grid, wilds, ctx) ? ctx.out.map(x => x.cards).filter(Boolean) : null;
}
export const hasCarre = (cards, J) => !!findCarre(cards, J);
export const hasTen = (cards, J) => !!tenGroups(cards, J);

// « Prime » : une combinaison valide de 4 cartes + une combinaison valide de 3,
// sans chevauchement. Les jokers doivent remplacer une carte réellement manquante.
export function primeGroups(cards, J) {
  if (cards.length < 7) return null;
  for (const four of combinations(cards, 4)) {
    if (!validGroup(four, J)) continue;
    const used = new Set(four.map(c => c.id));
    const rest = cards.filter(c => !used.has(c.id));
    for (const three of combinations(rest, 3)) if (validGroup(three, J)) return [four, three];
  }
  return null;
}
export const hasPrime = (cards, J) => !!primeGroups(cards, J);
const findWinDiscard = (hand, J, rules) => hand.find((c) => !isJoker(c, J) && meldsOf(hand.filter((x) => x.id !== c.id), J, rules));

// Prime « Carré » ou « 10 cartes » : le joueur appuie sur le bouton, le serveur vérifie sa main ; le premier à réussir l'emporte
// (elle sera payée sur le pot en fin de partie). Possible à tout moment de la partie.
export function claim(g, seat, kind) {
  const labels = { carre: "Carré", ten: "10 cartes", prime: "Prime" };
  const label = labels[kind] || kind;
  if (g.winner !== null) fail("La partie est terminée");
  if (!g.opts?.[kind]?.on) fail(`La prime « ${label} » n'est pas activée sur cette table`);
  g.claims ||= { carre: null, ten: null, prime: null };
  if (g.claims[kind] !== null) fail(`La prime « ${label} » est déjà prise`);
  let found = null;
  if (kind === "carre") { const f = findCarre(g.hands[seat], g.joker); found = f && [f]; }
  else if (kind === "ten") found = tenGroups(g.hands[seat], g.joker);
  else if (kind === "prime") found = primeGroups(g.hands[seat], g.joker);
  if (!found) {
    if (kind === "carre") fail("Pas de carré : 4 cartes identiques ou suite de 4 ; le joker doit remplacer une carte manquante");
    else if (kind === "ten") fail("Pas de 10 cartes : 10 cartes en combinaisons valides, joker inclus si bien placé");
    else fail("Pas de Prime : une combinaison valide de 4 cartes et une de 3, joker inclus si bien placé");
  }
  g.claims[kind] = seat;
  (g.claimCards ||= {})[kind] = found;
}

/* ───────── Partie ───────── */
export function newGame(seatIds, cfg) {
  const d = shuffle(mkDeck());
  const hands = seatIds.map(() => d.splice(0, 13));
  const jInd = cfg.rules.joker ? d.pop() : null; // carte retournée : fixe le joker
  return {
    seats: seatIds, hands, stock: d, discards: [], turn: 0, turnNo: 0, phase: "draw",
    joker: jInd ? jokerSpec(jInd) : null, jInd, zTop: 0, exhausted: false,
    opts: cfg.options, claims: { carre: null, ten: null, prime: null }, vote: null, voteDone: false, potMult: 1,
    winner: null, win: null, result: null, drawn: null, deadline: Date.now() + TURN_MS,
  };
}

export function draw(g, seat, from) {
  if (g.winner !== null || g.turn !== seat || g.phase !== "draw") fail("Ce n'est pas ton moment de piocher");
  if (g.vote && !g.vote.done) fail("Le sabot est terminé : attends le vote du ×2");
  let card, entry = null;
  if (from === "discard" && g.discards.length) { entry = g.discards.pop(); card = entry.card; }
  else {
    from = "stock";
    if (!g.stock.length) { // sabot vide : on remélange les cartes jetées
      const keep = g.discards.pop();
      g.stock = shuffle(g.discards.map((d) => d.card));
      g.discards = keep ? [keep] : [];
    }
    card = g.stock.pop();
    if (!card) fail("Plus de cartes à piocher");
    if (!g.stock.length) { // le sabot est vraiment terminé : c'est maintenant (et pas avant) qu'on propose le ×2
      g.exhausted = true;
      if (g.opts?.x2 && !g.voteDone) g.vote = { deadline: Date.now() + VOTE_MS, votes: {}, done: false, accepted: false };
    }
  }
  g.hands[seat].push(card);
  g.phase = "discard";
  g.drawn = { seat, id: card.id, from, entry };
  g.deadline = Date.now() + TURN_MS; // nouveau délai pour décider de la carte à jeter
}

// Remettre : on a pris la carte jetée, on change d'avis → elle retourne sur la table, on peut piocher au sabot
export function undo(g, seat) {
  if (g.winner !== null || g.turn !== seat || g.phase !== "discard" || !g.drawn || g.drawn.from !== "discard" || !g.drawn.entry)
    fail("Tu ne peux remettre que la carte que tu viens de prendre sur la table");
  const h = g.hands[seat];
  const i = h.findIndex((c) => c.id === g.drawn.id);
  if (i < 0) fail("Carte introuvable");
  h.splice(i, 1);
  g.zTop++;
  g.discards.push({ ...g.drawn.entry, z: g.zTop });
  g.phase = "draw";
  g.drawn = null;
}

export function discard(g, seat, id) {
  if (g.winner !== null || g.turn !== seat || g.phase !== "discard") fail("Pioche d'abord, à ton tour");
  const h = g.hands[seat];
  const i = h.findIndex((c) => c.id === id);
  if (i < 0) fail("Carte inconnue");
  if (isJoker(h[i], g.joker)) fail("Un joker ne peut pas être jeté");
  const [card] = h.splice(i, 1);
  const to = (seat + 1) % g.seats.length; // la carte est jetée vers le joueur suivant
  g.zTop++;
  g.discards.push({ card, from: seat, to, u: Math.random(), v: Math.random(), rot: Math.random() * 90 - 45, z: g.zTop });
  g.turn = to; g.phase = "draw"; g.turnNo++; g.drawn = null; g.deadline = Date.now() + TURN_MS;
}

// Rami : 13 cartes en combinaisons après avoir jeté une carte, en respectant les règles de la table
export function rami(g, seat, cfg) {
  if (g.winner !== null || g.turn !== seat || g.phase !== "discard") fail("Fais Rami après avoir pioché, à ton tour");
  const w = findWinDiscard(g.hands[seat], g.joker, cfg.rules);
  if (!w) fail("Pas encore : combinaisons incomplètes, ou règle de la table non respectée");
  const rest = g.hands[seat].filter((c) => c.id !== w.id);
  if (g.vote && !g.vote.done) g.vote.done = true;
  g.winner = seat;
  g.win = { groups: meldsOf(rest, g.joker, cfg.rules).map((x) => x.cards), out: w };
}

// Joueur absent : il pioche au sabot et jette la carte piochée (jamais un joker)
export function autoPlay(g) {
  const seat = g.turn;
  if (g.phase === "draw") draw(g, seat, "stock");
  const hand = g.hands[seat];
  const pick = hand.find((c) => c.id === g.drawn?.id && !isJoker(c, g.joker)) || hand.find((c) => !isJoker(c, g.joker)) || hand[0];
  discard(g, seat, pick.id);
}

// Vue personnalisée : chacun ne voit que sa main
export function viewFor(g, seat, names, avatars = []) {
  return {
    N: g.seats.length, seat, turn: g.turn, turnNo: g.turnNo, phase: g.phase, turnMs: TURN_MS,
    msLeft: Math.max(0, g.deadline - Date.now()),
    hand: g.hands[seat] || [], counts: g.hands.map((h) => h.length), names, avatars,
    stock: g.stock.length, discards: g.discards, joker: g.joker, jInd: g.jInd,
    drawn: g.drawn && g.drawn.seat === seat ? { id: g.drawn.id, from: g.drawn.from } : null,
    exhausted: g.exhausted, claims: g.claims || { carre: null, ten: null }, claimCards: g.claimCards || {}, potMult: g.potMult || 1,
    vote: g.vote ? { done: g.vote.done, accepted: g.vote.accepted, msLeft: Math.max(0, g.vote.deadline - Date.now()), voted: Object.keys(g.vote.votes).length, mine: g.vote.votes[seat] } : null,
    winner: g.winner, win: g.win, result: g.result,
  };
}
