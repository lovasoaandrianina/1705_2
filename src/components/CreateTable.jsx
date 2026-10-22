import { useState } from "react";
import { api } from "../api";
import { fmt, pct, MIN_STAKE, MAX_STAKE } from "../config";

const Chk = ({ checked, onChange, children }) => (
  <label className="chk"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);
const Prize = ({ label, v, set }) => (
  <label className="chk">
    <input type="checkbox" checked={v.on} onChange={(e) => set({ ...v, on: e.target.checked })} />{label}
    {v.on && <input className="amt" type="number" inputMode="numeric" min="1" value={v.amount} onChange={(e) => set({ ...v, amount: e.target.value })} />}
  </label>
);

export default function CreateTable({ onClose, onCreated, feeBps = 350 }) {
  const [max, setMax] = useState(5);
  const [stake, setStake] = useState(5000);
  const [needSet, setNeedSet] = useState(false);
  const [needRun, setNeedRun] = useState(false);
  const [joker, setJoker] = useState(true);
  const [x2, setX2] = useState(false);
  const [carre, setCarre] = useState({ on: false, amount: 5000 });
  const [ten, setTen] = useState({ on: false, amount: 10000 });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const free = !needSet && !needRun;
  const pot = Number(stake) * max;
  const prizes = (carre.on ? Number(carre.amount) : 0) + (ten.on ? Number(ten.amount) : 0);
  const tooMuch = prizes > Number(stake) * (max - 1);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { id } = await api.createTable({
        stake: Number(stake), maxPlayers: max, rules: { needSet, needRun, joker },
        options: { x2, carre: { on: carre.on, amount: Number(carre.amount) }, ten: { on: ten.on, amount: Number(ten.amount) } },
      });
      onCreated(id);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="head"><b style={{ fontSize: 18 }}>Créer une table</b><button type="button" className="btn ghost" onClick={onClose}>Fermer</button></div>

        <div className="sec">Joueurs (3 minimum, 5 maximum)</div>
        <div className="tabs">{[3, 4, 5].map((n) => <button type="button" key={n} className={`btn ${max === n ? "on" : ""}`} onClick={() => setMax(n)}>{n}</button>)}</div>

        <label className="field">Mise par joueur ({fmt(MIN_STAKE)} à {fmt(MAX_STAKE)})
          <input type="number" inputMode="numeric" min={MIN_STAKE} max={MAX_STAKE} step="500" value={stake} onChange={(e) => setStake(e.target.value)} required />
        </label>

        <div className="sec">Règles</div>
        <Chk checked={free} onChange={() => { setNeedSet(false); setNeedRun(false); }}>Libre (aucune obligation)</Chk>
        <Chk checked={needSet} onChange={setNeedSet}>1 brelan obligatoire</Chk>
        <Chk checked={needRun} onChange={setNeedRun}>1 suite obligatoire</Chk>
        <Chk checked={joker} onChange={setJoker}>Avec joker (décoché = sans joker)</Chk>

        <div className="sec">Options (prises dans le pot)</div>
        <Prize label="Carré : prime au 1er qui l'a" v={carre} set={setCarre} />
        <Prize label="10 cartes : prime au 1er" v={ten} set={setTen} />
        <Chk checked={x2} onChange={setX2}>×2 proposé aux joueurs si le sabot est terminé</Chk>

        <div className="info">
          Chaque joueur verse sa mise dans le pot : <b>{fmt(pot)}</b> à table pleine.
          {carre.on && <> Le premier carré touche {fmt(carre.amount)}.</>}
          {ten.on && <> Le premier à 10 cartes en combinaisons touche {fmt(ten.amount)}.</>}
          {" "}Le gagnant empoche le reste : <b>{fmt(pot - prizes)}</b>.
          {(carre.on || ten.on) && <> <b>Carré</b> = 4 cartes identiques <i>ou</i> une suite de 4 (ex. J-Q-K-A). <b>10 cartes</b> = 10 cartes en combinaisons.
            Ni l'un ni l'autre ne peut contenir de joker. Le joueur appuie sur le bouton de l'écran pour le réclamer : le premier à réussir touche la prime.</>}
          {x2 && <> Le ×2 n'est proposé (vote, il faut l'accord de tous) que lorsque le sabot est réellement terminé : rien n'est prélevé avant.</>}
        </div>
        {tooMuch && <div className="err">Les primes ne peuvent pas dépasser {fmt(Number(stake) * (max - 1))} (le gagnant garde au moins une mise).</div>}
        {err && <div className="err">{err}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy || tooMuch}>{busy ? "…" : "Créer la table"}</button>
      </form>
    </div>
  );
}
