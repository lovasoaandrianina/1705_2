import "dotenv/config";
import express from "express";
import cors from "cors";
import { migrate } from "./db.js";
import auth from "./auth.js";
import wallet from "./wallet.js";
import tables, { startSweeper } from "./rami/tables.js";
import poker, { startPokerSweeper, flushPoker } from "./poker/tables.js";
import chat from "./chat.js";
import admin from "./admin.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const app = express();
app.set("trust proxy", 1); // derrière le proxy de l'hébergeur (IP réelle pour l'anti force-brute)
app.use(cors({ origin: (process.env.CORS_ORIGIN || "http://localhost:5173").split(",") }));
app.use(express.json({ limit: "300kb" })); // la photo de profil passe en base64
app.use("/api/auth", auth);
app.use("/api/wallet", wallet);
app.use("/api/tables", tables);
app.use("/api/poker", poker);
app.use("/api/chat", chat);
app.use("/api/admin", admin);
app.use((e, req, res, next) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "Erreur serveur" });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Production : le même serveur sert le site compilé (dist/) et l'API → pas de CORS, pas de proxy, pas de « npm run dev »
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

try {
  const url = process.env.TURSO_DATABASE_URL || "";
  if (process.env.NODE_ENV === "production" && !url)
    throw new Error("En production, TURSO_DATABASE_URL est obligatoire (sinon comptes et soldes seraient perdus à chaque redémarrage)");
  if (url.includes("votre-org")) throw new Error("TURSO_DATABASE_URL contient encore la valeur d'exemple : mets ta vraie URL dans server/.env");
  await migrate();
} catch (e) {
  console.error("\n❌ Connexion à la base impossible :", e.message, "\n");
  process.exit(1);
}
const port = process.env.PORT || 3001;
await startSweeper();
await startPokerSweeper();
const server = app.listen(port, () => console.log(`✅ API prête : http://localhost:${port}/api/health`));

// Arrêt propre : l'hébergeur envoie SIGTERM avant d'arrêter / redéployer / endormir le service
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} reçu : enregistrement des parties en cours…`);
  server.close();
  const timer = setTimeout(() => process.exit(0), 8000).unref(); // jamais bloqué plus de 8 s
  try { await flushPoker(); } catch (e) { console.error("arrêt :", e.message); }
  clearTimeout(timer);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
