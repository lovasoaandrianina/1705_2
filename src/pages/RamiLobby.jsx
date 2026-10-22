import { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, pct, rulesText, optionsText } from "../config";
import CreateTable from "../components/CreateTable";

export default function RamiLobby({ user, onOpen, onBack, setQueue }) {
  const [d, setD] = useState({ tables: [], mine: null, myQueue: null, feeBps: 350 });
  const [err, setErr] = useState("");
  const [create, setCreate] = useState(false);

  const load = () => api.tables().then((x) => { setD(x); setQueue(x.myQueue ? x.myQueue.tableId : null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, []);

  const run = async (fn, after) => {
    setErr("");
    try { await fn(); after ? after() : await load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="shell">
      <button className="btn ghost" onClick={onBack}>← Retour</button>
      <h1>Entre amis</h1>
      <p className="sub">Ton solde : <b>{fmt(user.balance)}</b> 
      </p> 

      {d.mine && (
        <div className="tcard" style={{ borderColor: "#ffd54a" }}>
          <div className="l1"><span>Tu es à la table #{d.mine}</span></div>
          <button className="btn gold" onClick={() => onOpen(d.mine)}>Reprendre</button>
        </div>
      )}
      {d.myQueue && (
        <div className="tcard" style={{ borderColor: "#c4b5fd" }}>
          <div className="l1"><span>Liste d'attente · table #{d.myQueue.tableId}</span><span>n°{d.myQueue.position}</span></div>
          <small>Dès qu'une place se libère, tu es assis automatiquement (mise versée à ce moment-là).</small>
          <button className="btn" onClick={() => run(() => api.unqueueTable(d.myQueue.tableId))}>Quitter la liste d'attente</button>
        </div>
      )}
      {!d.mine && !d.myQueue && <button className="btn gold" style={{ width: "100%" }} onClick={() => setCreate(true)}>+ Créer une table</button>}
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}

      <div className="sec">Tables ouvertes</div>
      {d.tables.length === 0 && <p className="sub">Aucune table pour l'instant. Crées-en une et invite tes amis avec le lien.</p>}
      {d.tables.map((t) => {
        const full = t.players >= t.maxPlayers;
        const queued = d.myQueue && d.myQueue.tableId === t.id;
        const poor = user.balance < t.escrow;
        return (
          <div className="tcard" key={t.id}>
            <div className="l1"><span>Table #{t.id} · {t.creator}</span><span>{t.players}/{t.maxPlayers}</span></div>
            <small>Mise {fmt(t.stake)} · pot à table pleine {fmt(t.stake * t.maxPlayers)}</small>
            <small>{rulesText(t.config)}</small>
            <small>{optionsText(t.config)}</small>
            {full && t.waiting > 0 && <small>{t.waiting} en liste d'attente</small>}
            {!full ? (
              <button className="btn" disabled={!!d.mine || !!d.myQueue || poor} onClick={() => run(() => api.joinTable(t.id), () => onOpen(t.id))}>
                {poor ? "Solde insuffisant" : "Rejoindre"}
              </button>
            ) : queued ? (
              <button className="btn" disabled>En liste d'attente (n°{d.myQueue.position})</button>
            ) : (
              <button className="btn" disabled={!!d.mine || !!d.myQueue || poor} onClick={() => run(() => api.queueTable(t.id))}>
                {poor ? "Solde insuffisant" : "Table complète · liste d'attente"}
              </button>
            )}
          </div>
        );
      })}

      {create && <CreateTable feeBps={d.feeBps} onClose={() => setCreate(false)} onCreated={(id) => onOpen(id)} />}
    </div>
  );
}
