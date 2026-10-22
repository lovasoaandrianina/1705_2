import { useEffect, useState } from "react";
import { api } from "../api";
import { fmt } from "../config";

const TYPES = { deposit: ["Dépôt", 1], withdraw: ["Retrait", -1], bet: ["Mise au pot", -1], win: ["Gain", 1], refund: ["Remboursement", 1], fee: ["Commission", -1] };
const QUICK = [5000, 10000, 20000, 50000];
const when = (s) => new Date(s.replace(" ", "T") + "Z").toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export default function WalletModal({ user, setUser, start, onClose }) {
  const [tab, setTab] = useState(start === "wallet" ? "history" : "deposit");
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [txs, setTxs] = useState([]);

  const load = () => api.wallet()
    .then((d) => { setTxs(d.transactions); setUser((u) => ({ ...u, balance: d.balance })); })
    .catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const a = Number(amount);
      const r = tab === "deposit" ? await api.deposit(a) : await api.withdraw(a, pin);
      setUser((u) => ({ ...u, balance: r.balance }));
      setAmount(""); setPin("");
      await load();
      setTab("history");
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <div><small>Solde</small><br /><b style={{ fontSize: 22, color: "#ffd54a" }}>{fmt(user.balance)}</b></div>
          <button className="btn ghost" onClick={onClose}>Fermer</button>
        </div>

        <div className="tabs">
          {[["deposit", "Dépôt"], ["withdraw", "Retrait"], ["history", "Portefeuille"]].map(([k, l]) => (
            <button key={k} className={`btn ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); setErr(""); }}>{l}</button>
          ))}
        </div>

        {tab !== "history" ? (
          <form onSubmit={submit}>
            <div className="quick">
              {QUICK.map((q) => <button type="button" key={q} className="btn" onClick={() => setAmount(String(q))}>{q.toLocaleString("fr-FR")}</button>)}
            </div>
            <label className="field">Montant
              <input type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            {tab === "withdraw" && (
              <label className="field">Ton code PIN (confirmation)
                <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
              </label>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn gold" style={{ width: "100%" }} disabled={busy}>
              {busy ? "…" : tab === "deposit" ? "Déposer" : "Retirer"}
            </button>
          </form>
        ) : txs.length === 0 ? (
          <p className="sub">Aucune opération pour l'instant.</p>
        ) : (
          txs.map((t) => (
            <div className="tx" key={t.id}>
              <span>{(TYPES[t.type] || [t.type])[0]}<small>{t.note ? `${t.note} · ` : ""}{when(t.created_at)}</small></span>
              <span className={(TYPES[t.type] || [0, 1])[1] > 0 ? "plus" : "minus"}>
                {(TYPES[t.type] || [0, 1])[1] > 0 ? "+" : "−"}{fmt(t.amount)}<small>Solde : {fmt(t.balance_after)}</small>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
