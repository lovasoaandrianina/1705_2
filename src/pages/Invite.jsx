import { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, pct, rulesList, optionsList, GAME_NAMES } from "../config";

export default function Invite({ id, onOpen, onBack, setQueue }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState("");
  const load = () => api.publicTable(id).then(setT).catch((e) => setErr(e.message));
  useEffect(() => { load(); const i = setInterval(load, 2000); return () => clearInterval(i); }, [id]);
  const act = async (fn, after) => {
    setErr("");
    try { await fn(); await load(); after && after(); } catch (e) { setErr(e.message); }
  };

  if (!t) return <div className="shell center">{err || "Chargement…"}<br /><button className="btn ghost" onClick={onBack}>Retour</button></div>;
  const full = t.players.length >= t.maxPlayers;

  return (
    <div className="shell">
      <button className="btn ghost" onClick={onBack}>← Accueil</button>
      <h1>Invitation</h1>
      <p className="sub"><b>{t.creator}</b> t'invite à sa table de {GAME_NAMES[t.kind] || "jeu"} (#{t.id})</p>
      <div className="info">
        Mise {fmt(t.stake)} par joueur · pot à table pleine {fmt(t.stake * t.maxPlayers)}
      </div>
      <div className="sec">Règles</div>
      <div className="rule-cards">
        {rulesList(t.config, t.kind).map((r, i) => (
          <div className="rule-card" key={`r-${i}`}>{r}</div>
        ))}
      </div>
      <div className="sec">Options</div>
      <div className="rule-cards">
        {optionsList(t.config, t.kind).map((r, i) => (
          <div className="rule-card" key={`o-${i}`}>{r}</div>
        ))}
      </div>
      <div className="sec">Joueurs ({t.players.length}/{t.maxPlayers})</div>
      {t.players.map((p) => <div className="tx" key={p}><span>{p}{p === t.creator ? " · créateur" : ""}</span></div>)}
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {t.inTable ? (
          <button className="btn gold" onClick={() => onOpen(t.id)}>Ouvrir la table</button>
        ) : t.status !== "waiting" ? (
          <p className="sub">Cette table n'est plus ouverte (partie lancée ou annulée).</p>
        ) : !full ? (
          <button className="btn gold" onClick={() => act(() => api.joinTable(t.id), () => onOpen(t.id))}>Rejoindre · mise {fmt(t.stake)}</button>
        ) : t.myPosition ? (
          <>
            <p className="sub" style={{ margin: 0 }}>Table complète. Tu es n°{t.myPosition} sur la liste d'attente : dès qu'une place se libère, tu es assis automatiquement et ta mise est versée.</p>
            <button className="btn" onClick={() => act(() => api.unqueueTable(t.id), () => setQueue(null))}>Quitter la liste d'attente</button>
          </>
        ) : (
          <>
            <p className="sub" style={{ margin: 0 }}>Table complète ({t.waiting} en attente). Rien n'est prélevé tant que tu attends.</p>
            <button className="btn gold" onClick={() => act(() => api.queueTable(t.id), () => setQueue(t.id))}>Me mettre en liste d'attente</button>
          </>
        )}
      </div>
    </div>
  );
}