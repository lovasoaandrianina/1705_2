import { useEffect, useState } from "react";
import { api } from "../api";
import { fmt } from "../config";
import PokerBuyIn from "../components/PokerBuyIn";

// Page ouverte par le lien d'invitation : infos de la table, puis achat de jetons pour s'asseoir
export default function PokerInvite({ id, user, onOpen, onBack }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState("");
  const [buy, setBuy] = useState(false);

  useEffect(() => {
    api.pokerPublic(id).then((x) => { if (x.inTable) onOpen(id); else setT(x); }).catch((e) => setErr(e.message || "Table introuvable ou fermée"));
  }, [id]);

  return (
    <div className="shell">
      <button className="btn ghost" onClick={onBack}>← Retour</button>
      <h1>Invitation au Poker</h1>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      {!t && !err && <p className="sub">Chargement…</p>}
      {t && (
        <>
          <p className="sub">Table #{t.id} · blindes {t.sb} / {t.bb} · {t.players.length}/9 joueurs</p>
          <div className="info">
            Texas Hold'em No-Limit, cash game. Buy-in fixé par le créateur : <b>{fmt(t.buyIn)}</b> pour tous les joueurs. Tu joues, et tu récupères tes jetons sur ton solde en quittant la table (quand le bouton dealer est sur toi).<br />
            À table : {t.players.join(", ") || "personne"}.<br />
            Ton solde : <b>{fmt(user.balance)}</b>.
          </div>
          <button className="btn gold" style={{ width: "100%", marginTop: 14 }} disabled={t.full || user.balance < t.buyIn} onClick={() => setBuy(true)}>
            {t.full ? "Table complète" : user.balance < t.buyIn ? "Solde insuffisant" : `Rejoindre avec ${fmt(t.buyIn)}`}
          </button>
          {buy && (
            <PokerBuyIn title={`Table #${t.id} · ${t.sb}/${t.bb}`} fixed={{ sb: t.sb, bb: t.bb, buyIn: t.buyIn }} minBuy={t.minBuy} maxBuy={t.maxBuy} balance={user.balance}
              onClose={() => setBuy(false)} onSubmit={async () => { await api.pokerJoin(t.id); onOpen(t.id); }} />
          )}
        </>
      )}
    </div>
  );
}
