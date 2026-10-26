import { Router } from "express";
import { db } from "./db.js";
import { requireAuth, wrap } from "./auth.js";
import { createRequest, decide, getSetting, METHODS, MIN_AMOUNT, MAX_AMOUNT } from "./payments.js";

const r = Router();
r.use(requireAuth);

r.get("/", wrap(async (req, res) => {
  const b = await db.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [req.user.id] });
  const t = await db.execute({
    sql: "SELECT id, type, amount, balance_after, note, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 30",
    args: [req.user.id],
  });
  res.json({ balance: Number(b.rows[0].balance), transactions: t.rows });
}));

// Consignes de paiement (numéros Mobile Money de l'administrateur, modifiables depuis /admin) + limites
r.get("/info", wrap(async (req, res) => {
  const DEFAULT_DEPOSIT = "MVola uniquement\nEnvoyer au +261 38 93 387 58\nAndrianina Lovasoa";
  res.json({ depositInfo: await getSetting("deposit_info", DEFAULT_DEPOSIT), methods: METHODS, min: MIN_AMOUNT, max: MAX_AMOUNT });
}));

// Mes demandes (statut en direct : en attente / validée / refusée / annulée)
r.get("/requests", wrap(async (req, res) => {
  const rows = (await db.execute({
    sql: `SELECT id, kind, amount, final_amount, method, reference, account, status, admin_note, created_at, processed_at
          FROM payment_requests WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
    args: [req.user.id],
  })).rows;
  const b = await db.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [req.user.id] });
  res.json({ requests: rows, balance: Number(b.rows[0].balance) });
}));

// Le dépôt n'est PLUS crédité directement : il devient une demande que l'administrateur valide après avoir reçu l'argent.
r.post("/deposit", wrap(async (req, res) => {
  const row = await createRequest(req.user, "deposit", req.body || {});
  res.status(201).json({ request: { id: Number(row.id), status: row.status } });
}));
r.post("/withdraw", wrap(async (req, res) => {
  const row = await createRequest(req.user, "withdraw", req.body || {});
  const b = await db.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [req.user.id] });
  res.status(201).json({ request: { id: Number(row.id), status: row.status }, balance: Number(b.rows[0].balance) });
}));
r.post("/requests/:id/cancel", wrap(async (req, res) => {
  const out = await decide(Number(req.params.id), "cancel", { userId: Number(req.user.id) });
  res.json({ ok: true, balance: out.balance });
}));

export default r;
