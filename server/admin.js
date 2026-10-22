import { Router } from "express";
import crypto from "node:crypto";
import { db } from "./db.js";
import { wrap } from "./auth.js";

// GET /api/admin/fees avec l'en-tête  x-admin-key: <ADMIN_KEY>  → total des commissions + les 50 dernières
const r = Router();
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
r.get("/fees", wrap(async (req, res) => {
  if (!process.env.ADMIN_KEY || !same(req.headers["x-admin-key"] || "", process.env.ADMIN_KEY)) return res.status(404).json({ error: "Introuvable" });
  const t = (await db.execute("SELECT COUNT(*) n, COALESCE(SUM(amount), 0) total FROM platform_fees")).rows[0];
  const last = (await db.execute("SELECT id, table_id, game, user_id, base, rate_bps, amount, created_at FROM platform_fees ORDER BY id DESC LIMIT 50")).rows;
  res.json({ count: Number(t.n), total: Number(t.total), last });
}));
export default r;
