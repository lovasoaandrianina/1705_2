import { useState } from "react";
import { api } from "../api";
import { fmt, MIN_STAKE, MAX_STAKE } from "../config";

// Fin de partie (Rami / Domino) : bouton « Rejouer » + re-mise possible (surtout pour les perdants).
// Le premier qui clique crée la revanche avec la mise choisie ; les autres joueurs la rejoignent d'un clic.
export default function Rematch({ view, onOpen, lost = 0 }) {
  const base = Number(view.stake) || MIN_STAKE;
  const [stake, setStake] = useState(base);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const rm = view.rematch;
  const clamp = (n) => Math.min(MAX_STAKE, Math.max(MIN_STAKE, Math.round(Number(n) || base)));
  const go = async (fn) => {
    setErr(""); setBusy(true);
    try { const id = await fn(); onOpen(id); } catch (e) { setErr(e.message); setBusy(false); }
  };

  if (rm) {
    const full = !rm.joined && rm.players >= rm.maxPlayers;
    return (
      <div className="rematch"><style>{REMATCH_CSS}</style>
        <div className="rm-t">🔁 Revanche proposée par {rm.creator}</div>
        <div className="rm-s">Mise {fmt(rm.stake)} · {rm.players}/{rm.maxPlayers} joueurs</div>
        {rm.status !== "waiting" ? <div className="rm-s">La revanche est déjà lancée.</div> : (
          <button className="gold go big" disabled={busy || full} onClick={() => go(async () => { if (!rm.joined) await api.joinTable(rm.id); return rm.id; })}>
            {rm.joined ? "Aller à la revanche" : full ? "Table complète" : `Rejoindre (mise ${fmt(rm.stake)})`}
          </button>
        )}
        {err && <div className="rm-e">{err}</div>}
      </div>
    );
  }
  return (
    <div className="rematch"><style>{REMATCH_CSS}</style>
      <div className="rm-t">🔁 Rejouer</div>
      <div className="rm-s">{lost > 0 ? `Tu as perdu ${fmt(lost)} : tu peux re-miser pour te refaire. ` : ""}Choisis la mise de la revanche :</div>
      <div className="rm-chips">
        <button type="button" className={stake === base ? "on" : ""} onClick={() => setStake(base)}>Même mise</button>
        <button type="button" className={stake === clamp(base * 2) && stake !== base ? "on" : ""} onClick={() => setStake(clamp(base * 2))}>×2</button>
        {lost > 0 && clamp(lost) !== base && clamp(lost) !== clamp(base * 2) && <button type="button" className={stake === clamp(lost) ? "on" : ""} onClick={() => setStake(clamp(lost))}>Ma perte</button>}
      </div>
      <input className="rm-in" type="number" inputMode="numeric" min={MIN_STAKE} max={MAX_STAKE} step="500" value={stake} onChange={(e) => setStake(e.target.value)} />
      <button className="gold go big" disabled={busy} onClick={() => go(async () => (await api.rematchTable(view.id, clamp(stake))).id)}>Rejouer · mise {fmt(clamp(stake))}</button>
      {err && <div className="rm-e">{err}</div>}
    </div>
  );
}

export const REMATCH_CSS = `.rematch{margin:10px 0;padding:10px 12px;border-radius:12px;background:#0000003d;border:1px solid #ffd54a66;text-align:center}
.rm-t{font-weight:800;color:#ffd54a;font-size:15px}.rm-s{font-size:12px;opacity:.9;margin:4px 0 8px}.rm-e{font-size:12px;color:#ff9b9b;margin-top:6px}
.rm-chips{display:flex;gap:6px;justify-content:center;margin-bottom:8px}
.rm-chips button{padding:5px 12px;border-radius:999px;border:1px solid #fff6;background:#ffffff1f;color:#fff;font-size:12px;font-weight:700;cursor:pointer}
.rm-chips button.on{background:#ffd54a;color:#2b2200;border-color:#ffd54a}
.rm-in{width:130px;padding:7px;border-radius:8px;border:1px solid #fff6;background:#00000040;color:#fff;font:inherit;text-align:center;margin:0 auto 8px;display:block}`;
