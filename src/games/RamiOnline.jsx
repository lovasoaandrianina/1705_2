import { useEffect, useRef, useState } from "react";
import { Card, Opp, css, isJoker } from "./Rami";
import { fmt } from "../config";
import SoundToggle from "../components/SoundToggle";
import { play, useWatch } from "../sound";

// Zones d'atterrissage des cartes jetées, selon la place du joueur suivant à l'écran
const ZONES = {
  bottom: { x: [25, 75], y: [68, 92] }, left: { x: [6, 32], y: [30, 70] }, topL: { x: [8, 45], y: [6, 30] },
  top: { x: [25, 75], y: [6, 30] }, topR: { x: [55, 92], y: [6, 30] }, right: { x: [68, 94], y: [30, 70] },
};
const START = { bottom: [50, 110], left: [-6, 50], topL: [18, -6], top: [50, -6], topR: [82, -6], right: [106, 50] };
const SLOTS = { 2: ["bottom", "top"], 3: ["bottom", "left", "right"], 4: ["bottom", "left", "top", "right"], 5: ["bottom", "left", "topL", "topR", "right"] };

const EXTRA = `.claims{font-size:11px;text-align:center;padding:3px 8px;background:#0000002e;line-height:1.7}
.pill{display:inline-block;margin-left:6px;padding:1px 9px;border-radius:999px;background:#ffffff22}
.pill.got{background:#ffd54a;color:#2b2200;font-weight:800;cursor:pointer}
.fcards{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px;max-width:300px}
.recap{margin:8px 0;font-size:13px;text-align:left;background:#0000003d;border-radius:10px;padding:8px 12px}
.recap div{display:flex;justify-content:space-between;gap:16px;padding:2px 0}
.recap .fee{color:#ffb4b4}
.recap .tot{border-top:1px solid #fff4;margin-top:4px;padding-top:4px;font-weight:800;color:#ffd54a}
.claimbar{padding:0 10px 2px;gap:5px}
.claimbar button{flex:1;min-width:0;background:#7c3aed;border-color:#b9a2f5;color:#fff;font-size:10px;line-height:1.1;padding:4px 3px;border-radius:9px;min-height:25px}
.claimbar button:disabled{opacity:.45}
.flash{position:absolute;left:50%;top:36%;z-index:250000;display:flex;flex-direction:column;align-items:center;gap:2px;padding:16px 30px;
  border-radius:20px;background:#ffd54a;color:#2b2200;text-align:center;pointer-events:none;box-shadow:0 0 0 5px #fff9,0 12px 44px #000b;
  animation:flash 7s ease forwards}
.flash b{font-size:32px;letter-spacing:2px}.flash span{font-size:22px;font-weight:800}.flash small{font-size:13px}
@keyframes flash{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}8%{transform:translate(-50%,-50%) scale(1.18);opacity:1}14%{transform:translate(-50%,-50%) scale(1)}85%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}`;

export default function RamiOnline({ view, act, onExit }) {
  const g = view.game, N = g.N, me = g.seat;
  const o = view.config.options, cl = g.claims || {};
  const prev = useRef({ carre: cl.carre ?? null, ten: cl.ten ?? null, prime: cl.prime ?? null });
  const [flash, setFlash] = useState(null); // bannière plein écran quand quelqu'un décroche une prime
  const [showClaim, setShowClaim] = useState(null); // « carre » | « ten » : revoir les cartes d'une prime
  useEffect(() => {
    for (const [k, label, amt] of [["carre", "CARRÉ", o.carre?.amount], ["ten", "10 CARTES", o.ten?.amount], ["prime", "PRIME", o.prime?.amount]]) {
      const now = cl[k] ?? null;
      if (now !== null && prev.current[k] === null) {
        play("claim");
        setFlash({ id: Date.now(), label, amt, who: now === me ? "Toi !" : g.names[now], groups: (g.claimCards || {})[k] || [] });
        setTimeout(() => setFlash(null), 7000);
      }
      prev.current[k] = now;
    }
  }, [cl.carre, cl.ten]);
  const [sel, setSel] = useState(null);
  const [order, setOrder] = useState(() => g.hand.map((c) => c.id));
  const [mode, setMode] = useState("suit");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const hd = useRef(null), td = useRef(null), tableRef = useRef(null), handRef = useRef(null);
  const [ghost, setGhost] = useState(null); // copie de la carte qui suit le doigt
  const [pos, setPos] = useState({});        // positions des cartes déplacées sur la table (visuel local)
  const [zup, setZup] = useState({});
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // l'ordre de ma main m'appartient : le serveur n'envoie que les cartes
  const key = g.hand.map((c) => c.id).join();
  useEffect(() => {
    const ids = g.hand.map((c) => c.id);
    setOrder((o) => { const keep = o.filter((i) => ids.includes(i)); return [...keep, ...ids.filter((i) => !keep.includes(i))]; });
  }, [key]);
  const byId = Object.fromEntries(g.hand.map((c) => [c.id, c]));
  const cards = order.map((i) => byId[i]).filter(Boolean);

  const run = async (a) => {
    if (busy) return false;
    setBusy(true); setNote("");
    try { await act(a); return true; } catch (e) { setNote(e.message); return false; } finally { setBusy(false); }
  };
  const sort = () => {
    const f = mode === "suit" ? (x, y) => x.s - y.s || x.r - y.r : (x, y) => x.r - y.r || x.s - y.s;
    setOrder([...cards].sort(f).map((c) => c.id));
    setMode(mode === "suit" ? "rank" : "suit");
  };
  const quit = () =>
    (g.winner !== null || window.confirm("Tu quittes l'écran, mais la partie continue : ta mise reste engagée et le jeu joue à ta place.")) && onExit();

  const live = g.winner === null;
  const myTurn = live && g.turn === me;
  const canDraw = myTurn && g.phase === "draw", canDiscard = myTurn && g.phase === "discard";
  const inside = (e, el) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 6 && e.clientY <= r.bottom; };
  const clamp = (v) => Math.min(96, Math.max(4, v));

  // Ma main : toucher = sélectionner · glisser = changer la carte de place (jamais de défausse par glisser)
  const hDown = (e) => {
    if (!live) return;
    const el = e.target.closest("[data-id]");
    if (!el) return;
    hd.current = { id: +el.dataset.id, sx: e.clientX, sy: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const hMove = (e) => {
    const k = hd.current;
    if (!k) return;
    if (!k.moved && Math.hypot(e.clientX - k.sx, e.clientY - k.sy) < 6) return;
    k.moved = true;
    setGhost({ id: k.id, x: e.clientX, y: e.clientY });
    const over = [...e.currentTarget.querySelectorAll("[data-id]")].find((el) => inside(e, el) && e.clientY >= el.getBoundingClientRect().top);
    if (over && +over.dataset.id !== k.id)
      setOrder((o) => {
        const a = [...o], from = a.indexOf(k.id), to = a.indexOf(+over.dataset.id);
        if (from < 0 || to < 0) return o;
        a.splice(to, 0, a.splice(from, 1)[0]);
        return a;
      });
  };
  const hUp = () => {
    const k = hd.current;
    hd.current = null;
    setGhost(null);
    if (!k) return;
    if (!k.moved) {
      setSel((s) => (s === k.id ? null : k.id));
      play("click");
      setNote(isJoker(byId[k.id], g.joker) ? "Un joker ne peut pas être jeté" : "");
    }
    // glisser = seulement changer la carte de place : jeter ou remettre se fait uniquement avec les boutons
  };

  // Cartes de la table : glisser pour les déplacer · glisser la dernière jusqu'à ma main = la prendre
  const tDown = (e, id, x, y) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    td.current = { id, sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false, rect: tableRef.current.getBoundingClientRect() };
    setZup((z) => ({ ...z, [id]: Math.max(0, ...Object.values(z)) + 1 }));
  };
  const tMove = (e) => {
    const k = td.current;
    if (!k) return;
    if (!k.moved && Math.hypot(e.clientX - k.sx, e.clientY - k.sy) < 6) return;
    k.moved = true;
    setPos((p) => ({ ...p, [k.id]: { x: clamp(k.ox + ((e.clientX - k.sx) / k.rect.width) * 100), y: clamp(k.oy + ((e.clientY - k.sy) / k.rect.height) * 100) } }));
  };
  const tUp = (e, isTop) => {
    const k = td.current;
    td.current = null;
    if (k && isTop && canDraw && (!k.moved || inside(e, handRef.current))) run({ type: "draw", from: "discard" });
  };
  const secs = Math.max(0, Math.ceil((g.msLeft - (Date.now() - view.fetchedAt)) / 1000));
  /* ── sons ── */
  useWatch(g.turnNo, () => myTurn && play("turn"));
  useWatch(g.stock, (n, p) => n < p && play("draw"));
  useWatch(g.discards.length, (n, p) => play(n > p ? "discard" : "draw"));
  useWatch(g.winner, (w) => w !== null && w !== undefined && play(w === me ? "win" : "lose"));
  useWatch(!!(live && g.vote && !g.vote.done), (n) => n && play("claim"));
  useWatch(myTurn && secs > 0 && secs <= 5 ? secs : 0, (s) => s && play("tick"));
  useEffect(() => { if (g.turnNo === 0) { play("shuffle"); setTimeout(() => play("deal"), 1100); } }, []); // eslint-disable-line

  const msg = note || (live
    ? myTurn
      ? `${g.phase === "draw" ? "À toi : pioche le sabot ou la dernière carte jetée" : g.drawn?.from === "discard" ? "Jette une carte, fais Rami, ou remets la carte prise" : "Jette une carte, ou fais Rami !"} · ${secs}s`
      : `Tour de ${g.names[g.turn]} · ${secs}s`
    : "Partie terminée");

  const slots = SLOTS[N], bySlot = {};
  for (let rel = 1; rel < N; rel++) bySlot[slots[rel]] = rel;
  const opp = (rel) => {
    const s = (me + rel) % N;
    return <Opp key={s} i={s} name={g.names[s]} n={g.counts[s]} active={live && g.turn === s} dur={g.turnMs} tick={g.turnNo} avatar={(g.avatars || [])[s]} horizontal={N === 2} />;
  };
  const drawnCard = g.drawn && byId[g.drawn.id];

  return (
    <div className="app">
      <style>{css + EXTRA}</style>
      <div className="board">
        <div className="top">{["topL", "top", "topR"].filter((k) => bySlot[k] !== undefined).map((k) => opp(bySlot[k]))}</div>
        <div className="left">{bySlot.left !== undefined && opp(bySlot.left)}</div>

        <div className="table" ref={tableRef}>
          {g.discards.map((d, i) => {
            const zn = ZONES[slots[(d.to - me + N) % N]], from = START[slots[(d.from - me + N) % N]];
            const isTop = i === g.discards.length - 1;
            const bx = zn.x[0] + d.u * (zn.x[1] - zn.x[0]), by = zn.y[0] + d.v * (zn.y[1] - zn.y[0]), p = pos[d.card.id];
            return (
              <Card key={d.card.id} c={d.card} sm
                className={`toss ${isTop ? "last" : ""} ${isTop && canDraw ? "grab" : ""} ${isJoker(d.card, g.joker) ? "jk" : ""}`}
                style={{
                  left: `${p ? p.x : bx}%`, top: `${p ? p.y : by}%`,
                  "--r": `${d.rot}deg`, "--fx": `${from[0]}%`, "--fy": `${from[1]}%`, zIndex: 10 + d.z + (zup[d.card.id] ? 1000 + zup[d.card.id] : 0),
                }}
                onPointerDown={(e) => tDown(e, d.card.id, p ? p.x : bx, p ? p.y : by)} onPointerMove={tMove}
                onPointerUp={(e) => tUp(e, isTop)} onPointerCancel={() => (td.current = null)} />
            );
          })}

          {g.joker && (
            <div className="jbadge">JOKER
              <Card sm c={{ r: g.joker.r, s: g.joker.suits[0] }} className="jk" />
              <Card sm c={{ r: g.joker.r, s: g.joker.suits[1] }} className="jk" />
            </div>
          )}
          {g.jInd && g.turnNo === 0 && <Card key="jind" c={g.jInd} className="reveal rj" />}
          {drawnCard && <Card key={g.turnNo} c={drawnCard} className="reveal" />}

          <div className={`sabot ${canDraw ? "grab" : ""}`} onClick={canDraw ? () => run({ type: "draw", from: "stock" }) : undefined}>
            <span className="bk big" /><span className="bk big l2" />
            <span className="cnt">{g.stock}</span>
          </div>
        </div>

        <div className="right">{bySlot.right !== undefined && opp(bySlot.right)}</div>
      </div>

      <div className="claims">
        Pot {fmt(view.pot)}
        {o.carre?.on && <span className={`pill ${cl.carre == null ? "" : "got"}`}>🏆 Carré : {cl.carre == null ? `libre (${fmt(o.carre.amount)})` : `${g.names[cl.carre]}`}</span>}
        {o.prime?.on && <span className={`pill ${cl.prime == null ? "" : "got"}`}>🏆 7 cartes : {cl.prime == null ? `libre (${fmt(o.prime.amount)})` : `${g.names[cl.prime]}`}</span>}
        {o.ten?.on && <span className={`pill ${cl.ten == null ? "" : "got"}`}>🏆 10 cartes : {cl.ten == null ? `libre (${fmt(o.ten.amount)})` : `${g.names[cl.ten]}`}</span>}
        <SoundToggle className="pill" style={{ border: 0, color: "#fff", cursor: "pointer" }} />
        {g.vote?.done && <span className="pill">{g.vote.accepted ? "Mise doublée ×2" : "×2 refusé"}</span>}
      </div>
      <div className="msg">{msg}</div>
      {live && ((o.carre?.on && cl.carre == null) || (o.prime?.on && cl.prime == null) || (o.ten?.on && cl.ten == null)) && (
        <div className="bar claimbar">
          {o.carre?.on && cl.carre == null && <button onClick={() => run({ type: "claim", kind: "carre" })}>🏆 Carré ({fmt(o.carre.amount)})</button>}
          {o.prime?.on && cl.prime == null && <button onClick={() => run({ type: "claim", kind: "prime" })}>🏆 7 cartes ({fmt(o.prime.amount)})</button>}
          {o.ten?.on && cl.ten == null && <button onClick={() => run({ type: "claim", kind: "ten" })}>🏆 10 cartes ({fmt(o.ten.amount)})</button>}
        </div>
      )}
      <div className="bar">
        <button onClick={quit}>← Quitter</button>
        <button disabled={!live} onClick={sort}>Trier {mode === "suit" ? "♠♥♦♣" : "A→K"}</button>
        {canDiscard && g.drawn && g.drawn.from === "discard" && (
          <button onClick={async () => { if (await run({ type: "undo" })) setSel(null); }}>Remettre</button>
        )}
        <button disabled={!canDiscard} onClick={() => run({ type: "rami" })}>Rami !</button>
        <button className="go" disabled={!canDiscard || sel === null || (byId[sel] && isJoker(byId[sel], g.joker))} onClick={async () => { if (await run({ type: "discard", cardId: sel })) setSel(null); }}>Jeter</button>
      </div>

      <div ref={handRef} className={`hand grouped ${myTurn ? "turn" : ""}`} onPointerDown={hDown} onPointerMove={hMove} onPointerUp={hUp} onPointerCancel={() => { hd.current = null; setGhost(null); }}>
        {(() => {
          const sizes = cards.length >= 14 ? [4, 5, 5] : [4, 4, 5];
          let i = 0;
          return sizes.map((sz, gi) => {
            const chunk = cards.slice(i, i + sz);
            i += sz;
            if (!chunk.length) return null;
            return (
              <div key={gi} className="hand-group">
                {chunk.map((c) => (
                  <Card key={c.id} data-id={c.id} c={c} sel={sel === c.id}
                    className={`${g.drawn && g.drawn.id === c.id ? "new" : ""} ${isJoker(c, g.joker) ? "jk" : ""} ${ghost && ghost.id === c.id ? "ph" : ""}`} />
                ))}
              </div>
            );
          });
        })()}
      </div>

      {live && g.vote && !g.vote.done && (
        <div className="ov">
          <div className="box">
            <p>Le sabot est terminé !</p>
            <p style={{ fontSize: 13, fontWeight: 400 }}>
              Doubler la mise ? Chacun ajoute {fmt(view.stake)} au pot ({fmt(view.pot)} → {fmt(view.pot * 2)}). Il faut l'accord de tous.
            </p>
            {g.vote.mine === undefined ? (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button className="go big" onClick={() => run({ type: "vote", accept: true })}>Oui</button>
                <button className="big" onClick={() => run({ type: "vote", accept: false })}>Non</button>
              </div>
            ) : (
              <p style={{ fontSize: 13 }}>Ta réponse : {g.vote.mine ? "oui" : "non"}. En attente des autres… {g.vote.voted}/{N}</p>
            )}
            {note && <p style={{ fontSize: 12, color: "#ff9b9b" }}>{note}</p>}
          </div>
        </div>
      )}

      {flash && <div className="flash" key={flash.id}><b>{flash.label} !</b><span>{flash.who}</span><small>prime de {fmt(flash.amt)} sur le pot · cartes montrées à tous</small><div className="fcards">{flash.groups.map((grp, i) => <div key={i} className="grp">{grp.map((c) => <Card key={c.id} sm c={c} />)}</div>)}</div></div>}

      {showClaim && cl[showClaim] != null && (
        <div className="ov" 
        // onClick={() => setShowClaim(null)}
        >
          <div className="box wide">
            <p>{showClaim === "carre" ? "Carré" : "10 cartes"} de {g.names[cl[showClaim]]}</p>
            <div className="groups">{((g.claimCards || {})[showClaim] || []).map((grp, i) => <div key={i} className="grp">{grp.map((c) => <Card key={c.id} sm c={c} />)}</div>)}</div>
            <button className="go big"
            //  onClick={() => setShowClaim(null)}
             >Fermer</button>
          </div>
        </div>
      )}

      {ghost && byId[ghost.id] && <Card c={byId[ghost.id]} className="ghost" style={{ left: ghost.x - 19, top: ghost.y - 19 }} />}

      {g.winner !== null && g.win && (
        <div className="ov">
          <div className="box wide">
            <p>{g.names[g.winner]} a fait Rami !</p>
            <div className="groups">
              {g.win.groups.map((grp, i) => (
                <div key={i} className="grp">{grp.map((c) => <Card key={c.id} sm c={c} className={isJoker(c, g.joker) ? "jk" : ""} />)}</div>
              ))}
            </div>
            <div className="thrown">Carte jetée : <Card sm c={g.win.out} /></div>
            {g.result && (() => {
              const Rz = g.result, paid = Rz.paid[me], staked = Rz.staked[me], net = paid - staked, fee = Rz.fees?.[me] || 0;
              return (
                <>
                  <p>{net - fee > 0 ? `Tu gagnes ${fmt(net - fee)}` : net < 0 ? `Tu perds ${fmt(-net)}` : "Tu récupères ta mise"}</p>
                  {paid > 0 && (
                    <div className="recap">
                      <div><span>Reçu du pot</span><span>{fmt(paid)}</span></div>
                      <div><span>Ta mise</span><span>−{fmt(staked)}</span></div>
                      <div><span>Gain net</span><span>{fmt(net)}</span></div>
                      {fee > 0 && <div className="fee"><span>Commission</span><span>−{fmt(fee)}</span></div>}
                      <div className="tot"><span>Ajouté à ton solde</span><span>{fmt(paid - fee)}</span></div>
                    </div>
                  )}
                  <div style={{ fontSize: 12, textAlign: "center", marginBottom: 10 }}>
                    {Rz.bonus.map((b) => (
                      <div key={b.key} style={{ marginBottom: 6 }}>
                        <div>{b.label} : {g.names[b.seat]} touche {fmt(b.amount)}</div>
                        <div className="groups" style={{ marginBottom: 0 }}>{((g.claimCards || {})[b.key] || []).map((grp, i) => <div key={i} className="grp">{grp.map((c) => <Card key={c.id} sm c={c} />)}</div>)}</div>
                      </div>
                    ))}
                    <div>Pot {fmt(Rz.pot)} · {g.names[g.winner]} empoche {fmt(Rz.winnerAmount)}</div>
                  </div>
                </>
              );
            })()}
            <button className="go big" onClick={onExit}>Retour</button>
          </div>
        </div>
      )}
    </div>
  );
}
