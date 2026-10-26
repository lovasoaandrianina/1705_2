// Notifications push (Web Push) vers le téléphone de l'administrateur : elles arrivent même quand la page /admin est fermée.
// Les clés VAPID sont générées une seule fois puis gardées en base (app_settings) : rien à configurer.
import webpush from "web-push";
import { db } from "./db.js";

let keys = null;
const row = async () => (await db.execute("SELECT value FROM app_settings WHERE key = 'vapid'")).rows[0];
async function vapid() {
  if (keys) return keys;
  let r = await row();
  if (!r) {
    await db.execute({ sql: "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('vapid', ?)", args: [JSON.stringify(webpush.generateVAPIDKeys())] });
    r = await row();
  }
  keys = JSON.parse(r.value);
  return keys;
}

export const publicKey = async () => (await vapid()).publicKey;

export async function saveSub(sub) {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw Object.assign(new Error("Abonnement invalide"), { status: 400 });
  await db.execute({ sql: "INSERT OR REPLACE INTO push_subs (endpoint, data) VALUES (?, ?)", args: [sub.endpoint, JSON.stringify(sub)] });
}
export const removeSub = (endpoint) => db.execute({ sql: "DELETE FROM push_subs WHERE endpoint = ?", args: [endpoint] });

// Envoie à tous les appareils de l'admin. Ne lève jamais d'erreur (une notification ratée ne doit pas bloquer une demande de joueur).
export async function pushAll(payload) {
  try {
    const k = await vapid();
    const subs = (await db.execute("SELECT endpoint, data FROM push_subs")).rows;
    const opts = { TTL: 3600, urgency: "high", vapidDetails: { subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey: k.publicKey, privateKey: k.privateKey } };
    let ok = 0;
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), opts); ok++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await removeSub(s.endpoint); else console.error("push :", e.statusCode || e.message); }
    }));
    return ok;
  } catch (e) { console.error("push :", e.message); return 0; }
}
