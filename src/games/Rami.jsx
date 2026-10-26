import { useReducer, useEffect, useState, useRef } from "react";
import SoundToggle from "../components/SoundToggle";
import { play as sfx, useWatch } from "../sound";

/* ───────── Données ───────── */
const N = 5; // joueurs, toi compris
export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
// Ordre du tour : Moi → gauche → haut-gauche → haut-droite → droite → Moi (gauche vers la droite)
const NAMES = ["Moi", "Rado", "Faly", "Tojo", "Miora"];
const isRed = (s) => s === 1 || s === 2;
const label = (c) => RANKS[c.r - 1] + SUITS[c.s];

const mkDeck = () => {
  const d = [];
  for (let k = 0; k < 2; k++)
    for (let s = 0; s < 4; s++)
      for (let r = 1; r <= 13; r++) d.push({ id: k * 52 + s * 13 + r - 1, r, s });
  return d; // 104 cartes
};

const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Zones d'atterrissage (en % de la table) devant chaque joueur, et point de départ du lancer
const ZONES = [
  { x: [25, 75], y: [68, 92] }, // 0 moi (bas)
  { x: [6, 32], y: [30, 70] },  // 1 gauche
  { x: [8, 45], y: [6, 30] },   // 2 haut-gauche
  { x: [55, 92], y: [6, 30] },  // 3 haut-droite
  { x: [68, 94], y: [30, 70] }, // 4 droite
];
const SEATS = [[50, 110], [-6, 50], [18, -6], [82, -6], [106, 50]];
// from = joueur qui jette (null = sabot), to = joueur suivant : la carte est jetée vers lui
const toss = (card, z, from, to) => {
  const zn = ZONES[to];
  const x = zn.x[0] + Math.random() * (zn.x[1] - zn.x[0]);
  const y = zn.y[0] + Math.random() * (zn.y[1] - zn.y[0]);
  const [fx, fy] = from === null ? [50, 50] : SEATS[from];
  return { card, x, y, z, fx, fy, rot: Math.random() * 90 - 45 };
};

/* ───────── Joker ─────────
   Après le partage, une carte est retournée : le joker est la même valeur, couleur opposée
   (6 rouge retourné → jokers = les 6 noirs). Un joker remplace n'importe quelle carte. */
const jokerSpec = (c) => ({ r: c.r, suits: isRed(c.s) ? [0, 3] : [1, 2] });
export const isJoker = (c, J) => !!J && c.r === J.r && J.suits.includes(c.s);

/* ───────── Règles : détection de Rami ─────────
   13 cartes toutes en combinaisons : brelan/carré (même valeur, couleurs différentes)
   ou suite de 3+ cartes de même couleur (As bas A-2-3 ou haut Q-K-A). Jokers = cartes joker. */
function solve(grid, wilds, out) {
  let s = -1, r = -1;
  outer: for (let rr = 1; rr <= 13; rr++)
    for (let ss = 0; ss < 4; ss++)
      if (grid[ss][rr].length) { s = ss; r = rr; break outer; }
  if (s < 0) { if (wilds.length) out.push([...wilds]); return true; }

  // brelan / carré (les jokers complètent les couleurs manquantes)
  const others = [0, 1, 2, 3].filter((x) => x !== s && grid[x][r].length);
  for (let m = 0; m < 1 << others.length; m++) {
    const sub = others.filter((_, i) => m & (1 << i));
    const k = 1 + sub.length;
    for (let w = 0; w <= Math.min(wilds.length, 4 - k); w++) {
      if (k + w < 3) continue;
      const got = [grid[s][r].pop(), ...sub.map((x) => grid[x][r].pop())];
      const ws = Array.from({ length: w }, () => wilds.pop());
      const ok = solve(grid, wilds, out);
      grid[s][r].push(got[0]);
      sub.forEach((x, i) => grid[x][r].push(got[i + 1]));
      for (let i = w - 1; i >= 0; i--) wilds.push(ws[i]);
      if (ok) { out.push([...got, ...ws]); return true; }
    }
  }

  // suite : seq = rangs des vraies cartes (>0) ou -1 pour un joker
  const tryRun = (seq) => {
    const reals = seq.filter((j) => j > 0);
    const wn = seq.length - reals.length;
    const got = reals.map((j) => grid[s][j].pop());
    const ws = Array.from({ length: wn }, () => wilds.pop());
    const ok = solve(grid, wilds, out);
    reals.forEach((j, i) => grid[s][j].push(got[i]));
    for (let i = wn - 1; i >= 0; i--) wilds.push(ws[i]);
    if (!ok) return false;
    let a = 0, b = 0;
    out.push(seq.map((j) => (j > 0 ? got[a++] : ws[b++])));
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
  // suite qui finit par l'As haut (…Q-K-A)
  if (r === 1) {
    for (let k = 12; k >= 2; k--) {
      const seq = [];
      for (let j = k; j <= 13; j++) seq.push(grid[s][j].length ? j : -1);
      seq.push(1);
      if (seq.filter((x) => x < 0).length <= wilds.length && tryRun(seq)) return true;
    }
  }
  return false;
}

// Renvoie les groupes (combinaisons) ou null si la main n'est pas gagnante
const meldsOf = (cards, J) => {
  const grid = [0, 1, 2, 3].map(() => Array.from({ length: 14 }, () => []));
  const wilds = [];
  cards.forEach((c) => (isJoker(c, J) ? wilds.push(c) : grid[c.s][c.r].push(c)));
  const out = [];
  return solve(grid, wilds, out) ? out : null;
};
// Avec 14 cartes : existe-t-il une carte à jeter qui laisse 13 cartes en combinaisons ?
const findWinDiscard = (hand, J) => hand.find((c) => !isJoker(c, J) && meldsOf(hand.filter((x) => x.id !== c.id), J));
const buildWin = (hand, w, J) => ({ groups: meldsOf(hand.filter((x) => x.id !== w.id), J), out: w });

/* ───────── IA des bots ───────── */
const dist = (a, b) => Math.min(Math.abs(a - b), Math.abs((a === 1 ? 14 : a) - (b === 1 ? 14 : b)));
const score = (card, hand, J) => {
  if (isJoker(card, J)) return 99;
  let sc = 0;
  const seen = new Set();
  for (const c of hand) {
    if (c.id === card.id) continue;
    if (c.r === card.r && c.s !== card.s && !seen.has(c.s)) { seen.add(c.s); sc += 3; }
    else if (c.s === card.s) {
      const d = dist(c.r, card.r);
      if (d === 1) sc += 3; else if (d === 2) sc += 2; else if (d === 0) sc += 0.3;
    }
  }
  return sc;
};
// Un tour de bot dure entre 5 s et 15 s
const botDur = () => 5000 + Math.random() * 5000; // 5 à 10 s

/* ───────── État ───────── */
const idleGame = () => ({
  stage: "idle", // idle → shuffle → deal → play
  hands: Array.from({ length: N }, () => []),
  stock: [], discards: [], first: null,
  turn: 0, phase: "draw", winner: null, dur: 0, tick: 0, zTop: 0, drawn: null, joker: null, jInd: null, win: null,
  msg: "Appuie sur PLAY pour lancer la partie",
});

const newGame = () => {
  const d = shuffle(mkDeck());
  const hands = [];
  for (let p = 0; p < N; p++) hands.push(d.splice(0, 13));
  const first = d.pop();
  return { ...idleGame(), stage: "shuffle", hands, stock: d, first, msg: "Mélange des 104 cartes…" };
};

const draw = (g, from) => {
  let { stock, discards } = g;
  let card, entry = null;
  if (from === "discard" && discards.length) {
    entry = discards[discards.length - 1];
    card = entry.card;
    discards = discards.slice(0, -1);
  } else {
    if (!stock.length) {
      const keep = discards[discards.length - 1];
      stock = shuffle(discards.slice(0, -1).map((d) => d.card));
      discards = keep ? [keep] : [];
    }
    card = stock[stock.length - 1];
    if (!card) return g;
    stock = stock.slice(0, -1);
  }
  const hands = g.hands.map((h, i) => (i === g.turn ? [...h, card] : h));
  const msg =
    g.turn === 0
      ? `Tu as pioché ${label(card)} (surlignée dans ta main).${entry ? " Tu peux la remettre." : ""} Jette une carte, ou fais Rami !`
      : `${NAMES[g.turn]} pioche ${from === "discard" ? "la carte jetée" : "au sabot"}…`;
  return { ...g, hands, stock, discards, phase: "discard", msg, drawn: g.turn === 0 ? { id: card.id, from: entry ? "discard" : "stock", entry } : null };
};

const discard = (g, id) => {
  const card = g.hands[g.turn].find((c) => c.id === id);
  if (!card) return g;
  const hands = g.hands.map((h, i) => (i === g.turn ? h.filter((c) => c.id !== id) : h));
  const next = (g.turn + 1) % N;
  const who = g.turn === 0 ? "Tu as" : `${NAMES[g.turn]} a`;
  return {
    ...g, hands,
    discards: [...g.discards, toss(card, g.zTop + 1, g.turn, next)],
    zTop: g.zTop + 1, turn: next, phase: "draw", tick: g.tick + 1, drawn: null,
    dur: next === 0 ? 0 : botDur(),
    msg: `${who} jeté ${label(card)}. ${next === 0 ? "À toi !" : `Tour de ${NAMES[next]}`}`,
  };
};

function reducer(g, a) {
  const play = g.stage === "play" && g.winner === null;
  switch (a.type) {
    case "START": return newGame();
    case "STAGE": return { ...g, stage: a.stage, msg: "Distribution : 13 cartes chacun…" };
    case "BEGIN": { // la carte retournée fixe le joker
      const J = jokerSpec(g.first);
      return {
        ...g, stage: "play", jInd: g.first, first: null, joker: J, discards: [], zTop: 0,
        turn: 0, phase: "draw",
        msg: `Joker : les ${RANKS[J.r - 1]} ${isRed(g.first.s) ? "noirs" : "rouges"} (${SUITS[J.suits[0]]} ${SUITS[J.suits[1]]}). À toi : pioche le sabot !`,
      };
    }
    case "UNDO": { // remettre la carte prise sur la table, puis piocher ailleurs
      if (!(play && g.turn === 0 && g.phase === "discard" && g.drawn && g.drawn.from === "discard")) return g;
      return {
        ...g, phase: "draw", drawn: null, zTop: g.zTop + 1,
        hands: g.hands.map((h, i) => (i === 0 ? h.filter((c) => c.id !== g.drawn.id) : h)),
        discards: [...g.discards, { ...g.drawn.entry, z: g.zTop + 1 }],
        msg: "Carte remise sur la table : pioche dans le sabot (ou reprends-la).",
      };
    }
    case "DRAW":
      return play && g.turn === 0 && g.phase === "draw" ? draw(g, a.from) : g;
    case "DISCARD": {
      if (!(play && g.turn === 0 && g.phase === "discard")) return g;
      const c = g.hands[0].find((x) => x.id === a.id);
      if (c && isJoker(c, g.joker)) return { ...g, msg: "Un joker ne peut pas être jeté" };
      return discard(g, a.id);
    }
    case "RAMI":
      if (!(play && g.turn === 0 && g.phase === "discard")) return g;
    {
      const w = findWinDiscard(g.hands[0], g.joker);
      if (!w) return { ...g, msg: "Pas encore : il faut des brelans/carrés ou des suites de 3+ avec toutes tes cartes (jokers inclus)." };
      return { ...g, winner: 0, win: buildWin(g.hands[0], w, g.joker), msg: "Rami ! Tu as gagné 🎉" };
    }
    case "SORT": {
      const f = a.mode === "suit" ? (x, y) => x.s - y.s || x.r - y.r : (x, y) => x.r - y.r || x.s - y.s;
      return { ...g, hands: g.hands.map((h, i) => (i === 0 ? [...h].sort(f) : h)) };
    }
    case "REORDER": {
      const h = [...g.hands[0]];
      const from = h.findIndex((c) => c.id === a.id), to = h.findIndex((c) => c.id === a.over);
      if (from < 0 || to < 0) return g;
      h.splice(to, 0, h.splice(from, 1)[0]);
      return { ...g, hands: g.hands.map((x, i) => (i === 0 ? h : x)) };
    }
    case "RAISE": // amène la carte au premier plan
      return { ...g, zTop: g.zTop + 1, discards: g.discards.map((d) => (d.card.id === a.id ? { ...d, z: g.zTop + 1 } : d)) };
    case "MOVE": // glisse une carte sur la table
      return { ...g, discards: g.discards.map((d) => (d.card.id === a.id ? { ...d, x: a.x, y: a.y } : d)) };
    case "BOT_DRAW": {
      if (!play || g.turn === 0 || g.phase !== "draw") return g;
      const top = g.discards[g.discards.length - 1];
      return draw(g, top && score(top.card, g.hands[g.turn], g.joker) >= 4 ? "discard" : "stock");
    }
    case "BOT_DISCARD": {
      if (!play || g.turn === 0 || g.phase !== "discard") return g;
      const h = g.hands[g.turn];
      const w = findWinDiscard(h, g.joker);
      if (w) return { ...g, winner: g.turn, win: buildWin(h, w, g.joker), msg: `${NAMES[g.turn]} a fait Rami !` };
      const pool = h.filter((c) => !isJoker(c, g.joker)); // un bot garde ses jokers
      const worst = [...pool].sort((x, y) => score(x, h, g.joker) + Math.random() * 0.5 - (score(y, h, g.joker) + Math.random() * 0.5))[0];
      return discard(g, worst.id);
    }
    default: return g;
  }
}

/* ───────── Composants ───────── */
export function Card({ c, sm, sel, className = "", ...rest }) {
  return (
    <div className={`c ${sm ? "sm" : ""} ${isRed(c.s) ? "red" : ""} ${sel ? "sel" : ""} ${className}`} {...rest}>
      <b>{RANKS[c.r - 1]}</b>
      <i>{SUITS[c.s]}</i>
    </div>
  );
}

export function Opp({ i, name, n, active, dur, tick, avatar, horizontal = false }) {
  return (
    <div className={`opp ${active ? "turn" : ""}`}>
      <span className="nm">{avatar ? <img className="opp-av" src={avatar} alt="" /> : null}{name} · {n}</span>
      <div className={`backs ${horizontal ? "backs-horizontal" : ""} ${horizontal ? "backs-445" : ""}`}>
        {horizontal ? [n >= 1 ? 4 : 0, n >= 5 ? 4 : 0, n >= 9 ? n - 8 : 0].map((count, row) => (
          count > 0 && <div className="backs-row" key={row}>{Array.from({ length: Math.min(count, 5) }).map((_, j) => {
            const k = row === 0 ? j : row === 1 ? j + 4 : j + 8;
            return <span key={k} className="bk pop" style={{ transform: `rotate(${((k * 3 + i * 2) % 7) - 3}deg)` }} />;
          })}</div>
        )) : Array.from({ length: n }).map((_, k) => (
          <span key={k} className="bk pop" style={{ transform: `rotate(${((k * 37 + i * 11) % 15) - 7}deg) translate(${((k * 13 + i) % 3) - 1}px, ${((k * 7 + i) % 3) - 1}px)` }} />
        ))}
      </div>
      {active && dur > 0 && <span className="prog" key={tick} style={{ animationDuration: `${dur}ms` }} />}
    </div>
  );
}

export default function Rami({ onExit }) {
  const [g, dispatch] = useReducer(reducer, null, idleGame);
  const [sel, setSel] = useState(null);
  const [sortMode, setSortMode] = useState("suit");
  const [dealt, setDealt] = useState(0);
  const tableRef = useRef(null);
  const drag = useRef(null);
  const hd = useRef(null);
  const [ghost, setGhost] = useState(null);

  // 1) mélange visible, 2) distribution carte par carte, 3) début de partie
  useEffect(() => {
    if (g.stage !== "shuffle") return;
    const t = setTimeout(() => dispatch({ type: "STAGE", stage: "deal" }), 2600);
    return () => clearTimeout(t);
  }, [g.stage]);
  useEffect(() => {
    if (g.stage !== "deal") return;
    const t = setInterval(() => setDealt((d) => Math.min(d + 1, N * 13 + 3)), 80);
    return () => clearInterval(t);
  }, [g.stage]);
  useEffect(() => {
    if (g.stage !== "deal" || dealt < N * 13 + 3) return;
    const t = setTimeout(() => dispatch({ type: "BEGIN" }), 600);
    return () => clearTimeout(t);
  }, [g.stage, dealt]);

  // Tour des bots : durée totale aléatoire 5–15 s (pioche vers 45 %, défausse à la fin)
  useEffect(() => {
    if (g.stage !== "play" || g.winner !== null || g.turn === 0) return;
    const drawAt = Math.max(2500, g.dur * 0.45);
    const t = setTimeout(
      () => dispatch({ type: g.phase === "draw" ? "BOT_DRAW" : "BOT_DISCARD" }),
      g.phase === "draw" ? drawAt : g.dur - drawAt
    );
    return () => clearTimeout(t);
  }, [g.stage, g.turn, g.phase, g.winner, g.dur]);

  const play = g.stage === "play" && g.winner === null;
  const myDraw = play && g.turn === 0 && g.phase === "draw";
  const myDiscard = play && g.turn === 0 && g.phase === "discard";

  /* ── sons ── */
  useWatch(g.stage, (s) => s === "shuffle" && sfx("shuffle"));
  useWatch(Math.floor(dealt / 3), (n) => n > 0 && g.stage === "deal" && sfx("card"));
  useWatch(g.stock.length, (n, p) => n < p && g.stage === "play" && sfx("draw"));
  useWatch(g.discards.length, (n, p) => g.stage === "play" && sfx(n > p ? "discard" : "draw"));
  useWatch(myDraw, (n) => n && sfx("turn"));
  useWatch(g.winner, (w) => w !== null && w !== undefined && sfx(w === 0 ? "win" : "lose"));

  const landed = Math.min(N * 13, Math.max(0, dealt - 3));
  const cnt = (p) => (g.stage === "play" ? g.hands[p].length : g.stage === "deal" ? Math.floor((landed + N - 1 - p) / N) : 0);
  const myCards = g.stage === "play" ? g.hands[0] : g.hands[0].slice(0, cnt(0));
  const stockCount = g.stage === "deal" ? 104 - Math.min(N * 13, dealt) : g.stage === "play" ? g.stock.length : 104;

  const start = () => { setSel(null); setDealt(0); dispatch({ type: "START" }); };
  const doDiscard = () => { if (myDiscard && sel !== null) { dispatch({ type: "DISCARD", id: sel }); setSel(null); } };
  const doSort = () => { dispatch({ type: "SORT", mode: sortMode }); setSortMode(sortMode === "suit" ? "rank" : "suit"); };

  // Glisser une carte de la table (un simple toucher sur la dernière carte = la piocher)
  const onDown = (e, d) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: d.card.id, sx: e.clientX, sy: e.clientY, ox: d.x, oy: d.y, moved: false, rect: tableRef.current.getBoundingClientRect() };
    dispatch({ type: "RAISE", id: d.card.id });
  };
  const onMove = (e) => {
    const k = drag.current;
    if (!k) return;
    const dx = e.clientX - k.sx, dy = e.clientY - k.sy;
    if (!k.moved && Math.hypot(dx, dy) < 6) return;
    k.moved = true;
    const x = Math.min(96, Math.max(4, k.ox + (dx / k.rect.width) * 100));
    const y = Math.min(96, Math.max(4, k.oy + (dy / k.rect.height) * 100));
    dispatch({ type: "MOVE", id: k.id, x, y });
  };
  const onUp = (isTop) => {
    const k = drag.current;
    drag.current = null;
    if (k && !k.moved && isTop && myDraw) dispatch({ type: "DRAW", from: "discard" });
  };

  // Main : toucher = sélectionner, glisser = échanger la carte de place
  const hDown = (e) => {
    if (g.stage !== "play") return;
    const el = e.target.closest("[data-id]");
    if (!el) return;
    hd.current = { id: +el.dataset.id, sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const hMove = (e) => {
    const k = hd.current;
    if (!k) return;
    if (!k.moved && Math.hypot(e.clientX - k.sx, e.clientY - k.sy) < 6) return;
    k.moved = true;
    setGhost({ id: k.id, x: e.clientX, y: e.clientY });
    const over = [...e.currentTarget.querySelectorAll("[data-id]")].find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
    });
    if (over && +over.dataset.id !== k.id) dispatch({ type: "REORDER", id: k.id, over: +over.dataset.id });
  };
  const hUp = () => {
    const k = hd.current;
    hd.current = null;
    setGhost(null);
    if (k && !k.moved) setSel((s) => (s === k.id ? null : k.id));
  };

  const drawnCard = g.drawn && g.hands[0].find((c) => c.id === g.drawn.id);

  const flying = g.stage === "deal"
    ? [0, 1, 2, 3].map((k) => dealt - 1 - k).filter((i) => i >= 0 && i < N * 13)
    : [];

  return (
    <div className="app">
      <style>{css}</style>

      <div className="board">
        <div className="top">
          <Opp i={2} name={NAMES[2]} n={cnt(2)} active={play && g.turn === 2} dur={g.dur} tick={g.tick} />
          <Opp i={3} name={NAMES[3]} n={cnt(3)} active={play && g.turn === 3} dur={g.dur} tick={g.tick} />
        </div>
        <div className="left"><Opp i={1} name={NAMES[1]} n={cnt(1)} active={play && g.turn === 1} dur={g.dur} tick={g.tick} /></div>

        <div className="table" ref={tableRef}>
          {g.discards.map((d, i) => {
            const isTop = i === g.discards.length - 1;
            return (
              <Card key={d.card.id} c={d.card} sm
                className={`toss ${isTop ? "last" : ""} ${isTop && myDraw ? "grab" : ""} ${isJoker(d.card, g.joker) ? "jk" : ""}`}
                style={{ left: `${d.x}%`, top: `${d.y}%`, "--r": `${d.rot}deg`, "--fx": `${d.fx}%`, "--fy": `${d.fy}%`, zIndex: 10 + d.z }}
                onPointerDown={(e) => onDown(e, d)} onPointerMove={onMove}
                onPointerUp={() => onUp(isTop)} onPointerCancel={() => (drag.current = null)} />
            );
          })}

          {g.joker && g.stage === "play" && (
            <div className="jbadge">JOKER
              <Card sm c={{ r: g.joker.r, s: g.joker.suits[0] }} className="jk" />
              <Card sm c={{ r: g.joker.r, s: g.joker.suits[1] }} className="jk" />
            </div>
          )}

          {g.stage === "shuffle" ? (
            <div className="shuf">
              {Array.from({ length: 7 }).map((_, k) => (
                <span key={k} className="bk big sh" style={{ animationDelay: `${k * 0.11}s`, animationDirection: k % 2 ? "reverse" : "normal" }} />
              ))}
            </div>
          ) : (
            <div className={`sabot ${myDraw ? "grab" : ""}`} onClick={myDraw ? () => dispatch({ type: "DRAW", from: "stock" }) : undefined}>
              <span className="bk big" /><span className="bk big l2" />
              <span className="cnt">{stockCount}</span>
            </div>
          )}

          {g.jInd && g.stage === "play" && <Card key="jind" c={g.jInd} className="reveal rj" />}
          {drawnCard && <Card key={g.tick} c={drawnCard} className="reveal" />}
          {flying.map((i) => <span key={i} className={`bk fly s${i % N}`} />)}
        </div>

        <div className="right"><Opp i={4} name={NAMES[4]} n={cnt(4)} active={play && g.turn === 4} dur={g.dur} tick={g.tick} /></div>
      </div>

      <div className="msg">{g.msg}</div>

      <div className="bar">
        {onExit && (
          <button onClick={() => (g.stage === "idle" || g.winner !== null || window.confirm("Quitter la partie en cours ?")) && onExit()}>
            ← Quitter
          </button>
        )}
        <SoundToggle />
        <button disabled={!play} onClick={doSort}>Trier {sortMode === "suit" ? "♠♥♦♣" : "A→K"}</button>
        {myDiscard && g.drawn && g.drawn.from === "discard" && (
          <button onClick={() => dispatch({ type: "UNDO" })}>Remettre</button>
        )}
        <button disabled={!myDiscard} onClick={() => dispatch({ type: "RAMI" })}>Rami !</button>
        <button className="go" disabled={!myDiscard || sel === null} onClick={doDiscard}>Jeter</button>
      </div>

      <div className={`hand ${myDraw || myDiscard ? "turn" : ""}`}
        onPointerDown={hDown} onPointerMove={hMove} onPointerUp={hUp} onPointerCancel={hUp}>
        {myCards.map((c) => (
          <Card key={c.id} data-id={c.id} c={c} sel={sel === c.id}
            className={`${g.stage === "deal" ? "pop" : ""} ${ghost && ghost.id === c.id ? "ph" : ""} ${g.drawn && g.drawn.id === c.id ? "new" : ""} ${isJoker(c, g.joker) ? "jk" : ""}`} />
        ))}
      </div>
      {ghost && g.hands[0].find((c) => c.id === ghost.id) && (
        <Card c={g.hands[0].find((c) => c.id === ghost.id)} className="ghost" style={{ left: ghost.x - 19, top: ghost.y - 19 }} />
      )}

      {g.stage === "idle" && (
        <div className="ov">
          <div className="box">
            <h1>Rami</h1>
            <p className="sub">5 joueurs · 13 cartes · 2 jeux de 52</p>
            <button className="go big" onClick={start}>PLAY</button>
          </div>
        </div>
      )}
      {g.winner !== null && (
        <div className="ov">
          <div className="box wide">
            <p>{g.msg}</p>
            {g.win && (
              <>
                <div className="groups">
                  {g.win.groups.map((grp, i) => (
                    <div key={i} className="grp">
                      {grp.map((c) => <Card key={c.id} sm c={c} className={isJoker(c, g.joker) ? "jk" : ""} />)}
                    </div>
                  ))}
                </div>
                <div className="thrown">Carte jetée : <Card sm c={g.win.out} /></div>
              </>
            )}
            <button className="go big" onClick={start}>Rejouer</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Styles ───────── */
export const css = `
html,body,#root{margin:0;height:100%;background:#052a18}
.app{position:relative;height:100dvh;max-width:430px;margin:0 auto;display:flex;flex-direction:column;
  background:radial-gradient(ellipse at 50% 45%,#12804a 0%,#0a5a33 60%,#073d23 100%);
  color:#eafff2;font-family:system-ui,-apple-system,sans-serif;user-select:none;-webkit-user-select:none;overflow:hidden;
  -webkit-tap-highlight-color:transparent}
.board{flex:1;min-height:0;display:grid;grid-template-columns:64px 1fr 64px;grid-template-rows:auto 1fr}
.top{grid-column:1/4;display:flex;justify-content:space-around;padding:8px 14px 2px}
.left,.right{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:6px 0}
.table{position:relative;min-height:0}

.opp-av{width:18px;height:18px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px;border:1px solid #fff5}
.opp{display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px 4px;border-radius:8px;border:1px solid transparent}
.opp.turn{border-color:#ffd54a;background:#ffd54a22;box-shadow:0 0 10px #ffd54a66}
.nm{font-size:10px;font-weight:600;white-space:nowrap}
.backs{display:flex;flex-wrap:wrap;gap:2px;justify-content:center;max-width:52px;min-height:11px}
.top .backs{max-width:96px}
.backs-horizontal{display:flex;flex-direction:column;flex-wrap:nowrap;align-items:center;max-width:none;min-height:0;gap:2px}
.backs-row{display:flex;justify-content:center;gap:2px;height:13px}
.backs-horizontal .bk{flex:0 0 11px;width:11px;height:13px}
.backs-445 .bk{border-radius:3px}
@media(max-width:480px){.top .backs-horizontal{max-width:none}.opp:has(.backs-horizontal){padding:3px 2px;gap:3px}.backs-row{height:11px;gap:1px}.backs-horizontal .bk{width:9px;height:11px;flex-basis:9px}}
.prog{display:block;width:100%;height:3px;background:#ffd54a;border-radius:2px;transform-origin:left;animation:fill linear forwards}
@keyframes fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.bk{display:block;width:11px;height:11px;border-radius:2px;border:1px solid #ffffffaa;box-sizing:border-box;
  background:repeating-linear-gradient(45deg,#2f52d8 0 2px,#1b2f96 2px 4px)}
.pop{animation:pop .25s ease-out}
@keyframes pop{from{opacity:0;scale:.3}}

.c{width:38px;height:38px;box-sizing:border-box;background:#fffdf6;color:#14161c;border-radius:6px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;
  box-shadow:0 1px 3px #0007;font-size:14px;transition:transform .12s}
.c b{font-weight:800}
.c i{font-style:normal;font-size:17px;margin-top:1px}
.c.red{color:#d3152b}
.c.sm{width:28px;height:28px;font-size:10px;border-radius:5px}
.c.sm i{font-size:12px}
.c.sel{transform:translateY(-7px);outline:2px solid #ffd54a}

.toss{position:absolute;transform:translate(-50%,-50%) rotate(var(--r));animation:drop .5s ease-out;touch-action:none;cursor:grab}
.toss.last{outline:2px solid #ffd54a;outline-offset:1px}
.toss.grab::after{content:"";position:absolute;inset:-4px;border:2px solid #ffd54a;border-radius:8px;animation:ring 1s ease-out infinite}
@keyframes drop{from{left:var(--fx);top:var(--fy);transform:translate(-50%,-50%) rotate(calc(var(--r) + 200deg)) scale(1.4);opacity:.5}}
@keyframes ring{from{opacity:1;transform:scale(.9)}to{opacity:0;transform:scale(1.5)}}

.sabot{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:34px;z-index:100000}
.bk.big{position:absolute;width:32px;height:32px;border-radius:5px;left:0;top:0;border-width:2px}
.bk.big.l2{left:2px;top:2px}
.cnt{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:12px;font-weight:800;
  color:#fff;text-shadow:0 1px 2px #000;z-index:2;padding-left:2px}
.sabot.grab .bk.big{animation:glow 1.1s ease-in-out infinite}
@keyframes glow{50%{box-shadow:0 0 0 5px #ffd54a99}}

.shuf{position:absolute;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);z-index:100000}
.bk.sh{animation:shuf .55s ease-in-out infinite}
@keyframes shuf{0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(-34px,-8px) rotate(-14deg)}75%{transform:translate(34px,-6px) rotate(14deg)}}

.fly{position:absolute;left:50%;top:50%;width:18px;height:18px;z-index:100001;animation:fly .3s ease-in forwards}
@keyframes fly{from{transform:translate(-50%,-50%)}to{transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(.6);opacity:.3}}
.s0{--tx:0px;--ty:40dvh}
.s1{--tx:calc(min(100vw,430px) * -.42);--ty:0px}
.s2{--tx:calc(min(100vw,430px) * -.2);--ty:-34dvh}
.s3{--tx:calc(min(100vw,430px) * .2);--ty:-34dvh}
.s4{--tx:calc(min(100vw,430px) * .42);--ty:0px}

.msg{min-height:34px;padding:4px 12px;font-size:12px;text-align:center;display:flex;align-items:center;justify-content:center;background:#00000030}
.bar{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:6px 8px}
.bar button{font-size:12px;padding:7px 10px}
button{font:inherit;font-size:13px;font-weight:700;color:#eafff2;background:#ffffff1f;border:1px solid #ffffff55;border-radius:999px;padding:7px 13px}
button:disabled{opacity:.35}
button.go{background:#ffd54a;color:#2b2200;border-color:#ffd54a}
button.big{font-size:20px;padding:12px 44px;letter-spacing:2px}
.hand{display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:5px;padding:12px 8px 18px;min-height:92px;border-top:2px solid transparent}
.hand{touch-action:none}
.hand.grouped{gap:10px;row-gap:8px}
.hand-group{display:flex;gap:4px;padding:0 6px;border-right:1px solid rgba(255,255,255,0.18)}
.hand-group:last-child{border-right:0}
.c.jk{background:linear-gradient(135deg,#fffdf6 45%,#ffd95a);box-shadow:0 0 0 1.5px #f2b705,0 1px 3px #0007}
.jbadge{position:absolute;top:3px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:3px 6px;
  border-radius:8px;background:#00000045;border:1px solid #f2b70599;z-index:5;pointer-events:none;font-size:9px;font-weight:800;color:#ffd54a;letter-spacing:.5px}
.c.reveal.rj{animation:revealJ 2.8s ease-in-out forwards}
@keyframes revealJ{0%{transform:translate(-50%,-50%) scale(.3) rotate(-12deg);opacity:0}14%{transform:translate(-50%,-50%) scale(1.9);opacity:1}
  78%{transform:translate(-50%,-50%) scale(1.9);opacity:1}100%{transform:translate(-50%,calc(-50% - 22dvh)) scale(.5);opacity:0}}
.box.wide{max-width:92%;max-height:88dvh;overflow:auto;padding:18px 14px}
.groups{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:12px}
.grp{display:flex;gap:2px;padding:4px;background:#0000004d;border-radius:8px}
.thrown{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;margin-bottom:14px}
.c.ph{opacity:.25}
.c.new{box-shadow:0 0 0 2px #5ee7ff,0 0 12px #5ee7ffcc;animation:newc .9s ease-in-out infinite alternate}
@keyframes newc{to{box-shadow:0 0 0 2px #5ee7ff,0 0 3px #5ee7ff88}}
.c.reveal{position:absolute;left:50%;top:50%;width:56px;height:56px;font-size:22px;border-radius:9px;pointer-events:none;z-index:150000;
  box-shadow:0 8px 22px #000a;animation:reveal 1.7s ease-in-out forwards}
.c.reveal i{font-size:28px}
@keyframes reveal{0%{transform:translate(-50%,-50%) scale(.3) rotate(-12deg);opacity:0}
  18%{transform:translate(-50%,-50%) scale(1.9);opacity:1}68%{transform:translate(-50%,-50%) scale(1.9);opacity:1}
  100%{transform:translate(-50%,calc(-50% + 40dvh)) scale(.6);opacity:0}}
.c.ghost{position:fixed;z-index:300000;pointer-events:none;transform:scale(1.15) rotate(-5deg);box-shadow:0 6px 14px #0009}
.hand.turn{border-top-color:#ffd54a}
.ov{position:absolute;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:200000}
.box{background:#0b3d24;border:2px solid #ffd54a;border-radius:14px;padding:24px 30px;text-align:center}
.box h1{margin:0 0 4px;font-size:44px;letter-spacing:3px}
.box .sub{margin:0 0 18px;font-size:13px;opacity:.85;font-weight:400}
.box p{margin:0 0 16px;font-size:17px;font-weight:700}
`;
