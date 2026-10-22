import { Router } from "express";
import crypto from "node:crypto";
import { db } from "./db.js";

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString("hex")}`;
};
export const checkPin = (pin, stored) => {
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = crypto.scryptSync(String(pin), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const normPhone = (v) => {
  const p = String(v || "").replace(/[\s().-]/g, "");
  return /^\+?\d{8,15}$/.test(p) ? p : null;
};
const publicUser = (u) => ({ id: Number(u.id), pseudo: u.pseudo, phone: u.phone, avatar: u.avatar, balance: Number(u.balance) });

async function newSession(userId) {
  const token = crypto.randomBytes(32).toString("hex"); // seul le hash est stocké
  await db.execute({
    sql: "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now','+30 days'))",
    args: [sha(token), userId],
  });
  return token;
}

export const requireAuth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Non connecté" });
  const r = await db.execute({
    sql: `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    args: [sha(token)],
  });
  if (!r.rows[0]) return res.status(401).json({ error: "Session expirée, reconnecte-toi" });
  req.user = r.rows[0];
  req.token = token;
  next();
});

// Anti force-brute basique : 5 échecs / 10 min par téléphone + IP
const fails = new Map();
const tooMany = (k) => (fails.get(k) || []).filter((t) => Date.now() - t < 600_000).length >= 5;
const addFail = (k) => fails.set(k, [...(fails.get(k) || []).filter((t) => Date.now() - t < 600_000), Date.now()]);

const r = Router();

r.post("/register", wrap(async (req, res) => {
  const pseudo = String(req.body.pseudo || "").trim();
  const phone = normPhone(req.body.phone);
  const pin = String(req.body.pin || "");
  const avatar = req.body.avatar || null; // facultatif
  if (!/^[\w.-]{3,16}$/.test(pseudo)) return res.status(400).json({ error: "Pseudo : 3 à 16 caractères (lettres, chiffres, _ . -)" });
  if (!phone) return res.status(400).json({ error: "Numéro de téléphone invalide" });
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "Le PIN doit contenir 4 à 6 chiffres" });
  if (avatar && (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar) || avatar.length > 200_000))
    return res.status(400).json({ error: "Photo invalide ou trop lourde" });
  try {
    const ins = await db.execute({
      sql: "INSERT INTO users (pseudo, phone, pin_hash, avatar) VALUES (?, ?, ?, ?)",
      args: [pseudo, phone, hashPin(pin), avatar],
    });
    const id = Number(ins.lastInsertRowid);
    const u = (await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] })).rows[0];
    res.status(201).json({ token: await newSession(id), user: publicUser(u) });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Pseudo ou numéro déjà utilisé" });
    throw e;
  }
}));

r.post("/login", wrap(async (req, res) => {
  const phone = normPhone(req.body.phone);
  const key = `${phone}|${req.ip}`;
  if (tooMany(key)) return res.status(429).json({ error: "Trop d'essais, réessaie dans 10 minutes" });
  const u = phone && (await db.execute({ sql: "SELECT * FROM users WHERE phone = ?", args: [phone] })).rows[0];
  if (!u || !checkPin(req.body.pin, u.pin_hash)) {
    addFail(key);
    return res.status(401).json({ error: "Téléphone ou PIN incorrect" });
  }
  res.json({ token: await newSession(u.id), user: publicUser(u) });
}));

r.get("/me", requireAuth, (req, res) => res.json(publicUser(req.user)));

r.post("/logout", requireAuth, wrap(async (req, res) => {
  await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [sha(req.token)] });
  res.json({ ok: true });
}));

export default r;
