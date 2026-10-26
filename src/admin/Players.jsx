import { useCallback, useEffect, useRef, useState } from "react";
import { adm } from "./adminApi";
import { fmt } from "../config";
import { ago, Copy, wa } from "./RequestCard";

const TYPES = { deposit: ["Dépôt", 1], withdraw: ["Retrait", -1], bet: ["Mise", -1], win: ["Gain", 1], refund: ["Remboursement", 1], fee: ["Commission", -1] };
const ST = { pending: "⏳ en attente", approved: "✅ validé", rejected: "❌ refusé", cancelled: "annulé" };
const SORTS = [["new", "Récents"], ["balance", "Solde ↓"], ["pseudo", "A → Z"], ["old", "Anciens"]];

export default function Players({ toast }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("new");
  const [list, setList] = useState({ total: 0, players: [] });
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const timer = useRef();

  const load = useCallback((query, s) => adm.players(query, s).then((d) => { setList(d); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => load(q, sort), 250); return () => clearTimeout(timer.current); }, [q, sort, load]);

  return (
    <div className="adm-page">
      <input className="adm-search" type="search" placeholder="Rechercher : pseudo, téléphone ou ID" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="adm-seg">{SORTS.map(([k, l]) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}</div>
      <div className="adm-count">{list.total} joueur{list.total > 1 ? "s" : ""}</div>
      {err && <div className="adm-err">{err}</div>}
      {list.players.map((p) => (
        <button key={p.id} className={`adm-player ${p.blocked ? "blocked" : ""}`} onClick={() => setOpen(p.id)}>
          <span className="adm-id">#{p.id}</span>
          <span className="adm-pl-main"><b>{p.pseudo}{p.blocked ? " ⛔" : ""}</b><small>{p.phone}</small></span>
          <span className="adm-pl-bal">{fmt(p.balance)}</span>
        </button>
      ))}
      {list.players.length === 0 && !err && <p className="adm-empty">Aucun joueur trouvé.</p>}
      {open && <PlayerSheet id={open} toast={toast} onClose={() => { setOpen(null); load(q, sort); }} />}
    </div>
  );
}

function PlayerSheet({ id, onClose, toast }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("tx");
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [sign, setSign] = useState(1);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => adm.player(id).then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="adm-sheet-bg" onClick={onClose}><div className="adm-sheet" onClick={(e) => e.stopPropagation()}>{err || "Chargement…"}</div></div>;
  const p = d.player;

  const adjust = async (e) => {
    e.preventDefault();
    const n = Math.round(Number(amt)) * sign;
    if (!n) return;
    if (!window.confirm(`${n > 0 ? "Créditer" : "Débiter"} ${fmt(Math.abs(n))} ${n > 0 ? "à" : "de"} ${p.pseudo} ?\nMotif : ${note}`)) return;
    setBusy(true);
    try { const r = await adm.adjust(id, n, note); toast(`✅ Nouveau solde de ${p.pseudo} : ${fmt(r.balance)}`); setAmt(""); setNote(""); await load(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const block = async () => {
    if (!window.confirm(p.blocked ? `Réactiver ${p.pseudo} ?` : `Suspendre ${p.pseudo} ? Il sera déconnecté tout de suite.`)) return;
    try { await adm.block(id, !p.blocked); await load(); } catch (x) { setErr(x.message); }
  };

  return (
    <div className="adm-sheet-bg" onClick={onClose}>
      <div className="adm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="adm-sheet-head">
          <div className="adm-id big">#{p.id}</div>
          <div className="adm-pl-main"><b style={{ fontSize: 20 }}>{p.pseudo}{p.blocked ? " ⛔" : ""}</b><small>{p.phone} · inscrit {ago(p.created_at)}</small></div>
          <button className="adm-x" onClick={onClose}>✕</button>
        </div>

        <div className="adm-big-bal"><small>Solde</small><b>{fmt(p.balance)}</b></div>
        <div className="adm-links">
          <a href={`tel:${p.phone}`}>📞 Appeler</a>
          <a href={wa(p.phone)} target="_blank" rel="noreferrer">💬 WhatsApp</a>
          <Copy text={p.phone}>📋 Copier n°</Copy>
        </div>
        <div className="adm-grid two">
          <div><small>Total déposé</small><b>{fmt(d.deposited)}</b></div>
          <div><small>Total retiré</small><b>{fmt(d.withdrawn)}</b></div>
        </div>
        {d.atTables.length > 0 && <div className="adm-note">🎮 À table : {d.atTables.map((t) => `${t.game} #${t.id}`).join(", ")}</div>}

        <form className="adm-adjust" onSubmit={adjust}>
          <b>Ajuster le solde</b>
          <div className="adm-seg">
            <button type="button" className={sign > 0 ? "on" : ""} onClick={() => setSign(1)}>＋ Créditer</button>
            <button type="button" className={sign < 0 ? "on neg" : ""} onClick={() => setSign(-1)}>－ Débiter</button>
          </div>
          <input type="number" inputMode="numeric" placeholder="Montant (Ar)" value={amt} onChange={(e) => setAmt(e.target.value)} required />
          <input placeholder="Motif obligatoire (ex : geste commercial)" value={note} onChange={(e) => setNote(e.target.value)} minLength={3} required />
          <button className="adm-ok" disabled={busy}>{busy ? "…" : "Appliquer"}</button>
        </form>
        {err && <div className="adm-err">{err}</div>}

        <div className="adm-seg">
          <button className={tab === "tx" ? "on" : ""} onClick={() => setTab("tx")}>Opérations</button>
          <button className={tab === "rq" ? "on" : ""} onClick={() => setTab("rq")}>Demandes</button>
        </div>
        {tab === "tx" ? (d.transactions.length ? d.transactions.map((t) => (
          <div className="adm-tx" key={t.id}>
            <span>{(TYPES[t.type] || [t.type])[0]}<small>{t.note ? `${t.note} · ` : ""}{ago(t.created_at)}</small></span>
            <span className={(TYPES[t.type] || [0, 1])[1] > 0 ? "plus" : "minus"}>{(TYPES[t.type] || [0, 1])[1] > 0 ? "+" : "−"}{fmt(t.amount)}<small>solde {fmt(t.balance_after)}</small></span>
          </div>
        )) : <p className="adm-empty">Aucune opération.</p>) : (d.requests.length ? d.requests.map((r) => (
          <div className="adm-tx" key={r.id}>
            <span>{r.kind === "deposit" ? "Dépôt" : "Retrait"} #{r.id}<small>{r.method} · {ago(r.created_at)}{r.admin_note ? ` · ${r.admin_note}` : ""}</small></span>
            <span>{fmt(r.final_amount ?? r.amount)}<small>{ST[r.status]}</small></span>
          </div>
        )) : <p className="adm-empty">Aucune demande.</p>)}

        <button className={`adm-block ${p.blocked ? "unblock" : ""}`} onClick={block}>{p.blocked ? "Réactiver le compte" : "⛔ Suspendre le compte"}</button>
      </div>
    </div>
  );
}
