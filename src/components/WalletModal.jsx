import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmt } from "../config";
import { play } from "../sound";

const TYPES = { deposit: ["Dépôt", 1], withdraw: ["Retrait", -1], bet: ["Mise au pot", -1], win: ["Gain", 1], refund: ["Remboursement", 1], fee: ["Commission", -1] };
const QUICK = [5000, 10000, 20000, 50000];
const STATUS = { pending: ["⏳ En attente de validation", "wait"], approved: ["✅ Validé", "ok"], rejected: ["❌ Refusé", "bad"], cancelled: ["Annulé", "off"] };
const when = (s) => new Date(s.replace(" ", "T") + "Z").toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Dépôt / retrait = DEMANDE : l'administrateur la valide (ton solde est mis à jour automatiquement dès la validation).
export default function WalletModal({ user, setUser, start, onClose }) {
  const [tab, setTab] = useState(start === "wallet" ? "history" : "deposit");
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [method, setMethod] = useState("mvola");
  const [reference, setReference] = useState("");
  const [account, setAccount] = useState(user.phone || "");
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [txs, setTxs] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [info, setInfo] = useState({ depositInfo: "MVola uniquement\nEnvoyer au +261 38 93 387 58\nAndrianina Lovasoa", methods: { mvola: "MVola" } });
  const lastPending = useRef(null);

  const load = () => Promise.all([api.wallet(), api.myRequests()])
    .then(([w, r]) => {
      setTxs(w.transactions); setReqs(r.requests);
      setUser((u) => ({ ...u, balance: r.balance }));
      const pend = r.requests.filter((x) => x.status === "pending").length;
      if (lastPending.current !== null && pend < lastPending.current) play("win"); // une demande vient d'être traitée
      lastPending.current = pend;
    })
    .catch(() => {});
  useEffect(() => { load(); api.walletInfo().then(setInfo).catch(() => {}); const t = setInterval(load, 4000); return () => clearInterval(t); }, []); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setOkMsg(""); setBusy(true);
    try {
      const a = Number(amount);
      if (tab === "deposit") await api.deposit({ amount: a, method, reference });
      else await api.withdraw({ amount: a, method, account, pin });
      setAmount(""); setPin(""); setReference("");
      await load();
      setOkMsg(tab === "deposit" ? "Demande envoyée. Ton solde sera crédité dès que l'administrateur l'aura validée." : "Demande envoyée. Tes jetons sont retirés du solde ; tu recevras l'argent après validation.");
      setTab("requests");
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };
  const cancel = async (r) => {
    if (!window.confirm(r.kind === "withdraw" ? "Annuler ce retrait ? Tes jetons te seront rendus." : "Annuler cette demande de dépôt ?")) return;
    try { await api.cancelRequest(r.id); await load(); } catch (x) { setErr(x.message); }
  };
  const pending = reqs.filter((r) => r.status === "pending").length;

  return (
    <div className="bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="head">
          <div><small>Solde</small><br /><b style={{ fontSize: 22, color: "#ffd54a" }}>{fmt(user.balance)}</b></div>
          <button className="btn ghost" onClick={onClose}>Fermer</button>
        </div>

        <div className="tabs">
          {[["deposit", "Dépôt"], ["withdraw", "Retrait"], ["requests", `Demandes${pending ? ` (${pending})` : ""}`], ["history", "Historique"]].map(([k, l]) => (
            <button key={k} className={`btn ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); setErr(""); setOkMsg(""); }}>{l}</button>
          ))}
        </div>

        {tab === "deposit" || tab === "withdraw" ? (
          <form onSubmit={submit}>
            {tab === "deposit" ? (
              <div className="info">
                <b>MVola</b> → <b>+261 38 93 387 58</b><br />
                <b>Andrianina Lovasoa</b><br />
                Envoie le montant, puis saisis le montant et la référence SMS ci-dessous.
              </div>
            ) : (
              <div className="info">Retrait MVola. Les jetons sont retirés tout de suite ; tu reçois l'argent après validation.</div>
            )}
            <div className="quick">
              {QUICK.map((q) => <button type="button" key={q} className="btn" onClick={() => setAmount(String(q))}>{q.toLocaleString("fr-FR")}</button>)}
            </div>
            <label className="field">Montant (Ar)
              <input type="number" inputMode="numeric" min="1000" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            <label className="field">{tab === "deposit" ? "Payé avec" : "Recevoir par"}
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 12 }}>
                {Object.entries(info.methods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            {tab === "deposit" ? (
              <label className="field">Référence de la transaction
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex : MP261023.1234.A56789" required minLength={4} maxLength={40} />
              </label>
            ) : (
              <>
                <label className="field">Numéro qui recevra l'argent
                  <input type="tel" inputMode="tel" value={account} onChange={(e) => setAccount(e.target.value)} required />
                </label>
                <label className="field">Ton code PIN (confirmation)
                  <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
                </label>
              </>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn gold" style={{ width: "100%" }} disabled={busy}>
              {busy ? "…" : tab === "deposit" ? "Envoyer ma demande de dépôt" : "Envoyer ma demande de retrait"}
            </button>
          </form>
        ) : tab === "requests" ? (
          <>
            {okMsg && <div className="info" style={{ marginBottom: 8 }}>{okMsg}</div>}
            {err && <div className="err">{err}</div>}
            {reqs.length === 0 ? <p className="sub">Aucune demande pour l'instant.</p> : reqs.map((r) => (
              <div className="tx" key={r.id}>
                <span>{r.kind === "deposit" ? "Dépôt" : "Retrait"} #{r.id}
                  <small>{STATUS[r.status][0]}{r.admin_note ? ` · ${r.admin_note}` : ""} · {when(r.created_at)}</small>
                  {r.status === "pending" && <button className="btn ghost" style={{ marginTop: 4 }} onClick={() => cancel(r)}>Annuler</button>}
                </span>
                <span className={r.kind === "deposit" ? "plus" : "minus"}>{r.kind === "deposit" ? "+" : "−"}{fmt(r.final_amount ?? r.amount)}</span>
              </div>
            ))}
          </>
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
