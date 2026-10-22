// Chat en direct par table (Domino / Rami : « table », Poker : « poker »).
// Tout vit en mémoire : aucun historique n'est enregistré, la salle est détruite à la fin de la partie.
import { Router } from "express";
import { requireAuth, wrap } from "./auth.js";
import { HttpError } from "./rami/money.js";

const bad = (m, c = 400) => new HttpError(c, m);
const rooms = new Map();      // "table:12" | "poker:3" → salle
const checkers = {};          // type de table → async (userId, tableId) => le joueur est-il à cette table ?
const MAX_MSGS = 200, MAX_LEN = 300, REACTIONS = ["👍", "😂", "😮", "🔥", "👏", "😢", "🎉", "😡"];

export const registerChecker = (kind, fn) => { checkers[kind] = fn; };
export const closeRoom = (kind, id) => rooms.delete(`${kind}:${id}`); // fin de partie : le chat disparaît

setInterval(() => { // salles oubliées (plus aucune activité depuis 6 h)
  const limit = Date.now() - 6 * 3600 * 1000;
  for (const [k, r] of rooms) if (r.last < limit) rooms.delete(k);
}, 10 * 60 * 1000).unref();

const push = (room, m) => {
  const now = Date.now();
  room.msgs.push({ id: ++room.seq, ts: now, ...m });
  const old = now - 60_000; // les réactions volantes n'ont pas besoin d'être gardées
  room.msgs = room.msgs.filter((x) => x.k !== "react" || x.ts > old).slice(-MAX_MSGS);
};

async function access(kind, id, user) {
  const chk = checkers[kind];
  if (!chk || !Number.isInteger(id)) throw bad("Chat indisponible", 404);
  const key = `${kind}:${id}`, uid = Number(user.id);
  let room = rooms.get(key);
  const okAt = room && room.ok.get(uid);
  if (!okAt || Date.now() - okAt > 60_000) { // l'appartenance à la table est revérifiée chaque minute
    if (!(await chk(uid, id))) { rooms.delete(key); throw bad("Chat fermé : il est réservé aux joueurs d'une partie en cours", 403); }
    if (!room) { room = { msgs: [], seq: 0, typing: new Map(), seen: new Map(), ok: new Map(), rate: new Map(), last: Date.now() }; rooms.set(key, room); }
    if (!room.ok.has(uid)) push(room, { k: "sys", text: `${user.pseudo} a rejoint la table 👋` });
    room.ok.set(uid, Date.now());
  }
  room.last = Date.now();
  return room;
}

const r = Router();
r.use(requireAuth);

r.get("/:kind/:id", wrap(async (req, res) => {
  const room = await access(req.params.kind, +req.params.id, req.user);
  const uid = Number(req.user.id), now = Date.now();
  room.seen.set(uid, { name: req.user.pseudo, t: now });
  if (req.query.typing === "1") room.typing.set(uid, { name: req.user.pseudo, t: now });
  const since = Number(req.query.since) || 0;
  res.json({
    msgs: room.msgs.filter((m) => m.id > since),
    last: room.seq,
    typing: [...room.typing].filter(([u, x]) => u !== uid && now - x.t < 3500).map(([, x]) => x.name),
    online: [...room.seen].filter(([, x]) => now - x.t < 7000).map(([u, x]) => ({ id: u, name: x.name })),
  });
}));

r.post("/:kind/:id", wrap(async (req, res) => {
  const room = await access(req.params.kind, +req.params.id, req.user);
  const uid = Number(req.user.id), now = Date.now();
  const hits = (room.rate.get(uid) || []).filter((t) => now - t < 5000);
  if (hits.length >= 6) throw bad("Doucement : trop de messages d'un coup", 429);
  room.rate.set(uid, [...hits, now]);
  room.typing.delete(uid);
  if (req.body.react !== undefined) {
    if (!REACTIONS.includes(req.body.react)) throw bad("Réaction inconnue");
    push(room, { k: "react", uid, name: req.user.pseudo, text: req.body.react });
  } else {
    const text = String(req.body.text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
    if (!text) throw bad("Message vide");
    push(room, { k: "msg", uid, name: req.user.pseudo, text });
  }
  res.json({ ok: true, last: room.seq });
}));

export default r;
