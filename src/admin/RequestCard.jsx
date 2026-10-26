import { useEffect, useRef, useState } from "react";
import { fmt } from "../config";

const METHOD = { mvola: "MVola", orange: "Orange Money", airtel: "Airtel Money", autre: "Autre" };
const REASONS = ["Paiement non reçu", "Montant différent", "Référence invalide", "Numéro invalide", "Autre"];

export const ago = (s) => {
  const t = new Date(String(s).replace(" ", "T") + "Z").getTime(), d = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (d < 60) return "à l'instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const digits = (p) => String(p).replace(/\D/g, "");
const wa = (p) => { const d = digits(p); return `https://wa.me/${d.startsWith("0") ? "261" + d.slice(1) : d}`; }; // numéros malgaches : 034… → 261 34…

export function Copy({ text, children }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="adm-copy" onClick={async () => { try { await navigator.clipboard.writeText(String(text)); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* ignore */ } }}>{ok ? "✓ copié" : children}</button>;
}

// Une demande : toutes les infos du joueur + le montant, et deux gros boutons. « Valider » demande une confirmation d'un second toucher (évite l'erreur).
export default function RequestCard({ r, onApprove, onReject, big = false }) {
  const dep = r.kind === "deposit";
  const [amount, setAmount] = useState(String(r.amount));
  const [armed, setArmed] = useState(false);
  const [rej, setRej] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useRef();
  useEffect(() => () => clearTimeout(t.current), []);
  useEffect(() => { setAmount(String(r.amount)); setArmed(false); setRej(false); }, [r.id]);

  const final = dep ? Number(amount) : r.amount;
  const diff = dep && final !== r.amount;
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); setArmed(false); } };
  const arm = () => { setArmed(true); clearTimeout(t.current); t.current = setTimeout(() => setArmed(false), 5000); };

  return (
    <div className={`adm-req ${dep ? "dep" : "wd"} ${big ? "big" : ""}`}>
      <div className="adm-req-top">
        <span className="adm-badge">{dep ? "DÉPÔT" : "RETRAIT"}</span>
        <span className="adm-ago">{ago(r.created_at)}</span>
      </div>
      <div className="adm-amount">{fmt(r.amount)}</div>

      <div className="adm-who">
        <div className="adm-id">#{r.uid}</div>
        <div className="adm-who-main">
          <b>{r.pseudo}</b>
          <a href={`tel:${r.phone}`}>{r.phone}</a>
        </div>
        <div className="adm-bal"><small>Solde actuel</small><b>{fmt(r.balance)}</b></div>
      </div>

      <div className="adm-grid">
        <div><small>Moyen</small><b>{METHOD[r.method] || r.method}</b></div>
        {dep ? (
          <div><small>Référence</small><b>{r.reference} <Copy text={r.reference}>copier</Copy></b></div>
        ) : (
          <div><small>Envoyer à</small><b>{r.account} <Copy text={r.account}>copier</Copy></b></div>
        )}
        {dep && r.account && <div><small>Payé depuis</small><b>{r.account}</b></div>}
        <div><small>{dep ? "Dépôts validés avant" : "Statut jetons"}</small><b>{dep ? (r.prev_ok === 0 ? "⚠️ premier dépôt" : r.prev_ok) : "déjà retirés du solde"}</b></div>
      </div>

      {r.blocked && <div className="adm-warn">⛔ Ce compte est suspendu</div>}

      {dep && (
        <label className="adm-field">Montant réellement reçu
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setArmed(false); }} />
        </label>
      )}
      {diff && <div className="adm-warn">Différent de la demande ({fmt(r.amount)}) : le solde sera crédité de {fmt(final || 0)}</div>}

      {!rej ? (
        <div className="adm-actions">
          <button className="adm-no" disabled={busy} onClick={() => setRej(true)}>✕ Refuser</button>
          <button className={`adm-ok ${armed ? "armed" : ""}`} disabled={busy || !(final > 0)} onClick={() => (armed ? run(() => onApprove(r, dep ? final : null)) : arm())}>
            {busy ? "…" : armed ? (dep ? `Confirmer +${fmt(final)}` : "Confirmer : j'ai envoyé") : dep ? "✓ Valider le dépôt" : "✓ Valider le retrait"}
          </button>
        </div>
      ) : (
        <div className="adm-rej">
          <div className="adm-chips">{REASONS.map((x) => <button key={x} className={reason === x ? "on" : ""} onClick={() => setReason(x)}>{x}</button>)}</div>
          <input placeholder="Motif (visible par le joueur)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="adm-actions">
            <button className="adm-back" onClick={() => setRej(false)}>Retour</button>
            <button className="adm-no solid" disabled={busy} onClick={() => run(() => onReject(r, reason))}>{busy ? "…" : dep ? "Confirmer le refus" : "Refuser et rendre les jetons"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
export { wa };
