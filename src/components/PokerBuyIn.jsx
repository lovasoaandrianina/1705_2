import { useState } from "react";
import { fmt } from "../config";
import SetCard from "./SetCard";

// Création de table : le créateur saisit les blindes ET le buy-in (identique pour tous les joueurs).
// Arrivée à une table (fixed) : le buy-in est imposé, on ne le choisit pas.
export default function PokerBuyIn({ title, fixed, minBuy, maxBuy, balance, onClose, onSubmit }) {
  const [sb, setSb] = useState("50");
  const [bb, setBb] = useState("100");
  const [bbTouched, setBbTouched] = useState(false);
  const [buy, setBuy] = useState("5000");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const s = fixed ? fixed.sb : Math.round(Number(sb)), b = fixed ? fixed.bb : Math.round(Number(bb)), n = fixed ? fixed.buyIn : Math.round(Number(buy));
  const problem = fixed ? "" :
    !(s >= 1) ? "Petite blinde : un nombre supérieur à 0"
    : !(b >= s) ? "La grosse blinde doit être au moins égale à la petite"
    : !(n >= minBuy) ? `Buy-in minimum : ${fmt(minBuy)}`
    : b * 10 > n ? `Le buy-in doit faire au moins 10 grosses blindes (${fmt(b * 10)})` : "";
  const poor = balance < n;

  const submit = async (e) => {
    e.preventDefault();
    if (problem) return setErr(problem);
    setErr(""); setBusy(true);
    try { await onSubmit({ sb: s, bb: b, buyIn: n }); } catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="head"><b style={{ fontSize: 18 }}>{title}</b><button type="button" className="btn ghost" onClick={onClose}>Fermer</button></div>
        <SetCard icon="🃏" title="Format de la table" hint="Texas Hold'em No-Limit · cash game">
          <div className="info" style={{ margin: 0 }}>Table de 2 à 9 joueurs réels. La main démarre dès que deux joueurs sont assis.</div>
        </SetCard>

        {fixed ? (
          <>
            <SetCard icon="🪙" title="Blindes" hint="Fixées par le créateur">
              <div className="info" style={{ margin: 0 }}>Petite / grosse blinde : <b>{fmt(s).replace(" Ar", "")} / {fmt(b)}</b></div>
            </SetCard>
            <SetCard icon="💼" title="Ton buy-in" hint="Le même pour tous les joueurs">
              <div className="info" style={{ margin: 0 }}>
                Tu auras <b>{fmt(n)}</b> de jetons, soit environ <b>{Math.floor(n / b)}</b> grosses blindes. Ton solde : <b>{fmt(balance)}</b>.
              </div>
            </SetCard>
          </>
        ) : (
          <>
            <SetCard icon="🪙" title="Blindes" hint="Saisies librement par le créateur">
              <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
                <label className="field" style={{ flex: 1 }}>Petite blinde (Ar)
                  <input type="number" inputMode="numeric" min="1" value={sb} onChange={(e) => { setSb(e.target.value); if (!bbTouched) setBb(String(Math.max(1, Math.round(Number(e.target.value) || 0) * 2))); }} required />
                </label>
                <label className="field" style={{ flex: 1 }}>Grosse blinde (Ar)
                  <input type="number" inputMode="numeric" min="1" value={bb} onChange={(e) => { setBb(e.target.value); setBbTouched(true); }} required />
                </label>
              </div>
            </SetCard>
            <SetCard icon="💼" title="Buy-in" hint={`Identique pour tous · min ${fmt(minBuy)}, sans plafond`}>
              <label className="field">Buy-in pour tous les joueurs
                <input type="number" inputMode="numeric" min={minBuy} step="500" value={buy} onChange={(e) => setBuy(e.target.value)} required />
              </label>
              <div className="row" style={{ marginTop: 8 }}>
                {[minBuy, 5000, 10000, 20000, 50000].map((v) => <button type="button" key={v} className="btn" onClick={() => setBuy(String(v))}>{(v / 1000).toLocaleString("fr-FR")}k</button>)}
              </div>
              <div className="info">Tous les joueurs entreront avec exactement ce buy-in : ils ne le choisissent pas. Soit environ <b>{b >= 1 ? Math.floor(n / b) || 0 : 0}</b> grosses blindes. Ton solde : <b>{fmt(balance)}</b>.</div>
            </SetCard>
          </>
        )}

        <SetCard icon="🚪" title="Sortie de table" tone="recap">
          <div className="info">En quittant la table, tes jetons sont recrédités sur ton solde (tu ne peux partir que lorsque le bouton dealer est sur toi).</div>
        </SetCard>
        {(err || problem) && <div className="err">{err || problem}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy || poor || !!problem}>
          {poor ? "Solde insuffisant" : busy ? "…" : fixed ? `Rejoindre avec ${fmt(n)}` : `Créer la table avec ${fmt(n)}`}
        </button>
      </form>
    </div>
  );
}
