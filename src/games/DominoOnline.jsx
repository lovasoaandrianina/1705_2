import { useEffect, useRef, useState } from "react";
import Tile from "../components/Tile";
import Avatar from "../components/Avatar";
import Payout from "../components/Payout";
import SoundToggle from "../components/SoundToggle";
import { play, useWatch } from "../sound";
import { rulesText } from "../config";
import "./Domino.css";
import Rematch from "../components/Rematch";

const SHUFFLE_MS = 2400, DEAL_MS = 2800; // + 400 ms de pause = 5 600 ms côté serveur
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export default function DominoOnline({ view, act, onExit, onOpen }) {
  const g = view.game, me = g.seat;
  const [sel, setSel] = useState(null);
  const [order, setOrder] = useState(() => g.hand.map((t) => t.id));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [ghost, setGhost] = useState(null);
  const [rules, setRules] = useState(false);
  const hd = useRef(null);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 100); return () => clearInterval(t); }, []);

  // l'ordre de ma main m'appartient : le serveur n'envoie que les dominos
  const key = g.hand.map((t) => t.id).join();
  useEffect(() => {
    const ids = g.hand.map((t) => t.id);
    setOrder((o) => { const keep = o.filter((i) => ids.includes(i)); return [...keep, ...ids.filter((i) => !keep.includes(i))]; });
  }, [key]);
  useEffect(() => { setSel(null); setNote(""); }, [g.round]);
  const byId = Object.fromEntries(g.hand.map((t) => [t.id, t]));
  const tiles = order.map((i) => byId[i]).filter(Boolean);

  /* ── mélange puis distribution, montrés à tous ── */
  const now = Date.now();
  const dealLeft = Math.max(0, g.dealMs - (now - view.fetchedAt));
  const elapsed = g.dealTotal - dealLeft;
  const dealing = dealLeft > 0 && g.phase === "play" && g.winner === null;
  const shuffling = dealing && elapsed < SHUFFLE_MS;
  const nPlayers = g.N || 3;
  const totalDeal = nPlayers * 7;
  const dealt = dealing ? clamp(Math.floor(((elapsed - SHUFFLE_MS) / DEAL_MS) * totalDeal), 0, totalDeal) : totalDeal;
  const cnt = (s) => (dealing ? Math.floor((dealt + (nPlayers - 1) - s) / nPlayers) : g.counts[s]);
  const shown = dealing ? tiles.slice(0, cnt(me)) : tiles;
  const stockShown = dealing ? 28 - dealt : g.stock;
  const flying = dealing && !shuffling ? [0, 1, 2, 3].map((k) => dealt - 1 - k).filter((k) => k >= 0 && k < totalDeal) : [];

  /* ── tour de jeu ── */
  const lg = g.legal || {};
  const hasLegal = Object.keys(lg).length > 0;
  const myTurn = g.winner === null && g.phase === "play" && g.turn === me && !dealing;
  const sides = sel !== null && lg[sel] ? lg[sel] : [];
  const left = Math.max(0, g.msLeft - (now - view.fetchedAt));
  const secs = Math.ceil(left / 1000);
  const stockLeft = typeof g.stock === "number" ? g.stock : 0;
  const canDraw = myTurn && !hasLegal && nPlayers === 2 && stockLeft > 0;
  const canPass = myTurn && !hasLegal && (nPlayers !== 2 || stockLeft === 0);

  /* ── sons ── */
  const prevT = useRef({ round: g.round, len: g.chain.length, turn: g.turn });
  useEffect(() => {
    const p = prevT.current;
    if (p.round === g.round && p.len === g.chain.length && p.turn !== g.turn && g.phase === "play" && g.winner === null && !dealing) play("pass"); // le tour a changé sans domino posé : un joueur a passé
    prevT.current = { round: g.round, len: g.chain.length, turn: g.turn };
  }, [g.round, g.chain.length, g.turn]); // eslint-disable-line
  useWatch(g.chain.length, (n, p) => { if (n > p) play("tile"); });
  useWatch(myTurn, (n) => n && play("turn"));
  useWatch(g.dealNo, (n, p) => { if (n !== p) { play("shuffle"); for (let k = 0; k < 12; k++) setTimeout(() => play("card"), SHUFFLE_MS + k * (DEAL_MS / 12)); } });
  useWatch(g.phase === "between" && g.roundResult && g.winner === null ? g.roundResult.n : 0, (n) => n && play("roundend"));
  useWatch(g.winner, (w) => w !== null && w !== undefined && play(w === me ? "win" : "lose"));
  useWatch(myTurn && secs > 0 && secs <= 5 ? secs : 0, (s) => s && play("tick"));

  const run = async (a) => {
    if (busy) return false;
    setBusy(true); setNote("");
    try { await act(a); return true; } catch (e) { setNote(e.message); return false; } finally { setBusy(false); }
  };
  const place = async (side) => { if (await run({ type: "play", tileId: sel, side })) setSel(null); };
  const quit = () => (g.winner !== null || window.confirm("Tu quittes l'écran, mais la partie continue : ta mise reste engagée et le jeu joue à ta place.")) && onExit();

  /* ── ma main : toucher = sélectionner · glisser = changer un domino de place (jamais de pose par glisser) ── */
  const hDown = (e) => {
    if (g.winner !== null || dealing) return;
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
    const over = [...e.currentTarget.querySelectorAll("[data-id]")].find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
    });
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
    if (!k || k.moved) return;
    setSel((s) => (s === k.id ? null : k.id));
    play("click");
    setNote(myTurn && !lg[k.id] ? "Ce domino ne peut pas être posé" : "");
  };

  const msg = note || (dealing ? (shuffling ? "Mélange des dominos…" : "Distribution : 7 dominos chacun…")
    : g.winner !== null ? "Partie terminée"
    : g.phase === "between" ? "Manche terminée"
    : myTurn
      ? `${hasLegal
          ? (sel === null ? "À toi : touche un domino" : "Choisis le côté")
          : (canDraw ? `Aucun domino jouable : pioche (${stockLeft} restants)` : "Aucun domino jouable : passe")} · ${secs}s`
      : `Tour de ${g.names[g.turn]} · ${secs}s`);

  const opp = (rel) => {
    const s = (me + rel) % nPlayers, active = g.winner === null && g.phase === "play" && g.turn === s && !dealing;
    return (
      <div key={s} className={`dm-opp ${active ? "turn" : ""}`}>
        <div className="dm-av"><Avatar user={{ pseudo: g.names[s], avatar: (g.avatars || [])[s] }} /></div>
        <b>{g.names[s]}</b><small>{g.scores[s]} pts · {cnt(s)} dominos</small>
        <div className="dm-backs">{Array.from({ length: cnt(s) }, (_, k) => <Tile key={k} back mini className="popin" />)}</div>
      </div>
    );
  };

  const chain = g.chain, last = chain.length - 1;
  const hlL = sel !== null && sides.includes("L"), hlR = sel !== null && sides.includes("R");
  const R = g.roundResult;

  return (
    <div className="dm-app">
      <div className="dm-top">{Array.from({ length: nPlayers - 1 }, (_, i) => opp(i + 1))}</div>

      <div className="dm-scores">
        {Array.from({ length: nPlayers }, (_, rel) => {
          const s = (me + rel) % nPlayers;
          return (
            <div key={s} className={`dm-sc ${rel === 0 ? "me" : ""}`}>
              {rel === 0 ? "Moi" : g.names[s]} · {g.scores[s]}/{g.target}
              <div className="bar"><i style={{ width: `${clamp((g.scores[s] / g.target) * 100, 0, 100)}%` }} /></div>
            </div>
          );
        })}
        <SoundToggle className="dm-link" style={{ textDecoration: "none", marginRight: 6 }} /><button className="dm-link" onClick={() => setRules(true)}>Règles</button>
      </div>

      <div className="dm-board">
        {g.ends && !dealing && <div className="dm-ends">◀ {g.ends.l} · {g.ends.r} ▶ — manche {g.round}</div>}
        {chain.length > 0 && !dealing && (
          <div className="dm-chain">
            {chain.map((c, i) => (
              <Tile key={c.id} a={c.l} b={c.r} dir={c.l === c.r ? "v" : "h"}
                className={`bt ${i === 0 ? "endL" : ""} ${i === last ? "endR" : ""} ${(hlL && i === 0) || (hlR && i === last) ? "hl" : ""} ${g.lastPlay && g.lastPlay.id === c.id ? "fresh" : ""}`} />
            ))}
          </div>
        )}
        {chain.length === 0 && !dealing && g.winner === null && g.phase === "play" && (
          <div className="dm-hint">{g.turn === me ? "À toi d'ouvrir : pose le domino indiqué" : `${g.names[g.turn]} ouvre la manche`}<br />Manche {g.round}</div>
        )}

        {shuffling && (
          <>
            <div className="dm-dealtxt">Mélange des dominos…</div>
            <div className="dm-shuffle">
              {Array.from({ length: 10 }, (_, k) => <Tile key={k} back className="" style={{ animationDelay: `${k * 0.06}s`, animationDirection: k % 2 ? "reverse" : "normal" }} />)}
            </div>
          </>
        )}
        {dealing && !shuffling && <div className="dm-dealtxt">Distribution : 7 dominos chacun</div>}
        {flying.map((k) => <span key={`${g.dealNo}-${k}`} className={`dm-fly r${(k % nPlayers - me + nPlayers) % nPlayers}`}><Tile back mini /></span>)}

        <div className="dm-talon">
          <div className="dm-stack">{[0, 1, 2].map((k) => <Tile key={k} back dir="v" className="sm" style={{ top: k * 2 }} />)}</div>
          <span>{nPlayers === 2 ? `Sabot · ${stockLeft}` : "Réserve inactive"}</span>
        </div>
      </div>

      <div className="dm-tbar" style={{ width: `${myTurn || (g.winner === null && g.phase === "play" && !dealing) ? clamp((left / g.turnMs) * 100, 0, 100) : 0}%` }} />
      <div className="dm-msg">{msg}</div>

      <div className="dm-actions">
        <button onClick={quit}>← Quitter</button>
        {canDraw && <button className="gold" onClick={() => run({ type: "draw" })}>Piocher ({stockLeft})</button>}
        {canPass && <button className="gold" onClick={() => run({ type: "pass" })}>Passer</button>}
        {myTurn && sel !== null && sides.includes("C") && <button className="gold" onClick={() => place("C")}>Poser</button>}
        {myTurn && sel !== null && sides.includes("L") && <button className="gold" onClick={() => place("L")}>◀ Gauche ({g.ends.l})</button>}
        {myTurn && sel !== null && sides.includes("R") && <button className="gold" onClick={() => place("R")}>Droite ({g.ends.r}) ▶</button>}
      </div>

      <div className={`dm-hand ${myTurn ? "turn" : ""}`} onPointerDown={hDown} onPointerMove={hMove} onPointerUp={hUp} onPointerCancel={() => { hd.current = null; setGhost(null); }}>
        {shown.map((t) => (
          <Tile key={t.id} data-id={t.id} a={t.a} b={t.b} dir="v" sel={sel === t.id}
            className={`${dealing ? "popin" : ""} ${myTurn && lg[t.id] ? "playable" : ""} ${myTurn && !lg[t.id] ? "dim" : ""} ${ghost && ghost.id === t.id ? "ph" : ""}`} />
        ))}
      </div>
      {ghost && byId[ghost.id] && <Tile className="dm-ghost" a={byId[ghost.id].a} b={byId[ghost.id].b} dir="v" style={{ left: ghost.x - 19, top: ghost.y - 38 }} />}

      {rules && (
        <div className="dm-ov" onClick={() => setRules(false)}>
          <div className="dm-box">
            <h3>Règles de la table</h3>
            <p>{nPlayers} joueurs · 7 dominos chacun · premier à {g.target} points.</p>
            <p>On pose un domino sur l'un des deux bouts. À 3 joueurs, sans domino jouable on passe (pas de pioche). À 2 joueurs, on pioche dans le sabot jusqu'à pouvoir jouer ou jusqu'à épuisement du sabot, puis on passe. Première manche : le plus petit double disponible (0-0, puis 1-1, etc.) désigne le premier joueur, qui peut poser le domino de son choix. Dès la deuxième manche, le départ tourne dans le sens des aiguilles d'une montre. Celui qui n'a plus de dominos (ou le plus petit total si le jeu est bloqué) marque les points des dominos restants chez les autres.</p>
            <p><b>{rulesText(view.config, "domino")}</b></p>
            <button className="gold" onClick={() => setRules(false)}>Fermer</button>
          </div>
        </div>
      )}

      {g.phase === "between" && R && g.winner === null && (
        <div className="dm-ov">
          <div className="dm-box">
            <h3>Manche {R.n} terminée</h3>
            <p>{R.winner === null ? "Jeu bloqué, égalité : personne ne marque." : `${g.names[R.winner]} ${R.kind === "out" ? "est sorti" : "gagne le jeu bloqué"} : +${R.points} points`}</p>
            <div className="dm-reveal">
              {R.hands.map((h, s) => (
                <div key={s}>
                  <b>{g.names[s]}</b> · {R.totals[s]} pts · total {g.scores[s]}/{g.target}
                  <div className="row">{h.length ? h.map((t) => <Tile key={t.id} a={t.a} b={t.b} dir="h" className="sm" />) : <em>plus aucun domino</em>}</div>
                </div>
              ))}
            </div>
            <p style={{ opacity: 0.85, fontSize: 12 }}>Mélange et distribution de la manche suivante dans {Math.ceil(Math.max(0, g.nextMs - (now - view.fetchedAt)) / 1000)} s…</p>
          </div>
        </div>
      )}

      {g.winner !== null && g.win && (
        <div className="dm-ov">
          <div className="dm-box">
            <h3>{g.names[g.winner]} gagne la partie !</h3>
            <p>{g.win.reason}</p>
            <div className="dm-final">{Array.from({ length: nPlayers }, (_, s) => <span key={s}>{g.names[s]} : {g.scores[s]}</span>)}</div>
            {R && (
              <>
                <p>{R.winner === null
                  ? "Détail de la manche : égalité, aucun point attribué."
                  : `Détail du score : ${g.names[R.winner]} marque ${R.points} points grâce aux dominos restants des adversaires.`}</p>
                <div className="dm-reveal">
                  {R.hands.map((h, s) => (
                    <div key={s}>
                      <b>{g.names[s]}</b> · dominos restants : {R.totals[s]} pts · score final {g.scores[s]}/{g.target}
                      <div className="row">{h.length ? h.map((t) => <Tile key={t.id} a={t.a} b={t.b} dir="h" className="sm" />) : <em>plus aucun domino</em>}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {g.result && <Payout result={g.result} me={me} winnerName={g.names[g.winner]} />}
            <Rematch view={view} onOpen={onOpen} lost={g.result ? Math.max(0, g.result.staked[me] - g.result.paid[me]) : 0} />
            <button className="big" onClick={onExit}>Retour</button>
          </div>
        </div>
      )}
    </div>
  );
}