import { useEffect, useState } from "react";
import { api } from "../api";
import { fmt } from "../config";
import PokerBuyIn from "../components/PokerBuyIn";

const DEF = { tables: [], mine: null, feeBps: 350, minBuy: 2000, maxBuy: null };

export default function PokerLobby({ user, onOpen, onBack }) {
  const [d, setD] = useState(DEF);
  const [err, setErr] = useState("");
  const [sheet, setSheet] = useState(null); // null | { create: true } | { join: table }

  const load = () => api.pokerTables().then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, []);

  const common = { minBuy: d.minBuy, maxBuy: d.maxBuy, balance: user.balance, onClose: () => setSheet(null) };

  return (
    <div className="shell">
      <button className="btn ghost" onClick={onBack}>← Retour</button>
      <h1>Poker entre amis</h1>
      <p className="sub">
        Texas Hold'em No-Limit · cash game · de 2 à 9 joueurs par table<br />
        Ton solde : <b>{fmt(user.balance)}</b> · buy-in fixé par le créateur (min {fmt(d.minBuy)}, sans plafond)
      </p>

      {d.mine && (
        <div className="tcard" style={{ borderColor: "#ffd54a" }}>
          <div className="l1"><span>Tu es assis à la table #{d.mine}</span></div>
          <button className="btn gold" onClick={() => onOpen(d.mine)}>Reprendre</button>
        </div>
      )}
      {!d.mine && <button className="btn gold" style={{ width: "100%" }} onClick={() => setSheet({ create: true })}>+ Créer une table</button>}
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}

      <div className="sec">Tables ouvertes</div>
      {d.tables.length === 0 && <p className="sub">Aucune table pour l'instant. Crées-en une et invite tes amis avec le lien.</p>}
      {d.tables.map((t) => (
        <div className="tcard" key={t.id}>
          <div className="l1"><span>Table #{t.id} · blindes {t.sb} / {t.bb} · buy-in {fmt(t.buyIn)}</span><span>{t.players}/9</span></div>
          <small>👤 {t.names.join(", ") || "—"}</small>
          <button className="btn" disabled={!!d.mine || t.players >= 9 || user.balance < t.buyIn} onClick={() => setSheet({ join: t })}>
            {t.players >= 9 ? "Table complète" : user.balance < t.buyIn ? "Solde insuffisant" : `Rejoindre (${fmt(t.buyIn)})`}
          </button>
        </div>
      ))}

      {sheet?.create && (
        <PokerBuyIn {...common} title="Créer une table de Poker"
          onSubmit={async (vals) => { const { id } = await api.pokerCreate(vals); onOpen(id); }} />
      )}
      {sheet?.join && (
        <PokerBuyIn {...common} title={`Table #${sheet.join.id} · ${sheet.join.sb}/${sheet.join.bb}`} fixed={{ sb: sheet.join.sb, bb: sheet.join.bb, buyIn: sheet.join.buyIn }}
          onSubmit={async () => { await api.pokerJoin(sheet.join.id); onOpen(sheet.join.id); }} />
      )}
    </div>
  );
}
