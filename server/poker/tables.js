import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, wrap } from "../auth.js";
import { adjust, HttpError } from "../rami/money.js";
import { FEE_BPS } from "../rami/tables.js";
import { registerChecker, closeRoom } from "../chat.js";
import * as E from "./engine.js";

/* Poker cash game. Les jetons valent 1 Ar : l'achat de jetons est débité du solde, le retrait (à la sortie de table) y est recrédité.
   Commission : FEE_BPS sur le GAIN NET de la session (jetons retirés − jetons achetés), comme pour le Rami et le Domino. */
const bad = (m, c = 400) => new HttpError(c, m);
const pctText = (bps) => String(bps / 100).replace(".", ",");
const TOPUP_MIN = 500;

async function inTx(fn) {
  const tx = await db.transaction("write");
  try { const out = await fn(tx); await tx.commit(); return out; }
  catch (e) { try { await tx.rollback(); } catch { /* déjà annulée */ } throw e; }
  finally { tx.close(); }
}

/* ── Tables en cours : cache mémoire + sauvegarde Turso (à chaque événement important, sinon toutes les 8 s) ── */
const cache = new Map(); // id → { g, saved, key }
const locks = new Map();
const withLock = (id, fn) => {
  const run = (locks.get(id) || Promise.resolve()).catch(() => {}).then(fn);
  locks.set(id, run.catch(() => {}));
  return run;
};
const keyOf = (g) => `${g.handNo}:${g.phase}:${E.humans(g).map((x) => x.s.userId).join(",")}`;
const entryOf = (row) => {
  const id = Number(row.id);
  if (!cache.has(id)) { const g = E.normalize(JSON.parse(row.state)); g.feeBps = FEE_BPS; cache.set(id, { id, g, saved: Date.now(), key: keyOf(g) }); }
  return cache.get(id);
};
async function loadEntry(id) {
  if (cache.has(id)) return cache.get(id);
  const row = (await db.execute({ sql: "SELECT * FROM poker_tables WHERE id = ? AND status = 'open'", args: [id] })).rows[0];
  if (!row) throw bad("Table introuvable ou fermée", 404);
  return entryOf(row);
}
const save = (c, id, g) => c.execute({ sql: "UPDATE poker_tables SET state = ? WHERE id = ?", args: [JSON.stringify(g), id] });

// Encaissement d'un joueur qui quitte : ses jetons reviennent sur son solde, SANS commission (elle est déjà prélevée pot par pot)
async function cashOut(tx, tableId, ex) {
  const total = ex.payout, net = total - ex.invested;
  if (total > 0) await adjust(tx, ex.userId, total, total > ex.invested ? "win" : "refund", `Poker #${tableId} : retrait de ${total} Ar de jetons`);
  await tx.execute({ sql: "DELETE FROM poker_players WHERE user_id = ?", args: [ex.userId] });
  return { userId: ex.userId, payout: total, invested: ex.invested, net, feesPaid: ex.feesPaid, received: total };
}

const insertFee = (tx, tableId, f) => tx.execute({
  sql: "INSERT INTO platform_fees (table_id, user_id, base, rate_bps, amount, game) VALUES (?, ?, ?, ?, ?, 'poker')",
  args: [tableId, f.userId, f.base, FEE_BPS, f.fee],
});

// Commissions prélevées sur les pots gagnés : écrites dans platform_fees, en même temps que la sauvegarde de l'état
async function flushFees(e) {
  if (!e.g.feeLog || !e.g.feeLog.length) return;
  const batch = e.g.feeLog;
  e.g.feeLog = [];
  try {
    await inTx(async (tx) => {
      for (const f of batch) await insertFee(tx, e.id, f);
      await save(tx, e.id, e.g);
    });
    e.saved = Date.now();
  } catch (err) { e.g.feeLog = batch.concat(e.g.feeLog); throw err; } // on réessaiera au prochain passage
}

/* Applique g2 (copie modifiée de l'état) : encaisse les joueurs partis, exécute les opérations d'argent (ops), sauvegarde, puis
   remplace l'état en mémoire. Tout est dans UNE transaction : si l'argent échoue, rien n'est changé. */
async function commit(e, g2, ops) {
  const exits = [];
  for (const { s, i } of E.humans(g2)) if (s.leaving && E.exitable(g2, s)) exits.push(E.vacate(g2, i));
  const closing = !E.hasHumans(g2);
  const fees = g2.feeLog || [];
  g2.feeLog = [];
  const paid = await inTx(async (tx) => {
    if (ops) await ops(tx);
    for (const f of fees) await insertFee(tx, e.id, f); // commissions en attente : écrites avec la sortie, même si la table se ferme
    const out = [];
    for (const x of exits) out.push(await cashOut(tx, e.id, x));
    if (closing) await tx.execute({ sql: "UPDATE poker_tables SET status = 'closed', state = ? WHERE id = ?", args: [JSON.stringify(g2), e.id] });
    else await save(tx, e.id, g2);
    return out;
  });
  e.g = g2; e.saved = Date.now(); e.key = keyOf(g2);
  if (closing) { cache.delete(e.id); closeRoom("poker", e.id); }
  return paid;
}

// Arrêt du serveur (redémarrage, mise à jour, mise en veille) : on enregistre tout de suite l'état de chaque table
export async function flushPoker() {
  for (const [id, e] of cache) {
    try { await withLock(id, async () => { await flushFees(e); await save(db, id, e.g); }); }
    catch (err) { console.error("flush poker", id, err.message); }
  }
}

registerChecker("poker", async (uid, id) => { const e = cache.get(id); return !!e && E.seatOf(e.g, uid) >= 0; });

export async function startPokerSweeper() {
  const rows = (await db.execute("SELECT * FROM poker_tables WHERE status = 'open'")).rows;
  rows.forEach(entryOf);
  // Redémarrage / réveil du serveur : délai de grâce pour le joueur dont c'est le tour
  for (const e of cache.values()) if (e.g.hand && e.g.hand.deadline) e.g.hand.deadline = Math.max(e.g.hand.deadline, Date.now() + 25000);
  setInterval(() => {
    for (const [id, e] of cache)
      withLock(id, async () => {
        if (cache.get(id) !== e) return;
        let changed;
        try { changed = E.tick(e.g); }
        catch (err) { // état corrompu par un bug : on repart de la dernière sauvegarde plutôt que de bloquer la table
          console.error("poker tick", err);
          cache.delete(id); await loadEntry(id); return;
        }
        await flushFees(e);
        const leaving = E.humans(e.g).some(({ s }) => s.leaving && E.exitable(e.g, s));
        if (leaving) return void (await commit(e, structuredClone(e.g)));
        if (changed && (keyOf(e.g) !== e.key || Date.now() - e.saved > 8000)) {
          await save(db, id, e.g); e.saved = Date.now(); e.key = keyOf(e.g);
        }
      }).catch((err) => console.error("poker sweeper", err.message));
  }, 1000);
}

const parseBuy = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < E.MIN_BUY) throw bad(`Buy-in minimum : ${E.MIN_BUY} Ar`);
  return n;
};
// Blindes et buy-in saisis librement par le créateur
function parseTable(b) {
  const buy = parseBuy(b.buyIn), sb = Number(b.sb), bb = Number(b.bb);
  if (!Number.isInteger(sb) || sb < 1) throw bad("Petite blinde : un nombre entier supérieur à 0");
  if (!Number.isInteger(bb) || bb < sb) throw bad("La grosse blinde doit être supérieure ou égale à la petite blinde");
  if (bb * 10 > buy) throw bad(`Le buy-in doit représenter au moins 10 grosses blindes (${bb * 10} Ar pour une grosse blinde de ${bb})`);
  return { buy, sb, bb };
}
const balanceOf = async (uid, c = db) => Number((await c.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [uid] })).rows[0].balance);
const myTable = async (uid, c = db) => (await c.execute({ sql: "SELECT table_id FROM poker_players WHERE user_id = ?", args: [uid] })).rows[0];
const fullView = (e, uid) => ({ id: e.id, feeBps: FEE_BPS, ...E.view(e.g, uid) });

/* ── Routes ── */
const r = Router();
r.use(requireAuth);

r.get("/", wrap(async (req, res) => {
  const uid = Number(req.user.id);
  const mine = await myTable(uid);
  const tables = [...cache.values()].map((e) => {
    const hs = E.humans(e.g);
    return { id: e.id, sb: e.g.sb, bb: e.g.bb, buyIn: e.g.buyIn, players: hs.length, names: hs.map((x) => x.s.name) };
  }).sort((a, b) => b.id - a.id);
  res.json({ tables, mine: mine ? Number(mine.table_id) : null, feeBps: FEE_BPS, minBuy: E.MIN_BUY, maxBuy: E.MAX_BUY });
}));

r.post("/", wrap(async (req, res) => {
  const uid = Number(req.user.id), { buy, sb, bb } = parseTable(req.body);
  const blind = [sb, bb];
  if (await myTable(uid)) throw bad("Tu es déjà assis à une table de poker", 409);
  if ((await balanceOf(uid)) < buy) throw bad("Solde insuffisant pour cet achat de jetons");
  const g = E.newGame(blind[0], blind[1], FEE_BPS, buy);
  E.seatHuman(g, { userId: uid, name: req.user.pseudo, avatar: req.user.avatar || null, buy });
  const id = await inTx(async (tx) => {
    const ins = await tx.execute({ sql: "INSERT INTO poker_tables (creator_id, sb, bb, state) VALUES (?, ?, ?, ?)", args: [uid, blind[0], blind[1], JSON.stringify(g)] });
    const tid = Number(ins.lastInsertRowid);
    await adjust(tx, uid, -buy, "bet", `Poker #${tid} : achat de ${buy} Ar de jetons`);
    await tx.execute({ sql: "INSERT INTO poker_players (user_id, table_id) VALUES (?, ?)", args: [uid, tid] });
    return tid;
  });
  cache.set(id, { id, g, saved: Date.now(), key: keyOf(g) });
  res.status(201).json({ id });
}));

r.post("/:id/join", wrap(async (req, res) => {
  const id = +req.params.id, uid = Number(req.user.id);
  await withLock(id, async () => {
    const e = await loadEntry(id);
    const buy = e.g.buyIn; // buy-in fixé par le créateur : le même pour tous
    const mine = await myTable(uid);
    if (mine) { if (Number(mine.table_id) === id) return; throw bad("Tu es déjà assis à une autre table de poker", 409); }
    if ((await balanceOf(uid)) < buy) throw bad("Solde insuffisant pour cet achat de jetons");
    const g2 = structuredClone(e.g);
    E.seatHuman(g2, { userId: uid, name: req.user.pseudo, avatar: req.user.avatar || null, buy }); // place libre, ou erreur « table complète »
    await commit(e, g2, async (tx) => {
      await adjust(tx, uid, -buy, "bet", `Poker #${id} : achat de ${buy} Ar de jetons`);
      await tx.execute({ sql: "INSERT INTO poker_players (user_id, table_id) VALUES (?, ?)", args: [uid, id] });
    });
  });
  res.json({ id });
}));

// Page d'invitation : visible par tout joueur connecté qui a le lien
r.get("/:id/public", wrap(async (req, res) => {
  const id = +req.params.id, uid = Number(req.user.id);
  const e = await loadEntry(id);
  const hs = E.humans(e.g);
  res.json({ id, sb: e.g.sb, bb: e.g.bb, buyIn: e.g.buyIn, players: hs.map((x) => x.s.name), full: hs.length >= E.SEATS, inTable: E.seatOf(e.g, uid) >= 0,
    feeBps: FEE_BPS, minBuy: E.MIN_BUY, maxBuy: E.MAX_BUY });
}));

r.get("/:id", wrap(async (req, res) => {
  const id = +req.params.id, uid = Number(req.user.id);
  const e = await loadEntry(id).catch(() => null);
  if (!e || E.seatOf(e.g, uid) < 0) throw bad("Tu n'es pas assis à cette table", 403);
  res.json(fullView(e, uid));
}));

r.post("/:id/action", wrap(async (req, res) => {
  const id = +req.params.id, uid = Number(req.user.id), a = req.body || {};
  const out = await withLock(id, async () => {
    const e = await loadEntry(id);
    const me = E.seatOf(e.g, uid);
    if (me < 0) throw bad("Tu n'es pas assis à cette table", 403);
    const g2 = structuredClone(e.g);
    E.act(g2, me, { type: String(a.type), to: a.to });
    await commit(e, g2);
    return fullView(e, uid);
  });
  res.json(out);
}));

// Racheter / recharger des jetons (appliqués tout de suite, ou à la fin de la main en cours)
r.post("/:id/rebuy", wrap(async (req, res) => {
  const id = +req.params.id, uid = Number(req.user.id), amount = Number(req.body.amount);
  const out = await withLock(id, async () => {
    const e = await loadEntry(id);
    const me = E.seatOf(e.g, uid);
    if (me < 0) throw bad("Tu n'es pas assis à cette table", 403);
    const s = e.g.seats[me], have = s.stack + s.pendingAdd;
    if (s.leaving) throw bad("Tu quittes la table");
    if (!Number.isInteger(amount) || amount < (have === 0 ? e.g.buyIn : TOPUP_MIN)) throw bad(`Recharge minimum : ${have === 0 ? e.g.buyIn : TOPUP_MIN} Ar`);
    /* pas de plafond de buy-in / recharge */
    if ((await balanceOf(uid)) < amount) throw bad("Solde insuffisant");
    const g2 = structuredClone(e.g);
    E.addChips(g2, me, amount);
    await commit(e, g2, (tx) => adjust(tx, uid, -amount, "bet", `Poker #${id} : recharge de ${amount} Ar de jetons`));
    return fullView(e, uid);
  });
  res.json(out);
}));

r.post("/:id/leave", wrap(async (req, res) => {
  const id = +req.params.id, uid = Number(req.user.id);
  const out = await withLock(id, async () => {
    const e = await loadEntry(id);
    const g2 = structuredClone(e.g);
    const me = E.seatOf(g2, uid);
    if (me < 0) throw bad("Tu n'es pas assis à cette table", 403);
    const lc = E.leaveCheck(g2, me);
    if (!lc.ok) throw bad(`Tu pourras quitter la table quand le bouton dealer (D) sera sur toi : dans ${lc.in} main${lc.in > 1 ? "s" : ""}`);
    E.requestLeave(g2, me);
    const paid = await commit(e, g2);
    return paid.find((x) => x.userId === uid) || { payout: 0, received: 0, net: 0, feesPaid: 0 };
  });
  res.json({ ok: true, ...out, paid: undefined });
}));

export default r;
