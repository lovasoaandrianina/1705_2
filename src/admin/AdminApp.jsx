import { useCallback, useEffect, useRef, useState } from "react";
import { adm, getAdminToken, setAdminToken } from "./adminApi";
import { playAlways } from "../sound";
import { fmt } from "../config";
import RequestCard, { ago } from "./RequestCard";
import Players from "./Players";
import { Stats, Settings, b64 } from "./Home";
import "./admin.css";

const ST = { approved: "✅ validé", rejected: "❌ refusé", cancelled: "annulé" };
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export default function AdminApp() {
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState("req");
  const [pending, setPending] = useState([]);
  const [online, setOnline] = useState(true);
  const [alarm, setAlarm] = useState(false);   // plein écran + sonnerie
  const [quiet, setQuiet] = useState(false);   // sonnerie coupée (la demande reste affichée)
  const [msg, setMsg] = useState("");
  const [pushState, setPushState] = useState(pushSupported() ? (Notification.permission === "denied" ? "denied" : "off") : "unsupported");
  const seen = useRef(new Set());
  const pollNow = useRef(null);
  const msgTimer = useRef();

  const toast = useCallback((m) => { setMsg(m); clearTimeout(msgTimer.current); msgTimer.current = setTimeout(() => setMsg(""), 4500); }, []);
  const logout = useCallback(() => { setAdminToken(null); setAuthed(false); setStarted(false); setPending([]); seen.current = new Set(); }, []);

  // Page installable (écran d'accueil) : manifeste + méta iOS, ajoutés seulement sur /admin
  useEffect(() => {
    const els = [];
    const add = (tag, attrs) => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); document.head.appendChild(e); els.push(e); };
    add("link", { rel: "manifest", href: "/admin.webmanifest" });
    add("link", { rel: "apple-touch-icon", href: "/admin-icon-192.png" });
    add("meta", { name: "theme-color", content: "#0b0f14" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-title", content: "Admin" });
    add("meta", { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" });
    const prev = [document.documentElement.style.background, document.body.style.background];
    document.documentElement.style.background = "#0b0f14"; document.body.style.background = "#0b0f14";
    return () => { els.forEach((e) => e.remove()); [document.documentElement.style.background, document.body.style.background] = prev; };
  }, []);

  /* ── Surveillance : une requête légère toutes les 3 s ── */
  useEffect(() => {
    if (!started) return undefined;
    let alive = true, timer, busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const d = await adm.poll();
        if (!alive) return;
        setOnline(true); setPending(d.pending);
        const fresh = d.pending.some((r) => !seen.current.has(r.id));
        d.pending.forEach((r) => seen.current.add(r.id));
        if (fresh) { setAlarm(true); setQuiet(false); }
        if (!d.pending.length) setAlarm(false);
      } catch (e) {
        if (!alive) return;
        if (e.status === 401 || e.status === 404) { logout(); return; }
        setOnline(false);
      } finally { busy = false; clearTimeout(timer); if (alive) timer = setTimeout(run, 3000); }
    };
    pollNow.current = run;
    run();
    const vis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [started, logout]);

  /* ── Sonnerie : en boucle tant qu'une nouvelle demande n'est pas traitée / mise en sourdine ── */
  const ringing = alarm && !quiet && pending.length > 0;
  useEffect(() => {
    if (!ringing) return undefined;
    const ring = () => { playAlways("alarm"); try { navigator.vibrate?.([300, 120, 300, 120, 500]); } catch { /* iOS : pas de vibration web */ } };
    ring();
    const t = setInterval(ring, 2400);
    return () => clearInterval(t);
  }, [ringing]);

  // Titre clignotant : (2) Demandes
  useEffect(() => {
    if (!pending.length) { document.title = "Admin"; return undefined; }
    let on = true;
    const t = setInterval(() => { document.title = on ? `🔔 (${pending.length}) Demande${pending.length > 1 ? "s" : ""}` : "Admin"; on = !on; }, 1000);
    return () => { clearInterval(t); document.title = "Admin"; };
  }, [pending.length]);

  // Écran maintenu allumé pendant la surveillance (sinon le téléphone se verrouille et la page s'endort)
  useEffect(() => {
    if (!started || !navigator.wakeLock) return undefined;
    let lock = null, alive = true;
    const get = async () => { try { lock = await navigator.wakeLock.request("screen"); } catch { /* refusé : ignoré */ } };
    get();
    const vis = () => { if (alive && document.visibilityState === "visible") get(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; document.removeEventListener("visibilitychange", vis); try { lock?.release(); } catch { /* ignore */ } };
  }, [started]);

  /* ── Notifications push (page fermée) ── */
  const enablePush = useCallback(async () => {
    if (!pushSupported()) return;
    try {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") { setPushState("denied"); return; }
      const reg = await navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" });
      await navigator.serviceWorker.ready;
      const { key } = await adm.pushKey();
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
      await adm.pushSubscribe(sub.toJSON());
      setPushState("on");
    } catch (e) { toast(`Notifications : ${e.message}`); }
  }, [toast]);
  useEffect(() => { if (started && pushSupported() && Notification.permission === "granted") enablePush(); }, [started, enablePush]);

  const start = () => { playAlways("claim"); setStarted(true); if (pushSupported() && Notification.permission === "default") enablePush(); };

  /* ── Décisions ── */
  const done = (r) => setPending((p) => p.filter((x) => x.id !== r.id));
  const approve = async (r, amount) => {
    try {
      const o = await adm.approve(r.id, amount);
      done(r); playAlways("win");
      toast(r.kind === "deposit" ? `✅ #${r.uid} ${r.pseudo} crédité : nouveau solde ${fmt(o.request.balance)}` : `✅ Retrait de #${r.uid} ${r.pseudo} validé`);
    } catch (e) { toast(`⚠️ ${e.message}`); }
    pollNow.current?.();
  };
  const reject = async (r, note) => {
    try {
      const o = await adm.reject(r.id, note);
      done(r);
      toast(r.kind === "withdraw" ? `↩️ Retrait refusé : ${fmt(r.amount)} rendus à #${r.uid} (solde ${fmt(o.request.balance)})` : `❌ Dépôt de #${r.uid} refusé`);
    } catch (e) { toast(`⚠️ ${e.message}`); }
    pollNow.current?.();
  };

  if (!authed) return <Login onOk={(t) => { setAdminToken(t); setAuthed(true); }} />;
  if (!started) {
    return (
      <div className="adm adm-center">
        <div className="adm-logo">A</div>
        <h1>Back office</h1>
        <p>Touche pour démarrer la surveillance : le son et les alertes sont débloqués par ce geste.</p>
        <button className="adm-ok huge" onClick={start}>▶ Démarrer la surveillance</button>
        <button className="adm-link" onClick={logout}>Changer de clé</button>
      </div>
    );
  }

  const first = pending[0];
  return (
    <div className="adm">
      <header className="adm-head">
        <b>Back office</b>
        <span className={`adm-dot ${online ? "on" : "off"}`}>{online ? "en ligne" : "hors ligne"}</span>
        <button className="adm-bell" onClick={() => setQuiet((q) => !q)} title="Sonnerie">{quiet ? "🔕" : "🔔"}</button>
      </header>

      <main className="adm-main">
        {tab === "req" && <Requests pending={pending} approve={approve} reject={reject} />}
        {tab === "players" && <Players toast={toast} />}
        {tab === "stats" && <Stats />}
        {tab === "set" && <Settings onLogout={logout} toast={toast} pushState={pushState} enablePush={enablePush} />}
      </main>

      <nav className="adm-nav">
        {[["req", "📥", "Demandes"], ["players", "👥", "Joueurs"], ["stats", "📊", "Stats"], ["set", "⚙️", "Réglages"]].map(([k, i, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            <span>{i}{k === "req" && pending.length > 0 && <em>{pending.length}</em>}</span>{l}
          </button>
        ))}
      </nav>

      {msg && <div className="adm-toast">{msg}</div>}

      {alarm && first && (
        <div className="adm-alarm">
          <div className="adm-alarm-top">
            <b>{first.kind === "deposit" ? "💰 Nouvelle demande de DÉPÔT" : "💸 Nouvelle demande de RETRAIT"}</b>
            {pending.length > 1 && <span>+{pending.length - 1} autre{pending.length > 2 ? "s" : ""} en attente</span>}
          </div>
          <div className="adm-alarm-body"><RequestCard r={first} big onApprove={approve} onReject={reject} /></div>
          <div className="adm-alarm-foot">
            <button onClick={() => setQuiet((q) => !q)}>{quiet ? "🔔 Remettre le son" : "🔕 Couper le son"}</button>
            <button onClick={() => { setAlarm(false); setTab("req"); }}>Plus tard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Requests({ pending, approve, reject }) {
  const [view, setView] = useState("pending");
  const [kind, setKind] = useState("");
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (view !== "history") return undefined;
    let alive = true;
    const go = () => adm.requests(kind).then((d) => { if (alive) { setHist(d.requests); setErr(""); } }).catch((e) => alive && setErr(e.message));
    go(); const t = setInterval(go, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [view, kind]);
  return (
    <div className="adm-page">
      <div className="adm-seg">
        <button className={view === "pending" ? "on" : ""} onClick={() => setView("pending")}>En attente ({pending.length})</button>
        <button className={view === "history" ? "on" : ""} onClick={() => setView("history")}>Historique</button>
      </div>
      {view === "pending" ? (pending.length ? pending.map((r) => <RequestCard key={r.id} r={r} onApprove={approve} onReject={reject} />)
        : <p className="adm-empty">✅ Aucune demande en attente.<br /><small>Cette page écoute en direct : un grand son retentira dès qu'un joueur fait une demande.</small></p>) : (
        <>
          <div className="adm-seg">{[["", "Tout"], ["deposit", "Dépôts"], ["withdraw", "Retraits"]].map(([k, l]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}</div>
          {err && <div className="adm-err">{err}</div>}
          {hist === null ? "Chargement…" : hist.length === 0 ? <p className="adm-empty">Aucune demande traitée.</p> : hist.map((r) => (
            <div className="adm-tx" key={r.id}>
              <span><b>{r.kind === "deposit" ? "Dépôt" : "Retrait"} · #{r.uid} {r.pseudo}</b><small>{r.phone} · {ago(r.processed_at || r.created_at)}{r.admin_note ? ` · ${r.admin_note}` : ""}</small></span>
              <span>{fmt(r.final_amount ?? r.amount)}<small>{ST[r.status]}</small></span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Login({ onOk }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { const { token } = await adm.login(key.trim()); onOk(token); }
    catch (x) { setErr(x.status === 404 ? "Back office non activé : définis ADMIN_KEY sur le serveur" : x.message); }
    finally { setBusy(false); }
  };
  return (
    <form className="adm adm-center" onSubmit={submit}>
      <div className="adm-logo">A</div>
      <h1>Back office</h1>
      <input type="password" autoComplete="current-password" placeholder="Clé d'administration" value={key} onChange={(e) => setKey(e.target.value)} required />
      {err && <div className="adm-err">{err}</div>}
      <button className="adm-ok huge" disabled={busy}>{busy ? "…" : "Se connecter"}</button>
    </form>
  );
}
