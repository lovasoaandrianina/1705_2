import { useState } from "react";
import { fmt } from "../config";

// Création de table : le créateur saisit les blindes ET le buy-in (identique pour tous les joueurs).
// Arrivée à une table (fixed) : le buy-in est imposé, on ne le choisit pas.
export default function PokerBuyIn({ title, fixed, minBuy, maxBuy, balance, onClose, onSubmit }) {
  const [sb, setSb] = useState("50");
  const [bb, setBb] = useState("100");
  const [bbTouched, setBbTouched] = useState(false);
  const [buy, setBuy] = useState(String(Math.min(5000, maxBuy)));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const s = fixed ? fixed.sb : Math.round(Number(sb)), b = fixed ? fixed.bb : Math.round(Number(bb)), n = fixed ? fixed.buyIn : Math.round(Number(buy));
  const problem = fixed ? "" :
    !(s >= 1) ? "Petite blinde : un nombre supérieur à 0"
    : !(b >= s) ? "La grosse blinde doit être au moins égale à la petite"
    : !(n >= minBuy && n <= maxBuy) ? `Buy-in : entre ${fmt(minBuy)} et ${fmt(maxBuy)}`
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
        <div className="info">Table de 2 à 9 joueurs réels. La main démarre dès que deux joueurs sont assis.</div>

        {fixed ? (
          <div className="info" style={{ marginTop: 10 }}>
            Blindes : <b>{fmt(s).replace(" Ar", "")} / {fmt(b)}</b><br />
            Buy-in fixé par le créateur de la table : <b>{fmt(n)}</b> (le même pour tous les joueurs).<br />
            Tu auras <b>{fmt(n)}</b> de jetons, soit environ <b>{Math.floor(n / b)}</b> grosses blindes. Ton solde : <b>{fmt(balance)}</b>.
          </div>
        ) : (
          <>
            <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
              <label className="field" style={{ flex: 1, marginTop: 12 }}>Petite blinde (Ar)
                <input type="number" inputMode="numeric" min="1" value={sb} onChange={(e) => { setSb(e.target.value); if (!bbTouched) setBb(String(Math.max(1, Math.round(Number(e.target.value) || 0) * 2))); }} required />
              </label>
              <label className="field" style={{ flex: 1, marginTop: 12 }}>Grosse blinde (Ar)
                <input type="number" inputMode="numeric" min="1" value={bb} onChange={(e) => { setBb(e.target.value); setBbTouched(true); }} required />
              </label>
            </div>
            <label className="field" style={{ marginTop: 12 }}>Buy-in pour tous les joueurs ({fmt(minBuy)} à {fmt(maxBuy)})
              <input type="number" inputMode="numeric" min={minBuy} max={maxBuy} step="500" value={buy} onChange={(e) => setBuy(e.target.value)} required />
            </label>
            <input type="range" min={minBuy} max={maxBuy} step="500" value={Math.min(maxBuy, Math.max(minBuy, n || minBuy))} onChange={(e) => setBuy(e.target.value)} style={{ width: "100%" }} />
            <div className="row" style={{ marginTop: 8 }}>
              {[minBuy, 5000, 10000, maxBuy].map((v) => <button type="button" key={v} className="btn" onClick={() => setBuy(v)}>{(v / 1000).toLocaleString("fr-FR")}k</button>)}
            </div>
            <div className="info">
              Tous les joueurs entreront avec exactement ce buy-in : ils ne le choisissent pas. Soit environ <b>{b >= 1 ? Math.floor(n / b) || 0 : 0}</b> grosses blindes. Ton solde : <b>{fmt(balance)}</b>.
            </div>
          </>
        )}
        <div className="info">En quittant la table, tes jetons sont recrédités sur ton solde (tu ne peux partir que lorsque le bouton dealer est sur toi).</div>
        {(err || problem) && <div className="err">{err || problem}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy || poor || !!problem}>
          {poor ? "Solde insuffisant" : busy ? "…" : fixed ? `Rejoindre avec ${fmt(n)}` : `Créer la table avec ${fmt(n)}`}
        </button>
      </form>
    </div>
  );
}
