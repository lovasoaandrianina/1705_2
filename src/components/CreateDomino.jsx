import { useState } from "react";
import { api } from "../api";
import { fmt, MIN_STAKE, MAX_STAKE } from "../config";
import SetCard from "./SetCard";

const TARGETS = [100, 120];
const PLAYERS_OPTS = [2, 3];

export default function CreateDomino({ onClose, onCreated, feeBps = 350 }) {
  const [stake, setStake] = useState(5000);
  const [maxPlayers, setMaxPlayers] = useState(3);
  const [target, setTarget] = useState(100);
  const [rules, setRules] = useState({ firstHalf: false, bigHalf: false, outDouble6: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const half = Math.floor(target / 2);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { id } = await api.createTable({
        game: "domino",
        stake: Number(stake),
        maxPlayers: Number(maxPlayers),
        target: Number(target),
        rules: {
          first50: !!rules.firstHalf, // conservé côté serveur (seuil = half)
          big50: !!rules.bigHalf,
          outDouble6: !!rules.outDouble6,
        },
      });
      onCreated(id);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="head"><b style={{ fontSize: 18 }}>Créer une table de Domino</b><button type="button" className="btn ghost" onClick={onClose}>Fermer</button></div>

        <SetCard icon="👥" title="Nombre de joueurs" hint="2 ou 3 joueurs">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {PLAYERS_OPTS.map((n) => (
              <button
                key={n}
                type="button"
                className={`btn ${maxPlayers === n ? "on" : ""}`}
                onClick={() => setMaxPlayers(n)}
              >
                {n} joueurs
              </button>
            ))}
          </div>
          <div className="info" style={{ marginTop: 10, marginBottom: 0 }}>
            {maxPlayers === 2
              ? "Partie à deux · 7 dominos chacun · pioche dans le sabot si aucun coup possible."
              : "Partie à trois · 7 dominos chacun · sans coup possible on passe (pas de pioche)."}
          </div>
        </SetCard>

        <SetCard icon="🎯" title="Score à atteindre" hint="Objectif de la partie">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn ${target === t ? "on" : ""}`}
                onClick={() => setTarget(t)}
              >
                {t} points
              </button>
            ))}
          </div>
        </SetCard>

        <SetCard icon="💰" title="Mise" hint={`Par joueur, de ${fmt(MIN_STAKE)} à ${fmt(MAX_STAKE)}`}>
          <label className="field">Mise par joueur
            <input type="number" inputMode="numeric" min={MIN_STAKE} max={MAX_STAKE} step="500" value={stake} onChange={(e) => setStake(e.target.value)} required />
          </label>
        </SetCard>

        <SetCard icon="📜" title="Règles spéciales" hint={`Victoires immédiates (seuil = ${half})`}>
          <label className="chk">
            <input
              type="checkbox"
              checked={rules.firstHalf}
              onChange={(e) => setRules({ ...rules, firstHalf: e.target.checked })}
            />
            Premier à {half} gagne si aucun autre joueur n'a marqué
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={rules.bigHalf}
              onChange={(e) => setRules({ ...rules, bigHalf: e.target.checked })}
            />
            Prendre {half} points (ou plus) en une seule fois gagne la partie
          </label>
          <label className="chk">
            <input
              type="checkbox"
              checked={rules.outDouble6}
              onChange={(e) => setRules({ ...rules, outDouble6: e.target.checked })}
            />
            Terminer un tour (sortir) sur le double 6 gagne la partie
          </label>
        </SetCard>

        {err && <div className="err">{err}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy}>{busy ? "…" : "Créer la table"}</button>
      </form>
    </div>
  );
}
