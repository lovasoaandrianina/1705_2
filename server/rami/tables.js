import { Router } from "express";
import { db } from "../db.js";
import { registerChecker, closeRoom } from "../chat.js";
import { requireAuth, wrap } from "../auth.js";
import { adjust, HttpError } from "./money.js";
import * as E from "./engine.js";
import * as rami from "./game.js";
import * as domino from "../domino/game.js";

const GAMES = { rami, domino };
const gameOf = (v) => (v === "domino" ? "domino" : "rami");
const bad = (m, c = 400) => new HttpError(c, m);

// Commission de la plateforme, en points de base (350 = 3,5 %), prélevée sur le GAIN NET de chaque joueur (reçu du pot − sa mise)
const envBps = process.env.FEE_BPS;
export const FEE_BPS = Math.min(2000, Math.max(0, envBps !== undefined && envBps !== "" && Number.isFinite(Number(envBps)) ? Math.round(Number(envBps)) : 350));
const pctText = (bps) => String(bps / 100).replace(".", ",");
const WAITLIST_MAX = 10;

async function inTx(fn) {
  const tx = await db.transaction("write");
  try { const out = await fn(tx); await tx.commit(); return out; }
  catch (e) { try { await tx.rollback(); } catch { /* déjà annulée */ } throw e; }
  finally { tx.close(); }
}

const norm = (t) => ({ id: Number(t.id), game: gameOf(t.game), creator_id: Number(t.creator_id), stake: Number(t.stake), max_players: Number(t.max_players), status: t.status, config: JSON.parse(t.config), state: t.state });
async function loadTable(id, c = db) {
  const t = (await c.execute({ sql: "SELECT * FROM game_tables WHERE id = ?", args: [id] })).rows[0];
  if (!t) throw bad("Table introuvable", 404);
  return norm(t);
}
async function players(id, c = db) {
  const r = await c.execute({
    sql: "SELECT tp.user_id, tp.locked, u.pseudo, u.avatar FROM table_players tp JOIN users u ON u.id = tp.user_id WHERE tp.table_id = ? ORDER BY tp.rowid",
    args: [id],
  });
  return r.rows.map((p) => ({ user_id: Number(p.user_id), locked: Number(p.locked), pseudo: p.pseudo, avatar: p.avatar || null }));
}
const myActive = async (uid, c = db) =>
  (await c.execute({
    sql: `SELECT t.id, t.game FROM table_players tp JOIN game_tables t ON t.id = tp.table_id
          WHERE tp.user_id = ? AND t.status IN ('waiting','playing') LIMIT 1`,
    args: [uid],
  })).rows[0];
const myQueue = async (uid, c = db) => {
  const q = (await c.execute({
    sql: "SELECT w.table_id, t.game FROM table_waitlist w JOIN game_tables t ON t.id = w.table_id WHERE w.user_id = ? LIMIT 1", args: [uid],
  })).rows[0];
  if (!q) return null;
  const pos = (await c.execute({
    sql: "SELECT COUNT(*) n FROM table_waitlist WHERE table_id = ? AND rowid <= (SELECT rowid FROM table_waitlist WHERE table_id = ? AND user_id = ?)",
    args: [q.table_id, q.table_id, uid],
  })).rows[0];
  return { table_id: Number(q.table_id), game: gameOf(q.game), position: Number(pos.n) };
};
const waitCount = async (id, c = db) => Number((await c.execute({ sql: "SELECT COUNT(*) n FROM table_waitlist WHERE table_id = ?", args: [id] })).rows[0].n);

// Une place se libère : le premier de la liste d'attente qui peut payer la mise est assis automatiquement
async function promote(tx, t) {
  for (;;) {
    if ((await players(t.id, tx)).length >= t.max_players) return;
    const w = (await tx.execute({ sql: "SELECT user_id FROM table_waitlist WHERE table_id = ? ORDER BY rowid LIMIT 1", args: [t.id] })).rows[0];
    if (!w) return;
    const uid = Number(w.user_id);
    await tx.execute({ sql: "DELETE FROM table_waitlist WHERE table_id = ? AND user_id = ?", args: [t.id, uid] });
    const b = (await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [uid] })).rows[0];
    if (Number(b.balance) < t.stake || (await myActive(uid, tx))) continue; // ne peut pas payer / déjà ailleurs : au suivant
    await adjust(tx, uid, -t.stake, "bet", `Table #${t.id} (liste d'attente)`);
    await tx.execute({ sql: "INSERT INTO table_players (table_id, user_id, locked) VALUES (?, ?, ?)", args: [t.id, uid, t.stake] });
  }
}

/* ── Parties en cours : cache mémoire + sauvegarde dans Turso à chaque coup ── */
const cache = new Map(); // id → { g, t }
const locks = new Map();
const withLock = (id, fn) => {
  const run = (locks.get(id) || Promise.resolve()).catch(() => {}).then(fn);
  locks.set(id, run.catch(() => {}));
  return run;
};
const entryOf = (t) => {
  if (!cache.has(t.id)) cache.set(t.id, { g: JSON.parse(t.state), t: { id: t.id, game: t.game, stake: t.stake, config: t.config } });
  return cache.get(t.id);
};

/* ── Règlement : le jeu décide de la répartition du pot (plan) ; la commission est ensuite prélevée sur le GAIN NET de chaque joueur
      (reçu du pot moins sa propre mise), détaillée dans son historique et sur l'écran de fin. ── */
async function settle(t, g) {
  await inTx(async (tx) => {
    const ps = await players(t.id, tx);
    const locked = g.seats.map((id) => ps.find((p) => p.user_id === id)?.locked || 0);
    const plan = GAMES[t.game].plan(t, g, locked);
    const paid = plan.paid;
    const fees = paid.map((p, i) => (p - locked[i] > 0 ? Math.round(((p - locked[i]) * FEE_BPS) / 10000) : 0));
    g.result = { pot: plan.pot, winnerAmount: plan.winnerAmount, bonus: plan.bonus, staked: locked, paid, fees, feeBps: FEE_BPS };
    const up = await tx.execute({
      sql: "UPDATE game_tables SET status = 'finished', state = ? WHERE id = ? AND status = 'playing'",
      args: [JSON.stringify(g), t.id],
    });
    if (!up.rowsAffected) return; // déjà réglée
    for (const b of plan.bonus) await adjust(tx, g.seats[b.seat], b.amount, "win", `Table #${t.id} : prime ${b.label}`);
    await adjust(tx, g.seats[g.winner], plan.winnerAmount, "win", `Table #${t.id} : pot`);
    for (let i = 0; i < g.seats.length; i++) {
      if (!fees[i]) continue;
      const base = paid[i] - locked[i];
      await adjust(tx, g.seats[i], -fees[i], "fee", `Table #${t.id} : commission ${pctText(FEE_BPS)} % sur ${base} Ar de gain net`);
      await tx.execute({
        sql: "INSERT INTO platform_fees (table_id, user_id, base, rate_bps, amount) VALUES (?, ?, ?, ?, ?)",
        args: [t.id, g.seats[i], base, FEE_BPS, fees[i]],
      });
    }
  });
}

/* ── Rami : vote du ×2, proposé une seule fois quand le sabot est vraiment terminé. Il faut l'accord de tous ;
      chacun ajoute alors une mise au pot (débitée à ce moment-là, jamais avant). ── */
async function resolveVote(e) {
  const g = e.g, v = g.vote, N = g.seats.length;
  const allYes = Object.keys(v.votes).length === N && Object.values(v.votes).every(Boolean); // sans réponse = non
  if (allYes) {
    try {
      await inTx(async (tx) => {
        for (const uid of g.seats) await adjust(tx, uid, -e.t.stake, "bet", `Table #${e.t.id} : mise ×2`);
        await tx.execute({ sql: "UPDATE table_players SET locked = locked + ? WHERE table_id = ?", args: [e.t.stake, e.t.id] });
      });
      v.accepted = true;
      g.potMult = 2;
    } catch { v.accepted = false; } // un solde insuffisant : rien n'est débité
  }
  v.done = true;
  g.voteDone = true;
  g.deadline = Date.now() + E.TURN_MS; // la partie reprend
}
async function castVote(e, seat, accept, uid) {
  const v = e.g.vote;
  if (!v || v.done) throw bad("Aucun vote en cours");
  if (accept) {
    const b = (await db.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [uid] })).rows[0];
    if (Number(b.balance) < e.t.stake) throw bad("Solde insuffisant pour doubler la mise : tu peux refuser");
  }
  v.votes[seat] = accept;
  if (Object.keys(v.votes).length === e.g.seats.length) await resolveVote(e);
}

async function persist(e) {
  if (e.g.winner === null) await db.execute({ sql: "UPDATE game_tables SET state = ? WHERE id = ?", args: [JSON.stringify(e.g), e.t.id] });
  else { await settle(e.t, e.g); cache.delete(e.t.id); closeRoom("table", e.t.id); } // partie finie : le chat disparaît
}

// Chat : seuls les joueurs d'une table en attente ou en cours y ont accès
registerChecker("table", async (uid, id) => (await db.execute({
  sql: "SELECT 1 FROM table_players tp JOIN game_tables t ON t.id = tp.table_id WHERE tp.table_id = ? AND tp.user_id = ? AND t.status IN ('waiting','playing')",
  args: [id, uid],
})).rows.length > 0);

export async function startSweeper() {
  const rows = (await db.execute("SELECT * FROM game_tables WHERE status = 'playing'")).rows;
  rows.forEach((r) => entryOf(norm(r)));
  // Redémarrage / réveil du serveur : on redonne 25 s de réflexion à celui dont c'est le tour (la coupure n'est pas sa faute)
  for (const e of cache.values()) if (typeof e.g.deadline === "number") e.g.deadline = Math.max(e.g.deadline, Date.now() + 25000);
  setInterval(() => {
    for (const [id, e] of cache)
      withLock(id, async () => {
        if (!cache.has(id)) return;
        const g = e.g;
        if (g.winner !== null) return persist(e); // règlement à refaire
        if (g.vote && !g.vote.done) { // vote du ×2 en cours : la partie attend
          if (Date.now() > g.vote.deadline) { await resolveVote(e); await persist(e); }
          return;
        }
        if (GAMES[e.t.game].tick(g)) await persist(e); // joueur absent, manche suivante…
      }).catch((err) => console.error("sweeper", err.message));
  }, 1000);
}

const fullView = (t, g, uid, ps) => ({
  id: t.id, kind: t.game, status: t.status, stake: t.stake, maxPlayers: t.max_players, config: t.config,
  creatorId: t.creator_id, escrow: t.stake, pot: ps.reduce((s, p) => s + p.locked, 0), feeBps: FEE_BPS,
  players: ps.map((p) => ({ userId: p.user_id, pseudo: p.pseudo })),
  game: g ? GAMES[t.game].view(g, g.seats.indexOf(uid), g.seats.map((id) => ps.find((p) => p.user_id === id)?.pseudo || "?"), g.seats.map((id) => ps.find((p) => p.user_id === id)?.avatar || null)) : null,
});

/* ── Routes ── */
const r = Router();
r.use(requireAuth);

r.get("/", wrap(async (req, res) => {
  const game = gameOf(req.query.game);
  const rows = (await db.execute({
    sql: `SELECT t.id, t.game, t.stake, t.max_players, t.config, u.pseudo AS creator,
           (SELECT COUNT(*) FROM table_players p WHERE p.table_id = t.id) AS n,
           (SELECT COUNT(*) FROM table_waitlist w WHERE w.table_id = t.id) AS waiting
    FROM game_tables t LEFT JOIN users u ON u.id = t.creator_id
    WHERE t.status = 'waiting' AND COALESCE(t.game, 'rami') = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 50`,
    args: [game],
  })).rows;
  const mine = await myActive(req.user.id);
  const q = await myQueue(req.user.id);
  res.json({
    mine: mine ? Number(mine.id) : null, mineGame: mine ? gameOf(mine.game) : null,
    myQueue: q ? { tableId: q.table_id, position: q.position, game: q.game } : null,
    feeBps: FEE_BPS,
    tables: rows.map((t) => {
      const stake = Number(t.stake);
      return { id: Number(t.id), kind: gameOf(t.game), stake, maxPlayers: Number(t.max_players), players: Number(t.n), waiting: Number(t.waiting), creator: t.creator || "Joueur", config: JSON.parse(t.config), escrow: stake };
    }),
  });
}));

r.post("/", wrap(async (req, res) => {
  const game = gameOf(req.body.game);
  const { stake, maxPlayers, config } = GAMES[game].parseConfig(req.body);
  const id = await inTx(async (tx) => {
    if (await myActive(req.user.id, tx)) throw bad("Tu es déjà à une table", 409);
    if (await myQueue(req.user.id, tx)) throw bad("Quitte d'abord ta liste d'attente", 409);
    const ins = await tx.execute({
      sql: "INSERT INTO game_tables (game, creator_id, stake, max_players, config) VALUES (?, ?, ?, ?, ?)",
      args: [game, req.user.id, stake, maxPlayers, JSON.stringify(config)],
    });
    const tid = Number(ins.lastInsertRowid);
    await adjust(tx, req.user.id, -stake, "bet", `Table #${tid}`);
    await tx.execute({ sql: "INSERT INTO table_players (table_id, user_id, locked) VALUES (?, ?, ?)", args: [tid, req.user.id, stake] });
    return tid;
  });
  res.status(201).json({ id });
}));

r.post("/:id/join", wrap(async (req, res) => {
  const id = +req.params.id;
  await inTx(async (tx) => {
    const t = await loadTable(id, tx);
    if (t.status !== "waiting") throw bad("Cette table n'accepte plus de joueurs");
    const ps = await players(id, tx);
    if (ps.some((p) => p.user_id === req.user.id)) return;
    if (ps.length >= t.max_players) throw bad("Table complète : mets-toi en liste d'attente");
    if (await myActive(req.user.id, tx)) throw bad("Tu es déjà à une table", 409);
    const q = await myQueue(req.user.id, tx);
    if (q && q.table_id !== id) throw bad("Quitte d'abord ta liste d'attente", 409);
    await tx.execute({ sql: "DELETE FROM table_waitlist WHERE table_id = ? AND user_id = ?", args: [id, req.user.id] });
    await adjust(tx, req.user.id, -t.stake, "bet", `Table #${id}`);
    await tx.execute({ sql: "INSERT INTO table_players (table_id, user_id, locked) VALUES (?, ?, ?)", args: [id, req.user.id, t.stake] });
  });
  res.json({ id });
}));

r.post("/:id/leave", wrap(async (req, res) => {
  const id = +req.params.id;
  await inTx(async (tx) => {
    const t = await loadTable(id, tx);
    if (t.status !== "waiting") throw bad("Partie en cours : ta mise reste engagée");
    const ps = await players(id, tx);
    const me = ps.find((p) => p.user_id === req.user.id);
    if (!me) return;
    if (t.creator_id === req.user.id) { // le créateur ferme la table : tout le monde est remboursé
      for (const p of ps) await adjust(tx, p.user_id, p.locked, "refund", `Table #${id} annulée`);
      await tx.execute({ sql: "UPDATE game_tables SET status = 'cancelled' WHERE id = ?", args: [id] });
      await tx.execute({ sql: "DELETE FROM table_waitlist WHERE table_id = ?", args: [id] });
      closeRoom("table", id);
    } else {
      await adjust(tx, me.user_id, me.locked, "refund", `Table #${id} quittée`);
      await tx.execute({ sql: "DELETE FROM table_players WHERE table_id = ? AND user_id = ?", args: [id, me.user_id] });
      await promote(tx, t); // le premier de la liste d'attente prend la place
    }
  });
  res.json({ ok: true });
}));

r.post("/:id/start", wrap(async (req, res) => {
  const id = +req.params.id;
  const entry = await inTx(async (tx) => {
    const t = await loadTable(id, tx);
    if (t.creator_id !== req.user.id) throw bad("Seul le créateur lance la partie", 403);
    if (t.status !== "waiting") throw bad("Partie déjà lancée");
    const ps = await players(id, tx);
    const need = Number(t.max_players) || (t.game === "domino" ? 3 : 3);
    if (ps.length < need) throw bad(t.game === "domino" ? `Le Domino se joue à ${need} joueurs : il en faut ${need}` : `Il faut au moins ${need} joueurs`);
    const g = GAMES[t.game].newGame(E.shuffle(ps.map((p) => p.user_id)), t.config); // places tirées au hasard
    await tx.execute({ sql: "UPDATE game_tables SET status = 'playing', state = ? WHERE id = ?", args: [JSON.stringify(g), id] });
    await tx.execute({ sql: "DELETE FROM table_waitlist WHERE table_id = ?", args: [id] });
    return { g, t: { id, game: t.game, stake: t.stake, config: t.config } };
  });
  cache.set(id, entry);
  res.json({ ok: true });
}));

// Page d'invitation : visible par tout joueur connecté qui a le lien (même s'il n'est pas à la table)
r.get("/:id/public", wrap(async (req, res) => {
  const id = +req.params.id;
  const t = await loadTable(id);
  const ps = await players(id);
  const q = await myQueue(req.user.id);
  const creator = ps.find((p) => p.user_id === t.creator_id)?.pseudo || "?";
  res.json({
    id, kind: t.game, status: t.status, stake: t.stake, maxPlayers: t.max_players, config: t.config, creator, feeBps: FEE_BPS,
    players: ps.map((p) => p.pseudo), inTable: ps.some((p) => p.user_id === req.user.id),
    waiting: await waitCount(id), myPosition: q && q.table_id === id ? q.position : null,
  });
}));

// Liste d'attente d'une table complète (rien n'est bloqué tant qu'on attend)
r.post("/:id/queue", wrap(async (req, res) => {
  const id = +req.params.id;
  await inTx(async (tx) => {
    const t = await loadTable(id, tx);
    if (t.status !== "waiting") throw bad("Cette table n'accepte plus d'inscriptions");
    const ps = await players(id, tx);
    if (ps.some((p) => p.user_id === req.user.id)) throw bad("Tu es déjà à cette table");
    if (ps.length < t.max_players) throw bad("Il reste une place : rejoins directement la table");
    if (await myActive(req.user.id, tx)) throw bad("Tu es déjà à une table", 409);
    const q = await myQueue(req.user.id, tx);
    if (q) { if (q.table_id === id) return; throw bad("Tu es déjà sur une autre liste d'attente", 409); }
    const b = (await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [req.user.id] })).rows[0];
    if (Number(b.balance) < t.stake) throw bad(`Solde insuffisant : la mise est de ${t.stake} Ar`);
    if ((await waitCount(id, tx)) >= WAITLIST_MAX) throw bad("Liste d'attente pleine");
    await tx.execute({ sql: "INSERT INTO table_waitlist (table_id, user_id) VALUES (?, ?)", args: [id, req.user.id] });
  });
  res.json({ ok: true });
}));
r.post("/:id/unqueue", wrap(async (req, res) => {
  await db.execute({ sql: "DELETE FROM table_waitlist WHERE table_id = ? AND user_id = ?", args: [+req.params.id, req.user.id] });
  res.json({ ok: true });
}));

r.get("/:id", wrap(async (req, res) => {
  const id = +req.params.id;
  const t = await loadTable(id);
  const ps = await players(id);
  if (!ps.some((p) => p.user_id === req.user.id)) throw bad("Tu ne fais pas partie de cette table", 403);
  let g = null;
  if (t.status === "playing") g = entryOf(t).g;
  else if (t.status === "finished") g = JSON.parse(t.state);
  res.json({ ...fullView(t, g, req.user.id, ps), waiting: await waitCount(id) });
}));

r.post("/:id/action", wrap(async (req, res) => {
  const id = +req.params.id, a = req.body || {};
  const out = await withLock(id, async () => {
    const t = await loadTable(id);
    if (t.status !== "playing") throw bad("Cette partie n'est pas en cours");
    const e = entryOf(t);
    const seat = e.g.seats.indexOf(req.user.id);
    if (seat < 0) throw bad("Tu ne joues pas à cette table", 403);
    if (a.type === "vote") {
      if (t.game !== "rami") throw bad("Action inconnue");
      await castVote(e, seat, !!a.accept, req.user.id);
    } else GAMES[t.game].act(e.g, seat, a, t.config);
    await persist(e);
    if (e.g.winner !== null) t.status = "finished";
    return fullView(t, e.g, req.user.id, await players(id));
  });
  res.json(out);
}));

export default r;