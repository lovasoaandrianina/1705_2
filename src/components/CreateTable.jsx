import { useState } from "react";
import { api } from "../api";
import { fmt, pct, MIN_STAKE, MAX_STAKE } from "../config";
import SetCard from "./SetCard";

const Chk = ({ checked, onChange, children }) => (
  <label className="chk"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);
const Prize = ({ label, v, set }) => (
  <label className="chk">
    <input type="checkbox" checked={v.on} onChange={(e) => set({ ...v, on: e.target.checked })} />{label}
    {v.on && <input className="amt" type="number" inputMode="numeric" min="1" value={v.amount} onChange={(e) => set({ ...v, amount: e.target.value })} />}
  </label>
);

// Prime 7 / 10 cartes : montant + règle « libre » ou « avec tri / suite obligatoire(s) »
const PrizeReq = ({ label, v, set }) => (
  <>
    <Prize label={label} v={v} set={set} />
    {v.on && (
      <div className="subopts">
        <Chk checked={!v.needSet && !v.needRun} onChange={() => set({ ...v, needSet: false, needRun: false })}>Libre (tri ou suite, au choix)</Chk>
        <Chk checked={!!v.needSet} onChange={(x) => set({ ...v, needSet: x })}>Avec au moins un tri obligatoire</Chk>
        <Chk checked={!!v.needRun} onChange={(x) => set({ ...v, needRun: x })}>Avec au moins une suite obligatoire</Chk>
      </div>
    )}
  </>
);

export default function CreateTable({ onClose, onCreated, feeBps = 350 }) {
  const [max, setMax] = useState(4);
  const [stake, setStake] = useState(5000);
  const [needSet, setNeedSet] = useState(false);
  const [needRun, setNeedRun] = useState(false);
  const [joker, setJoker] = useState(true);
  const [x2, setX2] = useState(false);
  const [carre, setCarre] = useState({ on: false, amount: 5000 });
  const [ten, setTen] = useState({ on: false, amount: 10000, needSet: false, needRun: false });
  const [prime, setPrime] = useState({ on: false, amount: 5000, needSet: false, needRun: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const free = !needSet && !needRun;
  const pot = Number(stake) * max;
  const prizes = (carre.on ? Number(carre.amount) : 0) + (ten.on ? Number(ten.amount) : 0) + (prime.on ? Number(prime.amount) : 0);
  const tooMuch = prizes > Number(stake) * (max - 1);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { id } = await api.createTable({
        stake: Number(stake), maxPlayers: max, rules: { needSet, needRun, joker },
        options: { x2, carre: { on: carre.on, amount: Number(carre.amount) }, ten: { on: ten.on, amount: Number(ten.amount), needSet: ten.needSet, needRun: ten.needRun }, prime: { on: prime.on, amount: Number(prime.amount), needSet: prime.needSet, needRun: prime.needRun } },
      });
      onCreated(id);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="head"><b style={{ fontSize: 18 }}>Créer une table</b><button type="button" className="btn ghost" onClick={onClose}>Fermer</button></div>

        <SetCard icon="👥" title="Joueurs & mise" hint="Nombre de places et mise de chacun">
          <div className="tabs">{[2, 3, 4, 5].map((n) => <button type="button" key={n} className={`btn ${max === n ? "on" : ""}`} onClick={() => setMax(n)}>{n} joueurs</button>)}</div>
          <label className="field">Mise par joueur ({fmt(MIN_STAKE)} à {fmt(MAX_STAKE)})
            <input type="number" inputMode="numeric" min={MIN_STAKE} max={MAX_STAKE} step="500" value={stake} onChange={(e) => setStake(e.target.value)} required />
          </label>
        </SetCard>

        <SetCard icon="📜" title="Règles de la partie" hint="Obligations pour pouvoir poser / gagner">
          <Chk checked={free} onChange={() => { setNeedSet(false); setNeedRun(false); }}>Libre (aucune obligation)</Chk>
          <Chk checked={needSet} onChange={setNeedSet}>1 brelan obligatoire</Chk>
          <Chk checked={needRun} onChange={setNeedRun}>1 suite obligatoire</Chk>
          <Chk checked={joker} onChange={setJoker}>Avec joker (décoché = sans joker)</Chk>
        </SetCard>

        <SetCard icon="🎁" title="Primes & options" hint="Prélevées sur le pot">
          <Prize label="Carré : prime au 1er qui l'a" v={carre} set={setCarre} />
          <PrizeReq label="7 cartes : prime au 1er" v={prime} set={setPrime} />
          <PrizeReq label="10 cartes : prime au 1er" v={ten} set={setTen} />
          <Chk checked={x2} onChange={setX2}>×2 proposé aux joueurs si le sabot est terminé</Chk>
          {(carre.on || ten.on || prime.on) && <div className="info"><b>Carré</b> = 4 identiques (4-4-4-4) ou suite de 4 (2-3-4-5). <b>7 cartes</b> = un carré + un tri ou une suite de 3. <b>10 cartes</b> = un carré + deux combinaisons de 3 (tri ou suite). <b>Sans joker</b> : chaque carte compte pour elle-même (un 8♠ joker reste un 8♠ normal). Premier à réclamer touche la prime ; ses cartes sont montrées à tous pendant 30 s.</div>}
          {x2 && <div className="info">Le ×2 n'est proposé (vote, il faut l'accord de tous) que lorsque le sabot est réellement terminé : rien n'est prélevé avant.</div>}
        </SetCard>

        {/* <SetCard icon="💰" title="Récapitulatif du pot" tone="recap">
          <div className="info">
            Chaque joueur verse sa mise dans le pot : <b>{fmt(pot)}</b> à table pleine.
            {carre.on && <> Le premier carré touche {fmt(carre.amount)}.</>}
            {ten.on && <> Le premier à 10 cartes en combinaisons touche {fmt(ten.amount)}.</>}
            {" "}Le gagnant empoche le reste : <b>{fmt(pot - prizes)}</b>.
          </div>
        </SetCard> */}
        {tooMuch && <div className="err">Les primes ne peuvent pas dépasser {fmt(Number(stake) * (max - 1))} (le gagnant garde au moins une mise).</div>}
        {err && <div className="err">{err}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy || tooMuch}>{busy ? "…" : "Créer la table"}</button>
      </form>
    </div>
  );
}
