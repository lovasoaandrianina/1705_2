import { useState } from "react";
import Avatar from "../components/Avatar";
import WalletModal from "../components/WalletModal";
import ThemeToggle from "../components/ThemeToggle";
import { fmt } from "../config";

const GAMES = [
  { id: "domino", icon: "🎲", title: "Domino entre amis", live: true },
  { id: "poker", icon: "🃏", title: "Poker entre amis", live: true },
  { id: "rami", icon: "♠️", title: "Rami entre amis", live: true },
];

export default function Dashboard({ user, setUser, onLogout, onPlay }) {
  const [sheet, setSheet] = useState(null); // null | "pay" | "wallet"

  return (
    <div className="shell">
      <header className="top">
        <Avatar user={user} />
        <div><b>{user.pseudo}</b><small>{user.phone}</small></div>
        <ThemeToggle className="btn ghost theme-toggle" />
        <button className="btn ghost" onClick={onLogout}>Déconnexion</button>
      </header>

      <section className="balance">
        <small>Solde</small>
        <strong>{fmt(user.balance)}</strong>
        <div className="row">
          <button className="btn gold" onClick={() => setSheet("pay")}>Dépôt / Retrait</button>
          <button className="btn" onClick={() => setSheet("wallet")}>Portefeuille</button>
        </div>
      </section>

      <h2>Jouer entre amis</h2>
      <div className="cards">
        {GAMES.map((g) => (
          <button key={g.id} className={`gcard ${g.live ? "" : "soon"}`} disabled={!g.live} onClick={() => onPlay(g.id)}>
            <span className="ico">{g.icon}</span>
            <span className="t"><b>{g.title}</b><small>{g.live ? "Toucher pour jouer" : "Bientôt disponible"}</small></span>
            {g.live && <span className="go">›</span>}
          </button>
        ))}
      </div>

      {sheet && <WalletModal user={user} setUser={setUser} start={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
