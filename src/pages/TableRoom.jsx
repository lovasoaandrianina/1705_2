import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { fmt, pct, rulesList, optionsList, GAME_NAMES } from "../config";
import RamiOnline from "../games/RamiOnline";
import DominoOnline from "../games/DominoOnline";
import ChatDock from "../components/Chat";

export default function TableRoom({ id, user, onExit }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () => api.table(id).then((d) => setV({ ...d, fetchedAt: Date.now() })).catch((e) => setErr(e.message)),
    [id]
  );
  useEffect(() => { load(); const t = setInterval(load, 1000); return () => clearInterval(t); }, [load]);

  const act = async (a) => { const d = await api.tableAction(id, a); setV({ ...d, fetchedAt: Date.now() }); };
  const kind = v?.kind || "rami";
  const run = async (fn, leave) => {
    setErr("");
    try { await fn(); if (leave) onExit(kind); else await load(); } catch (e) { setErr(e.message); }
  };

  if (!v) return <div className="shell center">{err || "Chargement…"}</div>;
  // chat : en salle d'attente et pendant la partie ; il disparaît dès que la partie est terminée
  const finished = v.status === "finished" || (v.game && v.game.winner !== null && v.game.winner !== undefined);
  const chat = v.status !== "cancelled" && !finished ? <ChatDock kind="table" id={id} me={user} /> : null;
  if (v.game) return <>{kind === "domino" ? <DominoOnline view={v} act={act} onExit={() => onExit(kind)} /> : <RamiOnline view={v} act={act} onExit={() => onExit(kind)} />}{chat}</>;
  if (v.status === "cancelled")
    return (
      <div className="shell"><h2>Table annulée</h2><p className="sub">Les mises ont été remboursées.</p>
        <button className="btn gold" onClick={() => onExit(kind)}>Retour</button></div>
    );

  const isCreator = v.creatorId === user.id;
  const need = Number(v.maxPlayers) || (kind === "domino" ? 3 : 3);
  const link = `${window.location.origin}/?table=${v.id}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* sélection manuelle */ } };
  const share = () => navigator.share({ title: `${GAME_NAMES[kind]} entre amis`, text: `Rejoins ma table de ${GAME_NAMES[kind]} (#${v.id}) !`, url: link }).catch(() => {});

  return (
    <div className="shell">
      <button className="btn ghost" onClick={() => onExit(kind)}>← Lobby</button>
      <h1>{GAME_NAMES[kind]} · table #{v.id}</h1>
      {chat}
      <p className="sub">Mise {fmt(v.stake)} · {v.players.length}/{v.maxPlayers} joueurs</p>
      <div className="sec">Règles</div>
      <div className="rule-cards">
        {rulesList(v.config, kind).map((r, i) => (
          <div className="rule-card" key={`r-${i}`}>{r}</div>
        ))}
      </div>
      <div className="sec">Options</div>
      <div className="rule-cards">
        {optionsList(v.config, kind).map((r, i) => (
          <div className="rule-card" key={`o-${i}`}>{r}</div>
        ))}
      </div>
      <div className="info">Pot actuel : {fmt(v.pot)}</div>

      <div className="sec">Inviter des amis</div>
      <div className="linkbox">{link}</div>
      <div className="row2">
        <button className="btn" onClick={copy}>{copied ? "Lien copié ✓" : "Copier le lien"}</button>
        {navigator.share && <button className="btn gold" onClick={share}>Partager</button>}
      </div>
      {v.players.length >= v.maxPlayers && v.waiting > 0 && <p className="sub" style={{ marginTop: 10 }}>{v.waiting} joueur(s) en liste d'attente : ils prendront la première place libérée.</p>}

      <div className="sec">Joueurs</div>
      {v.players.map((p) => (
        <div className="tx" key={p.userId}><span>{p.pseudo}{p.userId === v.creatorId ? " · créateur" : ""}</span></div>
      ))}
      {v.players.length < need && <p className="sub" style={{ marginTop: 12 }}>En attente de joueurs ({need} {kind === "domino" ? "exactement" : "minimum"})…</p>}
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {isCreator && <button className="btn gold" disabled={v.players.length < need} onClick={() => run(() => api.startTable(id))}>Lancer la partie</button>}
        <button className="btn" onClick={() => run(() => api.leaveTable(id), true)}>
          {isCreator ? "Annuler la table (mises remboursées)" : "Quitter la table (mise remboursée)"}
        </button>
      </div>
    </div>
  );
}