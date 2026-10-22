import { useState } from "react";
import { api } from "../api";
import { fmt, pct, MIN_STAKE, MAX_STAKE } from "../config";

const RULES = [
  ["first50", "Premier à 50 gagne si aucun autre joueur n'a marqué"],
  ["big50", "Prendre 50 points en une seule fois gagne la partie"],
  ["outDouble6", "Terminer un tour (sortir) sur le double 6 gagne la partie"],
];

export default function CreateDomino({ onClose, onCreated, feeBps = 350 }) {
  const [stake, setStake] = useState(5000);
  const [rules, setRules] = useState({ first50: false, big50: false, outDouble6: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pot = Number(stake) * 3;

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { const { id } = await api.createTable({ game: "domino", stake: Number(stake), rules }); onCreated(id); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="head"><b style={{ fontSize: 18 }}>Créer une table de Domino</b><button type="button" className="btn ghost" onClick={onClose}>Fermer</button></div>
        <div className="info">3 joueurs exactement · 7 dominos chacun · le premier à 100 points gagne la partie.</div>

        <label className="field">Mise par joueur ({fmt(MIN_STAKE)} à {fmt(MAX_STAKE)})
          <input type="number" inputMode="numeric" min={MIN_STAKE} max={MAX_STAKE} step="500" value={stake} onChange={(e) => setStake(e.target.value)} required />
        </label>

        <div className="sec">Règles (cases à cocher)</div>
        {RULES.map(([k, label]) => (
          <label className="chk" key={k}>
            <input type="checkbox" checked={rules[k]} onChange={(e) => setRules({ ...rules, [k]: e.target.checked })} />{label}
          </label>
        ))}

        <div className="info">
          Chaque joueur verse sa mise dans le pot : <b>{fmt(pot)}</b>. Le gagnant de la partie l'empoche.<br />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy}>{busy ? "…" : "Créer la table"}</button>
      </form>
    </div>
  );
}