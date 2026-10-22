import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { play } from "../sound";
import "./Chat.css";

const REACTIONS = ["👍", "😂", "😮", "🔥", "👏", "😢", "🎉", "😡"];
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const hhmm = (ts) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const Avatar = ({ name, size = 28 }) => (
  <span className="cx-av" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg,hsl(${hue(name)} 70% 58%),hsl(${(hue(name) + 40) % 360} 70% 42%))` }}>
    {String(name).slice(0, 1).toUpperCase()}
  </span>
);

// Chat en direct d'une table : bulle déplaçable + panneau. Aucun historique conservé ; la salle disparaît avec la partie.
// kind : "table" (Domino / Rami) ou "poker". enabled=false (partie terminée) : tout disparaît.
export default function ChatDock({ kind, id, me, enabled = true }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [typing, setTyping] = useState([]);
  const [online, setOnline] = useState([]);
  const [text, setText] = useState("");
  const [toast, setToast] = useState(null);
  const [floats, setFloats] = useState([]);
  const [tray, setTray] = useState(false);
  const [closed, setClosed] = useState(false);
  const [err, setErr] = useState("");
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem("chat_dock")) || null; } catch { return null; } });

  const lastRef = useRef(0), openRef = useRef(false), firstRef = useRef(true), typingUntil = useRef(0);
  const listRef = useRef(null), stick = useRef(true), dragRef = useRef(null), moved = useRef(false), toastT = useRef(null);
  openRef.current = open;

  /* ── réception en direct (interrogation rapide ; plus lente quand le panneau est fermé ou l'onglet masqué) ── */
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true, timer;
    const tick = async () => {
      try {
        const d = await api.chatPoll(kind, id, lastRef.current, Date.now() < typingUntil.current);
        if (!alive) return;
        setTyping(d.typing); setOnline(d.online); setErr("");
        if (d.msgs.length) {
          lastRef.current = d.last;
          const first = firstRef.current; firstRef.current = false;
          const shown = d.msgs.filter((m) => m.k !== "react");
          if (shown.length) setMsgs((cur) => [...cur, ...shown].slice(-200));
          for (const m of d.msgs) {
            if (first) continue; // l'existant à l'arrivée s'affiche sans bruit
            if (m.k === "react") {
              if (Date.now() - m.ts < 8000) {
                const f = { key: `${m.id}`, emoji: m.text, name: m.uid === me.id ? "Moi" : m.name, x: 12 + Math.random() * 70 };
                setFloats((c) => [...c, f]); setTimeout(() => setFloats((c) => c.filter((x) => x.key !== f.key)), 2800);
                if (m.uid !== me.id) play("pop");
              }
            } else if (m.k === "msg" && m.uid !== me.id) {
              play("msg");
              if (!openRef.current) {
                setUnread((u) => u + 1); setToast({ name: m.name, text: m.text, key: m.id });
                clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 4200);
              }
            }
          }
        } else firstRef.current = false;
      } catch (e) { if (alive && /fermé/i.test(e.message)) setClosed(true); }
      if (alive) timer = setTimeout(tick, openRef.current ? 1000 : document.hidden ? 5000 : 1800);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); clearTimeout(toastT.current); };
  }, [kind, id, enabled, me.id]);

  useEffect(() => { // défilement automatique tant qu'on est en bas
    const el = listRef.current;
    if (open && el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, open, typing]);
  useEffect(() => { if (open) { setUnread(0); setToast(null); stick.current = true; } }, [open]);

  const send = useCallback(async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText(""); stick.current = true; typingUntil.current = 0;
    try { await api.chatSend(kind, id, { text: t }); } catch (x) { setErr(x.message); setText(t); }
  }, [text, kind, id]);
  const react = async (emoji) => { setTray(false); play("pop"); try { await api.chatSend(kind, id, { react: emoji }); } catch (x) { setErr(x.message); } };

  /* ── bulle déplaçable (la position est mémorisée sur l'appareil) ── */
  const down = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, w: r.width, h: r.height };
    moved.current = false;
  };
  const move = (e) => {
    const d = dragRef.current; if (!d) return;
    if (!moved.current && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 8) { moved.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignoré */ } }
    if (!moved.current) return;
    setPos({ x: Math.min(window.innerWidth - d.w - 4, Math.max(4, e.clientX - d.dx)), y: Math.min(window.innerHeight - d.h - 4, Math.max(4, e.clientY - d.dy)) });
  };
  const up = () => { dragRef.current = null; if (moved.current && pos) { try { localStorage.setItem("chat_dock", JSON.stringify(pos)); } catch { /* ignoré */ } } };
  const tap = (fn) => () => { if (!moved.current) fn(); };

  if (!enabled || closed) return null;
  const style = pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined;
  const others = online.filter((o) => o.id !== me.id);

  return (
    <>
      <div className="cx-floats" aria-hidden>
        {floats.map((f) => <div key={f.key} className="cx-float" style={{ left: `${f.x}%` }}><span>{f.emoji}</span><small>{f.name}</small></div>)}
      </div>

      {!open && (
        <div className="cx-dock" style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {toast && (
            <button className="cx-toast" key={toast.key} onClick={tap(() => setOpen(true))}>
              <Avatar name={toast.name} size={22} /><span><b>{toast.name}</b> {toast.text}</span>
            </button>
          )}
          {tray && (
            <div className="cx-tray">{REACTIONS.map((r) => <button key={r} onClick={tap(() => react(r))}>{r}</button>)}</div>
          )}
          <div className="cx-btns">
            <button className="cx-round small" aria-label="Réactions" onClick={tap(() => setTray((t) => !t))}>😊</button>
            <button className="cx-round" aria-label="Ouvrir le chat" onClick={tap(() => { setTray(false); setOpen(true); })}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
              {unread > 0 && <i className="cx-badge">{unread > 9 ? "9+" : unread}</i>}
            </button>
          </div>
        </div>
      )}

      {open && (
        <>
          <div className="cx-back" onClick={() => setOpen(false)} />
          <section className="cx-panel" role="dialog" aria-label="Chat de la table">
            <div className="cx-grip" />
            <header>
              <div>
                <b>Chat de la table</b>
                <small>{others.length ? `${others.length + 1} en ligne` : "Toi seul(e) pour l'instant"} · disparaît à la fin de la partie</small>
              </div>
              <div className="cx-stack">{others.slice(0, 4).map((o) => <Avatar key={o.id} name={o.name} size={26} />)}</div>
              <button className="cx-x" onClick={() => setOpen(false)} aria-label="Fermer">✕</button>
            </header>

            <div className="cx-list" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
              {msgs.length === 0 && <div className="cx-empty"><span>💬</span>Aucun message pour l'instant.<br />Lance la conversation !</div>}
              {msgs.map((m, i) => {
                if (m.k === "sys") return <div className="cx-sys" key={m.id}><span>{m.text}</span></div>;
                const mine = m.uid === me.id, prev = msgs[i - 1];
                const head = !prev || prev.k === "sys" || prev.uid !== m.uid || m.ts - prev.ts > 90000;
                return (
                  <div key={m.id} className={`cx-row ${mine ? "mine" : ""} ${head ? "head" : ""}`}>
                    {!mine && (head ? <Avatar name={m.name} /> : <span className="cx-av-gap" />)}
                    <div className="cx-col">
                      {!mine && head && <small className="cx-name" style={{ color: `hsl(${hue(m.name)} 80% 72%)` }}>{m.name}</small>}
                      <div className="cx-bubble">{m.text}<time>{hhmm(m.ts)}</time></div>
                    </div>
                  </div>
                );
              })}
              {typing.length > 0 && (
                <div className="cx-typing"><span className="cx-dots"><i /><i /><i /></span>{typing.length > 2 ? "Plusieurs personnes écrivent…" : `${typing.join(" et ")} ${typing.length > 1 ? "écrivent" : "écrit"}…`}</div>
              )}
            </div>

            <div className="cx-react">{REACTIONS.map((r) => <button key={r} onClick={() => react(r)} aria-label={`Réagir ${r}`}>{r}</button>)}</div>
            {err && <div className="cx-err">{err}</div>}
            <form className="cx-form" onSubmit={send}>
              <input value={text} maxLength={300} placeholder="Écris un message…" enterKeyHint="send" autoComplete="off"
                onChange={(e) => { setText(e.target.value); typingUntil.current = Date.now() + 3000; }} />
              <button type="submit" disabled={!text.trim()} aria-label="Envoyer">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
