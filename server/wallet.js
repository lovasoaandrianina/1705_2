import { Router } from "express";
import { db } from "./db.js";
import { requireAuth, checkPin, wrap } from "./auth.js";

const MAX = 10_000_000; // plafond par opération
const parseAmount = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= MAX ? Number(v) : null);

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

// Mouvement atomique : solde + historique dans la même transaction Turso
const move = (type) => wrap(async (req, res) => {
  const amount = parseAmount(req.body.amount);
  if (!amount) return res.status(400).json({ error: "Montant invalide" });
  if (type === "withdraw" && !checkPin(req.body.pin, req.user.pin_hash))
    return res.status(403).json({ error: "PIN incorrect" }); // le retrait exige le PIN

  // TODO paiement réel : ici, brancher Mvola / Orange Money / Airtel Money (ou autre).
  // Le dépôt ne doit être crédité qu'après confirmation du prestataire (webhook).
  const delta = type === "deposit" ? amount : -amount;
  const tx = await db.transaction("write");
  try {
    const up = await tx.execute({
      sql: "UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0",
      args: [delta, req.user.id, delta],
    });
    if (!up.rowsAffected) {
      await tx.rollback();
      return res.status(400).json({ error: "Solde insuffisant" });
    }
    const b = await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [req.user.id] });
    const balance = Number(b.rows[0].balance);
    await tx.execute({
      sql: "INSERT INTO transactions (user_id, type, amount, balance_after) VALUES (?, ?, ?, ?)",
      args: [req.user.id, type, amount, balance],
    });
    await tx.commit();
    res.json({ balance });
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
});
r.post("/deposit", move("deposit"));
r.post("/withdraw", move("withdraw"));

export default r;
