import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmt } from "../config";
import SoundToggle from "../components/SoundToggle";
import ChatDock from "../components/Chat";
import { play, useWatch } from "../sound";
import "./Poker.css";

const SUIT = ["♣", "♦", "♥", "♠"];
const RANK = (r) => ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[r] || String(r));
const num = (n) => Number(n || 0).toLocaleString("fr-FR");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function Card({ c, size = "", flip = false, delay = 0 }) {
  if (c === null || c === undefined) return <div className={`pk-card back ${size}`} />;
  const r = (c % 13) + 2, s = Math.floor(c / 13);
  const face = <div className={`pk-card ${size} ${s === 1 || s === 2 ? "red" : ""}`}><b>{RANK(r)}</b><i>{SUIT[s]}</i></div>;
  if (!flip) return face;
  // la carte arrive face cachée, patiente, puis se retourne (suspense) ; un éclat doré la souligne
  return (
    <div className={`pk-flip ${size}`} style={{ "--d": `${delay}s` }}>
      <div className="pk-flipin">
        <div className={`pk-card back ${size} face`} />
        {face}
      </div>
    </div>
  );
}

const actText = (a) => {
  if (!a) return "";
  return { fold: "Couché", check: "Check", call: `Suit ${num(a.amt)}`, bet: `Mise ${num(a.amt)}`, raise: `Relance ${num(a.amt)}`, allin: `TAPIS ${num(a.amt)}`, sb: "Petite blinde", bb: "Grosse blinde" }[a.t] || "";
};

// Position d'un siège sur l'ovale : r = 0 en bas (moi), puis dans le sens des aiguilles d'une montre
const place = (r) => {
  const a = ((90 + r * 40) * Math.PI) / 180;
  return { x: 50 + 40 * Math.cos(a), y: 50 + 42 * Math.sin(a) };
};

export default function PokerTable({ id, user, onExit }) {
  const [v, setV] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [raise, setRaise] = useState(0);
  const [out, setOut] = useState(null);       // résultat du retrait (ou départ forcé)
  const [leaving, setLeaving] = useState(false);
  const [sheet, setSheet] = useState(null);   // null | "rules" | "rebuy" | "invite"
  const [copied, setCopied] = useState(false);
  const [add, setAdd] = useState(2000);
  const [, force] = useState(0);

  const load = useCallback(() => {
    if (leaving) return;
    api.pokerTable(id).then((d) => { setV({ ...d, fetchedAt: Date.now() }); setErr(""); })
      .catch((e) => { if (/pas assis/i.test(e.message)) setOut((o) => o || { kicked: true }); else setErr(e.message); });
  }, [id, leaving]);
  useEffect(() => { load(); const t = setInterval(load, 900); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 250); return () => clearInterval(t); }, []);

  const L = v?.legal || null;
  const key = v ? `${v.handNo}-${v.street}-${v.toAct}-${L?.minTo}` : "";
  useEffect(() => { if (L) setRaise(L.minTo); setNote(""); }, [key]); // eslint-disable-line

  /* ── sons : actions des autres joueurs, distribution, suspense du flop / turn / river, fin de main ── */
  const readyRef = useRef(false);
  const seatSigs = v ? v.seats.map((s) => (s.lastAct ? `${v.handNo}${v.street}${s.lastAct.t}${s.lastAct.amt || ""}` : "")) : [];
  const sigKey = seatSigs.join("|");
  const prevSigs = useRef(null);
  useEffect(() => {
    if (!v) return;
    const prev = prevSigs.current;
    prevSigs.current = seatSigs;
    if (!prev) return;
    seatSigs.forEach((sig, i) => {
      if (!sig || sig === prev[i]) return;
      const t = v.seats[i].lastAct.t;
      if (t === "fold") play("fold"); else if (t === "check") play("check"); else if (t === "call") play("chip");
      else if (t === "bet" || t === "raise") play("bet"); else if (t === "allin") play("allin");
    });
  }, [sigKey]); // eslint-disable-line
  useWatch(v?.handNo, (n, p) => { if (readyRef.current && p !== undefined) play("deal"); });
  useWatch(!!v?.legal, (n) => readyRef.current && n && play("turn"));
  useWatch(!!v?.sd, (n) => readyRef.current && n && play("riser", 1.8));
  useWatch(v && v.phase === "between" && v.last ? v.last.n : 0, (n) => {
    if (!readyRef.current || !n) return;
    play(v.last.winners.some((w) => w.seat === v.me) ? "win" : "pot");
    if (!v.last.uncontested) setTimeout(() => play("flip"), 400);
  });
  const tickLeft = v && v.legal ? Math.ceil(Math.max(0, v.msLeft - (Date.now() - v.fetchedAt)) / 1000) : 0;
  useWatch(tickLeft > 0 && tickLeft <= 5 ? tickLeft : 0, (s) => s && play("tick"));
  useEffect(() => { if (v) readyRef.current = true; }, [!!v]); // eslint-disable-line

  if (out) {
    return (
      <div className="pk-app"><div className="pk-box" style={{ margin: "auto" }}>
        {out.kicked ? (
          <>
            <h3>Tu as quitté la table</h3>
            <p>Tu étais inactif (2 tours sans jouer) ou ta table a été fermée : tes jetons ont été recrédités sur ton solde.</p>
          </>
        ) : (
          <>
            <h3>{out.net > 0 ? `Tu repars avec +${fmt(out.net)}` : out.net < 0 ? `Tu repars avec ${fmt(out.net)}` : "Tu repars à égalité"}</h3>
            <div className="recap">
              <div><span>Jetons achetés</span><span>{fmt(out.invested ?? out.payout)}</span></div>
              <div><span>Jetons retirés</span><span>{fmt(out.payout)}</span></div>
              <div className="tot"><span>Ajouté à ton solde</span><span>{fmt(out.received)}</span></div>
            </div>
          </>
        )}
        <button className="gold big" onClick={onExit}>Retour</button>
      </div></div>
    );
  }
  if (!v) return <div className="shell center">{err || "Chargement…"}</div>;

  const me = v.me, seated = me >= 0, mine = v.mine;
  const now = Date.now();
  const left = Math.max(0, v.msLeft - (now - v.fetchedAt));
  const myTurn = !!L && !busy;
  const mySeat = seated ? v.seats[me] : null;
  const curBet = L && mySeat ? mySeat.bet + L.toCall : 0;
  const count = v.seats.filter((s) => !s.empty).length;
  const link = `${window.location.origin}/?poker=${id}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* copie manuelle */ } };
  const share = () => navigator.share({ title: "Poker entre amis", text: `Rejoins ma table de Poker (#${id}) !`, url: link }).catch(() => {});
  const winners = v.phase === "between" && v.last ? v.last.winners : [];
  const isWinner = (i) => winners.some((w) => w.seat === i);
  const total = (mine?.stack || 0) + (mine?.pendingAdd || 0);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true); setNote("");
    try { const d = await fn(); if (d) setV({ ...d, fetchedAt: Date.now() }); return true; }
    catch (e) { setNote(e.message); return false; } finally { setBusy(false); }
  };
  const act = (a) => run(() => api.pokerAction(id, a));
  const sized = (frac) => setRaise(clamp(Math.round((curBet + frac * (v.pot + L.toCall)) / v.sb) * v.sb, L.minTo, L.maxTo));
  const canLeave = !v.leave || v.leave.ok;
  const leaveNote = canLeave ? "" : `Tu pourras quitter la table quand le bouton dealer (D) sera sur toi : dans ${v.leave.in} main${v.leave.in > 1 ? "s" : ""}`;
  const quit = async () => {
    if (!canLeave) { setNote(leaveNote); return; }
    if (!window.confirm(`Quitter la table ? Tes ${fmt(total)} de jetons seront recrédités sur ton solde.${v.phase === "hand" && mySeat && !mySeat.folded ? " Ta main en cours sera couchée." : ""}`)) return;
    setLeaving(true);
    try { const r = await api.pokerLeave(id); setOut({ ...r, invested: r.invested ?? mine.invested }); }
    catch (e) { setLeaving(false); setNote(e.message); }
  };

  const msg = note
    || (!seated ? "Tu seras assis à la prochaine main…"
    : mine.leaving ? "Tu quittes la table…"
    : mine.busted ? "Tu n'as plus de jetons : recharge pour continuer"
    : count < 2 ? "En attente d'autres joueurs : partage le lien d'invitation"
    : v.phase === "between" ? (v.last ? "" : "Prochaine main…")
    : v.sd ? "Les mains vont être dévoilées…"
    : v.runout ? (v.street === "flop" ? "Le flop…" : v.street === "turn" ? "La turn…" : v.street === "river" ? "La river…" : "")
    : myTurn ? `À toi de jouer · ${Math.ceil(left / 1000)} s`
    : v.toAct >= 0 ? `Tour de ${v.seats[v.toAct].name} · ${Math.ceil(left / 1000)} s` : "");

  return (
    <div className="pk-app">
      <div className="pk-top">
        <button className="pk-link" onClick={() => (seated ? quit() : onExit())}>← Quitter</button>
        <span>Blindes {num(v.sb)}/{num(v.bb)} · main #{v.handNo}</span>
        <span><SoundToggle className="pk-link" style={{ textDecoration: "none" }} /> · <button className="pk-link" onClick={() => setSheet("invite")}>Inviter</button> · <button className="pk-link" onClick={() => setSheet("rules")}>Règles</button></span>
      </div>

      <div className="pk-table">
        <div className="pk-felt" />
        <div className="pk-center">
          <div className="pk-board">
            {Array.from({ length: 5 }, (_, k) => (v.board[k] !== undefined ? <Card key={`${v.handNo}-${k}`} c={v.board[k]} flip delay={k < 3 ? 0.5 + k * 0.8 : 0.9} /> : <div key={k} className="pk-slot" />))}
          </div>
          {count < 2 && <button className="pk-invite" onClick={() => setSheet("invite")}>＋ Inviter des amis</button>}
          {v.pot > 0 && <div className="pk-pot">Pot {num(v.pot)}</div>}
          {v.refund && <small className="pk-refund">↩ {num(v.refund.amount)} Ar non suivis rendus à {v.refund.seat === me ? "toi" : v.refund.name}</small>}
          {winners.length > 0 && (
            <div className="pk-win">
              {winners.map((w) => <div key={w.seat}>🏆 {w.name} +{num(w.amount)}{w.hand ? ` · ${w.hand}` : ""}</div>)}
              {winners.some((w) => w.fee) && <small className="pk-fee">commission −{num(winners.reduce((a, w) => a + (w.fee || 0), 0))}</small>}
            </div>
          )}
          {v.phase === "between" && <small className="pk-next">Prochaine main dans {Math.ceil(Math.max(0, v.nextMs - (now - v.fetchedAt)) / 1000)} s</small>}
        </div>

        {v.seats.map((s) => {
          const r = (s.i - Math.max(0, me) + 9) % 9, p = place(r), c = { x: 50 + (p.x - 50) * 0.58, y: 50 + (p.y - 50) * 0.58 };
          const isMe = s.i === me, turn = v.toAct === s.i && v.phase === "hand" && !v.runout;
          const showCards = s.cards.length > 0 && !isMe;
          if (s.empty) return <div key={s.i} className="pk-seat empty" style={{ left: `${p.x}%`, top: `${p.y}%` }}>Libre</div>;
          return (
            <div key={s.i}>
              <div className={`pk-seat ${isMe ? "me" : ""} ${turn ? "turn" : ""} ${s.folded ? "fold" : ""} ${isWinner(s.i) ? "won" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                {showCards && <div className="pk-hole">{s.cards.map((c, k) => <Card key={`${v.handNo}-${k}`} c={c} size="xs" flip={v.phase === "between" && c !== null} delay={0.3 + k * 0.4} />)}</div>}
                <b>{isMe ? "Moi" : s.name}</b>
                <span>{num(s.stack)}</span>
                {s.handName && <small className="hn">{s.handName}</small>}
                {!s.handName && s.lastAct && <small>{actText(s.lastAct)}</small>}
                {s.allin && !s.lastAct && <small>TAPIS</small>}
                {v.button === s.i && <i className="pk-dealer">D</i>}
              </div>
              {s.bet > 0 && <div className="pk-bet" style={{ left: `${c.x}%`, top: `${c.y}%` }}>{num(s.bet)}</div>}
            </div>
          );
        })}
      </div>

      <div className="pk-tbar"><i style={{ width: `${myTurn || (v.toAct >= 0 && v.phase === "hand" && !v.runout) ? clamp((left / v.turnMs) * 100, 0, 100) : 0}%` }} /></div>
      <div className="pk-msg">{msg}</div>

      <div className="pk-me">
        <div className="pk-mycards">
          {seated && mySeat.cards.length === 2 && v.phase === "hand" && mySeat.inHand
            ? mySeat.cards.map((c, k) => <Card key={`${v.handNo}-${k}`} c={c} size="lg" />)
            : <div className="pk-nocards">{seated ? "En attente de la main" : ""}</div>}
        </div>
        <div className="pk-mine">
          {v.myHand && !v.runout && <b>{v.myHand}</b>}
          {seated && <small>Mes jetons : {fmt(total)}{mine.pendingAdd ? ` (dont ${fmt(mine.pendingAdd)} dès la prochaine main)` : ""}</small>}
        </div>
      </div>

      {myTurn && (
        <div className="pk-actions">
          <button className="red" onClick={() => act({ type: "fold" })}>Se coucher</button>
          <button onClick={() => act({ type: L.canCheck ? "check" : "call" })}>
            {L.canCheck ? "Check" : L.toCall >= mine.stack ? `Tapis ${num(L.toCall)}` : `Suivre ${num(L.toCall)}`}
          </button>
          {L.canRaise && (
            <button className="gold" onClick={() => act({ type: "raise", to: raise })}>
              {raise >= L.maxTo ? `Tapis ${num(L.maxTo)}` : `${curBet === 0 ? "Miser" : "Relancer à"} ${num(raise)}`}
            </button>
          )}
        </div>
      )}
      {myTurn && L.canRaise && (
        <div className="pk-size">
          <input type="range" min={L.minTo} max={L.maxTo} step={Math.max(1, v.sb)} value={clamp(raise, L.minTo, L.maxTo)} onChange={(e) => setRaise(Number(e.target.value))} />
          <div>
            <button onClick={() => sized(0.5)}>½ pot</button>
            <button onClick={() => sized(0.75)}>¾ pot</button>
            <button onClick={() => sized(1)}>Pot</button>
            <button onClick={() => setRaise(L.maxTo)}>Tapis</button>
          </div>
        </div>
      )}
      {myTurn && L.noRaise && <div className="pk-msg">Relance impossible (relance incomplète d'un joueur à tapis)</div>}

      {seated && !mine.leaving && (
        <div className="pk-foot">
          {total < v.maxBuy && (!mine.busted || v.buyIn <= v.maxBuy) && <button onClick={() => { setAdd(mine.busted ? v.buyIn : Math.min(2000, v.maxBuy - total)); setSheet("rebuy"); }}>{mine.busted ? "Racheter des jetons" : "Recharger"}</button>}
          <button className={canLeave ? "" : "dim"} onClick={quit}>{canLeave ? "Quitter et encaisser" : `Quitter : bouton D dans ${v.leave.in} main${v.leave.in > 1 ? "s" : ""}`}</button>
        </div>
      )}
      {!seated && <div className="pk-foot"><button onClick={quit}>Annuler et me faire rembourser</button></div>}

      <ChatDock kind="poker" id={id} me={user} enabled={seated} />

      {sheet === "rules" && (
        <div className="pk-ov" onClick={() => setSheet(null)}>
          <div className="pk-box">
            <h3>Règles de la table</h3>
            <p>Texas Hold'em No-Limit, cash game, de 2 à 9 joueurs (la main démarre dès que deux joueurs sont assis). Chacun reçoit 2 cartes, 5 cartes communes sont dévoilées (flop, turn, river). Le meilleur jeu de 5 cartes gagne le pot ; les pots annexes gèrent les joueurs à tapis.</p>
            <p>Blindes {num(v.sb)} / {num(v.bb)}. Relance minimum = la dernière relance (au moins la grosse blinde). Tu as {v.turnMs / 1000} s par décision ; deux tours sans réponse et tu es retiré de la table (tes jetons te sont rendus). Tu ne peux quitter la table que lorsque le bouton dealer (D) est sur toi.</p>
            <p>Buy-in de la table : {fmt(v.buyIn)}, le même pour tous. Si tu n'as plus de jetons, tu peux racheter le buy-in ; ton tapis ne peut pas dépasser {fmt(v.maxBuy)}.</p>
            <button className="gold" onClick={() => setSheet(null)}>Fermer</button>
          </div>
        </div>
      )}
      {sheet === "invite" && (
        <div className="pk-ov" onClick={() => setSheet(null)}>
          <div className="pk-box" onClick={(e) => e.stopPropagation()}>
            <h3>Inviter des amis</h3>
            <p>Envoie ce lien : ils s'inscrivent (ou se connectent), achètent leurs jetons et arrivent directement à cette table (jusqu'à 9 joueurs).</p>
            <div className="pk-linkbox">{link}</div>
            <button className="gold" onClick={copy}>{copied ? "Lien copié ✓" : "Copier le lien"}</button>
            {navigator.share && <button onClick={share}>Partager</button>}
            <button onClick={() => setSheet(null)}>Fermer</button>
          </div>
        </div>
      )}
      {sheet === "rebuy" && (
        <div className="pk-ov" onClick={() => setSheet(null)}>
          <div className="pk-box" onClick={(e) => e.stopPropagation()}>
            <h3>{mine.busted ? "Racheter des jetons" : "Recharger"}</h3>
            {mine.busted ? (
              <p>Rachat du buy-in de la table : <b>{fmt(v.buyIn)}</b>. Solde : {fmt(user.balance)}.</p>
            ) : (
              <>
                <p>Tu as {fmt(total)}. Maximum à table : {fmt(v.maxBuy)} (recharge possible : {fmt(v.maxBuy - total)}). Solde : {fmt(user.balance)}.</p>
                <input className="pk-in" type="number" inputMode="numeric" min="500" max={v.maxBuy - total} step="500" value={add} onChange={(e) => setAdd(e.target.value)} />
              </>
            )}
            {note && <p style={{ color: "#ff9d9d" }}>{note}</p>}
            <button className="gold" onClick={async () => { if (await run(() => api.pokerRebuy(id, mine.busted ? v.buyIn : Math.round(Number(add))))) setSheet(null); }}>Valider</button>
            <button onClick={() => setSheet(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
