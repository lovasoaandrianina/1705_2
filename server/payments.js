// Demandes de dépôt / retrait. Le joueur DEMANDE ; l'administrateur VALIDE depuis /admin.
//  - Dépôt  : le joueur paie par Mobile Money puis envoie sa demande (montant + référence). Le solde n'est crédité qu'à la validation.
//  - Retrait: les jetons sont retirés du solde TOUT DE SUITE (pas de double dépense) ; refusés/annulés → remboursés automatiquement.
import { db } from "./db.js";
import { adjust, HttpError } from "./rami/money.js";
import { checkPin } from "./auth.js";
import { pushAll } from "./push.js";

export const MIN_AMOUNT = 1000, MAX_AMOUNT = 10_000_000, MAX_PENDING = 3;
export const METHODS = { mvola: "MVola" };
const bad = (m, c = 400) => new HttpError(c, m);
const clean = (v, max) => String(v ?? "").trim().slice(0, max);
const ar = (n) => `${Number(n).toLocaleString("fr-FR")} Ar`;
const amountOf = (v) => { const n = Number(v); return Number.isInteger(n) && n >= MIN_AMOUNT && n <= MAX_AMOUNT ? n : null; };

async function inTx(fn) {
  const tx = await db.transaction("write");
  try { const out = await fn(tx); await tx.commit(); return out; }
  catch (e) { try { await tx.rollback(); } catch { /* déjà annulée */ } throw e; }
  finally { tx.close(); }
}

export async function getSetting(key, fallback = "") {
  const r = (await db.execute({ sql: "SELECT value FROM app_settings WHERE key = ?", args: [key] })).rows[0];
  return r ? String(r.value) : fallback;
}
export const setSetting = (key, value) => db.execute({ sql: "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, value] });

/* ── Création par le joueur ── */
export async function createRequest(user, kind, b) {
  if (kind !== "deposit" && kind !== "withdraw") throw bad("Type invalide");
  const amount = amountOf(b.amount);
  if (!amount) throw bad(`Montant : entre ${MIN_AMOUNT.toLocaleString("fr-FR")} et ${MAX_AMOUNT.toLocaleString("fr-FR")} Ar (nombre entier)`);
  const method = String(b.method || "");
  if (!METHODS[method]) throw bad("Choisis un moyen de paiement");
  let reference = null, account = null;
  if (kind === "deposit") {
    reference = clean(b.reference, 40);
    if (reference.length < 4) throw bad("Indique la référence de la transaction Mobile Money (reçue par SMS)");
    account = clean(b.account, 20) || null; // numéro depuis lequel il a payé (facultatif)
  } else {
    account = clean(b.account, 20).replace(/[\s().-]/g, "");
    if (!/^\+?\d{8,15}$/.test(account)) throw bad("Numéro de réception invalide");
    if (!checkPin(b.pin, user.pin_hash)) throw bad("PIN incorrect", 403);
  }
  const uid = Number(user.id);

  const row = await inTx(async (tx) => {
    const pend = Number((await tx.execute({ sql: "SELECT COUNT(*) n FROM payment_requests WHERE user_id = ? AND status = 'pending'", args: [uid] })).rows[0].n);
    if (pend >= MAX_PENDING) throw bad(`Tu as déjà ${MAX_PENDING} demandes en attente : patiente qu'elles soient traitées`, 429);
    if (kind === "deposit") {
      const dup = (await tx.execute({ sql: "SELECT id FROM payment_requests WHERE kind = 'deposit' AND lower(reference) = lower(?) AND status IN ('pending','approved')", args: [reference] })).rows[0];
      if (dup) throw bad("Cette référence de transaction a déjà été utilisée");
    }
    const ins = await tx.execute({
      sql: "INSERT INTO payment_requests (user_id, kind, amount, method, reference, account) VALUES (?, ?, ?, ?, ?, ?)",
      args: [uid, kind, amount, method, reference, account],
    });
    const id = Number(ins.lastInsertRowid);
    if (kind === "withdraw") {
      const bal = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [uid] })).rows[0].balance);
      if (bal < amount) throw bad("Solde insuffisant");
      await adjust(tx, uid, -amount, "withdraw", `Retrait #${id} en attente (${METHODS[method]})`);
    }
    return (await tx.execute({ sql: "SELECT * FROM payment_requests WHERE id = ?", args: [id] })).rows[0];
  });

  // Notification au téléphone de l'admin (sans attendre, sans jamais échouer)
  pushAll({
    title: `${kind === "deposit" ? "💰 Dépôt" : "💸 Retrait"} ${ar(amount)}`,
    body: `#${uid} ${user.pseudo} · ${user.phone} · ${METHODS[method]}`,
    tag: `req-${row.id}`, url: "/admin",
  });
  return row;
}

/* ── Décision : approve / reject (admin) ou cancel (le joueur lui-même) ── */
export async function decide(id, action, { note = "", amount = null, userId = null } = {}) {
  if (!["approve", "reject", "cancel"].includes(action)) throw bad("Action inconnue");
  note = clean(note, 200);
  return inTx(async (tx) => {
    const r = (await tx.execute({ sql: "SELECT * FROM payment_requests WHERE id = ?", args: [id] })).rows[0];
    if (!r) throw bad("Demande introuvable", 404);
    if (action === "cancel" && Number(r.user_id) !== Number(userId)) throw bad("Demande introuvable", 404);
    if (r.status !== "pending") throw bad(`Cette demande est déjà traitée (${r.status === "approved" ? "validée" : r.status === "rejected" ? "refusée" : "annulée"})`, 409);

    const uid = Number(r.user_id), status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled";
    let final = Number(r.amount);
    if (action === "approve" && r.kind === "deposit" && amount !== null && amount !== "") {
      final = Number(amount);
      if (!Number.isInteger(final) || final <= 0 || final > MAX_AMOUNT) throw bad("Montant reçu invalide");
    }
    // « AND status = 'pending' » : même avec deux clics simultanés, la demande n'est traitée (et le solde modifié) qu'UNE fois
    const up = await tx.execute({
      sql: "UPDATE payment_requests SET status = ?, final_amount = ?, admin_note = ?, processed_at = datetime('now') WHERE id = ? AND status = 'pending'",
      args: [status, action === "approve" ? final : null, note || null, id],
    });
    if (!up.rowsAffected) throw bad("Cette demande vient d'être traitée", 409);

    if (action === "approve" && r.kind === "deposit") await adjust(tx, uid, final, "deposit", `Dépôt #${id} validé (${METHODS[r.method] || r.method})`);
    if (r.kind === "withdraw" && action !== "approve") await adjust(tx, uid, Number(r.amount), "refund", `Retrait #${id} ${action === "reject" ? "refusé" : "annulé"} : jetons rendus`);
    if (action !== "cancel") await tx.execute({ sql: "INSERT INTO admin_log (action, user_id, request_id, amount, note) VALUES (?, ?, ?, ?, ?)", args: [`${r.kind}_${action}`, uid, id, action === "approve" ? final : Number(r.amount), note || null] });

    const bal = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [uid] })).rows[0].balance);
    return { ...r, status, final_amount: action === "approve" ? final : null, admin_note: note || null, userId: uid, balance: bal };
  });
}
export { inTx };
