import { useEffect, useState } from "react";
import { adm } from "./adminApi";
import { fmt } from "../config";
import { ago } from "./RequestCard";

export function Stats() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const go = () => adm.summary().then((d) => { setS(d); setErr(""); }).catch((e) => setErr(e.message));
    go(); const t = setInterval(go, 10000); return () => clearInterval(t);
  }, []);
  if (!s) return <div className="adm-page">{err || "Chargement…"}</div>;
  const cell = (label, value, tone = "") => <div className={`adm-stat ${tone}`}><small>{label}</small><b>{value}</b></div>;
  return (
    <div className="adm-page">
      {err && <div className="adm-err">{err}</div>}
      <h3>Aujourd'hui</h3>
      <div className="adm-stats">
        {cell("Dépôts validés", fmt(s.today.deposit), "pos")}
        {cell("Retraits validés", fmt(s.today.withdraw), "neg")}
        {cell("Commissions", fmt(s.fees.today), "gold")}
        {cell("Nouveaux joueurs", s.playersToday)}
      </div>
      <h3>En attente</h3>
      <div className="adm-stats">
        {cell("Dépôts", `${s.pending.deposit} · ${fmt(s.pending.depositSum)}`)}
        {cell("Retraits", `${s.pending.withdraw} · ${fmt(s.pending.withdrawSum)}`)}
      </div>
      <h3>Global</h3>
      <div className="adm-stats">
        {cell("Joueurs inscrits", s.players)}
        {cell("Soldes des joueurs (dû)", fmt(s.totalBalance))}
        {cell("Total déposé", fmt(s.allTime.deposit))}
        {cell("Total retiré", fmt(s.allTime.withdraw))}
        {cell("Commissions cumulées", fmt(s.fees.total), "gold")}
      </div>
      <h3>Dernières commissions</h3>
      {s.fees.last.length === 0 ? <p className="adm-empty">Aucune commission pour l'instant.</p> : s.fees.last.map((f) => (
        <div className="adm-tx" key={f.id}><span>{f.game || "jeu"} #{f.table_id}<small>{f.pseudo || "—"} · {ago(f.created_at)}</small></span><span className="plus">+{fmt(f.amount)}</span></div>
      ))}
    </div>
  );
}

const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

export function Settings({ onLogout, toast, pushState, enablePush }) {
  const [info, setInfo] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { adm.settings().then((d) => setInfo(d.depositInfo)).catch(() => {}); }, []);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div className="adm-page">
      <h3>Notifications (téléphone verrouillé / page fermée)</h3>
      <div className="adm-card">
        <p>État : <b>{pushState === "on" ? "✅ activées" : pushState === "denied" ? "⛔ refusées dans les réglages du téléphone" : pushState === "unsupported" ? "non disponibles ici" : "non activées"}</b></p>
        {pushState !== "on" && pushState !== "denied" && pushState !== "unsupported" && <button className="adm-ok" onClick={enablePush}>Activer les notifications</button>}
        {pushState === "on" && <button className="adm-back" onClick={() => adm.pushTest().then((r) => toast(r.sent ? "🔔 Notification envoyée" : "Aucun appareil abonné")).catch((e) => toast(e.message))}>Envoyer une notification test</button>}
        {ios && !standalone && <p className="adm-hint">📱 <b>iPhone</b> : pour recevoir les notifications, ouvre cette page dans Safari → bouton Partager → <b>« Sur l'écran d'accueil »</b>, puis lance l'app Admin depuis l'écran d'accueil et active les notifications.</p>}
        <p className="adm-hint">Page ouverte : la grosse sonnerie retentit en boucle jusqu'à ce que tu traites la demande. Page fermée : le téléphone affiche une notification (son système).</p>
      </div>

      <h3>Consignes de dépôt (vues par les joueurs)</h3>
      <div className="adm-card">
        <textarea rows={4} placeholder={"Ex : Envoie l'argent sur MVola 034 00 000 00 (Nom Prénom) ou Orange Money 032 00 000 00, puis saisis la référence reçue par SMS."} value={info} onChange={(e) => { setInfo(e.target.value); setSaved(false); }} maxLength={600} />
        <button className="adm-ok" onClick={() => adm.saveSettings({ depositInfo: info }).then(() => { setSaved(true); toast("✅ Consignes enregistrées"); }).catch((e) => toast(e.message))}>{saved ? "✓ Enregistré" : "Enregistrer"}</button>
      </div>

      <button className="adm-block" onClick={onLogout}>Se déconnecter du back office</button>
    </div>
  );
}
export { b64 };
