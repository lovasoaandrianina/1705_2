// Back office : tout passe par /api/admin/*. Accès protégé par ADMIN_KEY (variable d'environnement).
//  - POST /login {key} → jeton signé (30 jours) stocké sur le téléphone ; la clé elle-même n'est jamais conservée.
//  - L'en-tête « x-admin-key: <ADMIN_KEY> » reste accepté (scripts, anciennes consultations de /fees).
import { Router } from "express";
import crypto from "node:crypto";
import { db } from "./db.js";
import { wrap } from "./auth.js";
import { adjust, HttpError } from "./rami/money.js";
import { decide, getSetting, setSetting, METHODS } from "./payments.js";
import { publicKey, saveSub, removeSub, pushAll } from "./push.js";

const r = Router();
const bad = (m, c = 400) => new HttpError(c, m);
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sig = (exp) => crypto.createHmac("sha256", String(process.env.ADMIN_KEY)).update(`admin.${exp}`).digest("hex");
const makeToken = () => { const exp = Date.now() + 30 * 86400_000; return `${exp}.${sig(exp)}`; };
const tokenOk = (t) => { const [exp, s] = String(t || "").split("."); return !!exp && !!s && Number(exp) > Date.now() && same(s, sig(exp)); };

// Anti force-brute : 5 clés fausses / 10 min par IP
const fails = new Map();
const recent = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < 600_000);

r.post("/login", wrap(async (req, res) => {
  if (!process.env.ADMIN_KEY) return res.status(404).json({ error: "Introuvable" });
  if (recent(req.ip).length >= 5) return res.status(429).json({ error: "Trop d'essais, réessaie dans 10 minutes" });
  if (!same(req.body?.key || "", process.env.ADMIN_KEY)) { fails.set(req.ip, [...recent(req.ip), Date.now()]); return res.status(401).json({ error: "Clé incorrecte" }); }
  res.json({ token: makeToken() });
}));

r.use((req, res, next) => {
  if (!process.env.ADMIN_KEY) return res.status(404).json({ error: "Introuvable" });
  const bearer = (req.headers.authorization || "").replace("Bearer ", "");
  if (tokenOk(bearer) || same(req.headers["x-admin-key"] || "", process.env.ADMIN_KEY)) return next();
  res.status(401).json({ error: "Session admin expirée" });
});

const idOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw bad("Identifiant invalide"); return n; };
const num = (v) => Number(v || 0);
const REQ_SQL = `SELECT r.id, r.kind, r.amount, r.final_amount, r.method, r.reference, r.account, r.status, r.admin_note, r.created_at, r.processed_at,
  u.id AS uid, u.pseudo, u.phone, u.balance, u.blocked, u.created_at AS user_since,
  (SELECT COUNT(*) FROM payment_requests p WHERE p.user_id = r.user_id AND p.kind = 'deposit' AND p.status = 'approved') AS prev_ok
  FROM payment_requests r JOIN users u ON u.id = r.user_id`;
const reqOut = (x) => ({ ...x, id: num(x.id), uid: num(x.uid), amount: num(x.amount), final_amount: x.final_amount == null ? null : num(x.final_amount), balance: num(x.balance), blocked: !!num(x.blocked), prev_ok: num(x.prev_ok) });

/* ── Surveillance : appelé toutes les ~3 s par le téléphone ── */
r.get("/poll", wrap(async (req, res) => {
  const rows = (await db.execute(`${REQ_SQL} WHERE r.status = 'pending' ORDER BY r.id`)).rows.map(reqOut);
  res.json({ pending: rows, now: Date.now() });
}));

r.get("/requests", wrap(async (req, res) => {
  const lim = Math.min(100, Math.max(1, Number(req.query.limit) || 40)), off = Math.max(0, Number(req.query.offset) || 0);
  const kind = req.query.kind === "deposit" || req.query.kind === "withdraw" ? req.query.kind : null;
  const rows = (await db.execute({
    sql: `${REQ_SQL} WHERE r.status != 'pending' ${kind ? "AND r.kind = ?" : ""} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    args: kind ? [kind, lim, off] : [lim, off],
  })).rows.map(reqOut);
  res.json({ requests: rows });
}));

r.post("/requests/:id/approve", wrap(async (req, res) => {
  const out = await decide(idOf(req.params.id), "approve", { note: req.body?.note, amount: req.body?.amount ?? null });
  res.json({ ok: true, request: { id: num(out.id), kind: out.kind, status: out.status, final_amount: out.final_amount, userId: out.userId, balance: out.balance } });
}));
r.post("/requests/:id/reject", wrap(async (req, res) => {
  const out = await decide(idOf(req.params.id), "reject", { note: req.body?.note });
  res.json({ ok: true, request: { id: num(out.id), kind: out.kind, status: out.status, userId: out.userId, balance: out.balance } });
}));

/* ── Joueurs ── */
r.get("/players", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 30).replace(/[%_\\]/g, (m) => `\\${m}`);
  const lim = Math.min(100, Math.max(1, Number(req.query.limit) || 40)), off = Math.max(0, Number(req.query.offset) || 0);
  const order = { balance: "balance DESC, id DESC", pseudo: "pseudo COLLATE NOCASE ASC", old: "id ASC", new: "id DESC" }[req.query.sort] || "id DESC";
  const where = q ? "WHERE pseudo LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR CAST(id AS TEXT) = ?" : "";
  const args = q ? [`%${q}%`, `%${q}%`, q.replace(/\\/g, "")] : [];
  const rows = (await db.execute({ sql: `SELECT id, pseudo, phone, balance, blocked, created_at FROM users ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, args: [...args, lim, off] })).rows;
  const total = num((await db.execute({ sql: `SELECT COUNT(*) n FROM users ${where}`, args })).rows[0].n);
  res.json({ total, players: rows.map((u) => ({ id: num(u.id), pseudo: u.pseudo, phone: u.phone, balance: num(u.balance), blocked: !!num(u.blocked), created_at: u.created_at })) });
}));

r.get("/players/:id", wrap(async (req, res) => {
  const id = idOf(req.params.id);
  const u = (await db.execute({ sql: "SELECT id, pseudo, phone, balance, blocked, created_at FROM users WHERE id = ?", args: [id] })).rows[0];
  if (!u) throw bad("Joueur introuvable", 404);
  const txs = (await db.execute({ sql: "SELECT id, type, amount, balance_after, note, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 40", args: [id] })).rows;
  const reqs = (await db.execute({ sql: `${REQ_SQL} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 20`, args: [id] })).rows.map(reqOut);
  const tot = (await db.execute({
    sql: `SELECT kind, COALESCE(SUM(COALESCE(final_amount, amount)), 0) s, COUNT(*) n FROM payment_requests WHERE user_id = ? AND status = 'approved' GROUP BY kind`, args: [id],
  })).rows;
  const sum = (k) => num((tot.find((x) => x.kind === k) || {}).s);
  const pk = (await db.execute({ sql: "SELECT table_id FROM poker_players WHERE user_id = ?", args: [id] })).rows[0];
  const gt = (await db.execute({
    sql: `SELECT g.id, g.game, g.status FROM table_players tp JOIN game_tables g ON g.id = tp.table_id WHERE tp.user_id = ? AND g.status IN ('waiting','playing')`, args: [id],
  })).rows;
  res.json({
    player: { id: num(u.id), pseudo: u.pseudo, phone: u.phone, balance: num(u.balance), blocked: !!num(u.blocked), created_at: u.created_at },
    deposited: sum("deposit"), withdrawn: sum("withdraw"),
    atTables: [...(pk ? [{ game: "poker", id: num(pk.table_id) }] : []), ...gt.map((g) => ({ game: g.game, id: num(g.id), status: g.status }))],
    transactions: txs.map((t) => ({ ...t, id: num(t.id), amount: num(t.amount), balance_after: num(t.balance_after) })),
    requests: reqs,
  });
}));

// Crédit / débit manuel (geste commercial, correction, litige…) : motif obligatoire, tracé dans l'historique du joueur ET dans admin_log
r.post("/players/:id/adjust", wrap(async (req, res) => {
  const id = idOf(req.params.id), amount = Number(req.body?.amount), note = String(req.body?.note || "").trim().slice(0, 120);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10_000_000) throw bad("Montant invalide (entier, positif pour créditer, négatif pour débiter)");
  if (note.length < 3) throw bad("Indique un motif (3 caractères minimum)");
  const tx = await db.transaction("write");
  try {
    const u = (await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [id] })).rows[0];
    if (!u) throw bad("Joueur introuvable", 404);
    if (num(u.balance) + amount < 0) throw bad("Le solde ne peut pas devenir négatif");
    await adjust(tx, id, amount, amount > 0 ? "deposit" : "withdraw", `Ajustement admin : ${note}`);
    await tx.execute({ sql: "INSERT INTO admin_log (action, user_id, amount, note) VALUES ('adjust', ?, ?, ?)", args: [id, amount, note] });
    const b = num((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [id] })).rows[0].balance);
    await tx.commit();
    res.json({ ok: true, balance: b });
  } catch (e) { try { await tx.rollback(); } catch { /* déjà annulée */ } throw e; }
  finally { tx.close(); }
}));

r.post("/players/:id/block", wrap(async (req, res) => {
  const id = idOf(req.params.id), blocked = req.body?.blocked ? 1 : 0;
  const up = await db.execute({ sql: "UPDATE users SET blocked = ? WHERE id = ?", args: [blocked, id] });
  if (!up.rowsAffected) throw bad("Joueur introuvable", 404);
  if (blocked) await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [id] }); // déconnecté immédiatement
  await db.execute({ sql: "INSERT INTO admin_log (action, user_id) VALUES (?, ?)", args: [blocked ? "block" : "unblock", id] });
  res.json({ ok: true, blocked: !!blocked });
}));

/* ── Tableau de bord ── */
r.get("/summary", wrap(async (req, res) => {
  const day = "date(processed_at, '+3 hours') = date('now', '+3 hours')"; // jour calendaire à Madagascar (UTC+3)
  const one = async (sql) => (await db.execute(sql)).rows[0];
  const users = await one("SELECT COUNT(*) n, COALESCE(SUM(balance), 0) bal, SUM(CASE WHEN date(created_at, '+3 hours') = date('now', '+3 hours') THEN 1 ELSE 0 END) today FROM users");
  const pend = (await db.execute("SELECT kind, COUNT(*) n, COALESCE(SUM(amount), 0) s FROM payment_requests WHERE status = 'pending' GROUP BY kind")).rows;
  const done = (await db.execute(`SELECT kind, COUNT(*) n, COALESCE(SUM(COALESCE(final_amount, amount)), 0) s FROM payment_requests WHERE status = 'approved' AND ${day} GROUP BY kind`)).rows;
  const all = (await db.execute("SELECT kind, COALESCE(SUM(COALESCE(final_amount, amount)), 0) s FROM payment_requests WHERE status = 'approved' GROUP BY kind")).rows;
  const fees = await one(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) total, COALESCE(SUM(CASE WHEN date(created_at, '+3 hours') = date('now', '+3 hours') THEN amount ELSE 0 END), 0) today FROM platform_fees`);
  const lastFees = (await db.execute(`SELECT f.id, f.game, f.table_id, f.amount, f.created_at, u.pseudo FROM platform_fees f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 12`)).rows;
  const pick = (rows, k, f) => num((rows.find((x) => x.kind === k) || {})[f]);
  res.json({
    players: num(users.n), playersToday: num(users.today), totalBalance: num(users.bal),
    pending: { deposit: pick(pend, "deposit", "n"), withdraw: pick(pend, "withdraw", "n"), depositSum: pick(pend, "deposit", "s"), withdrawSum: pick(pend, "withdraw", "s") },
    today: { deposit: pick(done, "deposit", "s"), withdraw: pick(done, "withdraw", "s"), depositN: pick(done, "deposit", "n"), withdrawN: pick(done, "withdraw", "n") },
    allTime: { deposit: pick(all, "deposit", "s"), withdraw: pick(all, "withdraw", "s") },
    fees: { count: num(fees.n), total: num(fees.total), today: num(fees.today), last: lastFees.map((f) => ({ ...f, id: num(f.id), amount: num(f.amount) })) },
  });
}));

// Ancienne consultation des commissions (toujours disponible)
r.get("/fees", wrap(async (req, res) => {
  const t = (await db.execute("SELECT COUNT(*) n, COALESCE(SUM(amount), 0) total FROM platform_fees")).rows[0];
  const last = (await db.execute("SELECT id, table_id, game, user_id, base, rate_bps, amount, created_at FROM platform_fees ORDER BY id DESC LIMIT 50")).rows;
  res.json({ count: num(t.n), total: num(t.total), last });
}));

/* ── Réglages ── */
r.get("/settings", wrap(async (req, res) => res.json({ depositInfo: await getSetting("deposit_info", ""), methods: METHODS })));
r.put("/settings", wrap(async (req, res) => {
  const info = String(req.body?.depositInfo ?? "").slice(0, 600);
  await setSetting("deposit_info", info);
  res.json({ ok: true });
}));

/* ── Notifications push (téléphone) ── */
r.get("/push/key", wrap(async (req, res) => res.json({ key: await publicKey() })));
r.post("/push/subscribe", wrap(async (req, res) => { await saveSub(req.body); res.json({ ok: true }); }));
r.post("/push/unsubscribe", wrap(async (req, res) => { if (req.body?.endpoint) await removeSub(String(req.body.endpoint)); res.json({ ok: true }); }));
r.post("/push/test", wrap(async (req, res) => {
  const sent = await pushAll({ title: "🔔 Test de notification", body: "Si tu vois ceci, les alertes fonctionnent.", tag: "test", url: "/admin" });
  res.json({ ok: true, sent });
}));

export default r;
