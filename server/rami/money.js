export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Crédite (delta > 0) ou débite (delta < 0) un joueur + écrit l'historique. À appeler dans une transaction Turso.
export async function adjust(tx, userId, delta, type, note) {
  if (!delta) return;
  const up = await tx.execute({
    sql: "UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0",
    args: [delta, userId, delta],
  });
  if (!up.rowsAffected) throw new HttpError(400, "Solde insuffisant pour bloquer la mise");
  const b = await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] });
  await tx.execute({
    sql: "INSERT INTO transactions (user_id, type, amount, balance_after, note) VALUES (?, ?, ?, ?, ?)",
    args: [userId, type, Math.abs(delta), Number(b.rows[0].balance), note],
  });
}

export const MIN_STAKE = 1000, MAX_STAKE = 20000; // mise par joueur, en Ariary (tous les jeux)