import { useState } from "react";
import Avatar from "../components/Avatar";
import WalletModal from "../components/WalletModal";
import ProfileModal from "../components/ProfileModal";
import ThemeToggle from "../components/ThemeToggle";
import BrandLogo from "../components/BrandLogo";
import InstallButton from "../components/InstallButton";
import { fmt } from "../config";

const GAMES = [
  {
    id: "domino",
    title: "Domino",
    live: true,
    icon: (
      <span className="gico domino" aria-hidden>
        <i /><i /><i /><i />
      </span>
    ),
  },
  {
    id: "poker",
    title: "Poker",
    live: true,
    icon: (
      <span className="gico poker" aria-hidden>
        <span className="pcard red">A♥</span>
        <span className="pcard">A♠</span>
      </span>
    ),
  },
  {
    id: "rami",
    title: "Rami",
    live: true,
    icon: (
      <span className="gico rami" aria-hidden>
        <span>♠</span><span className="red">♥</span><span className="red">♦</span><span>♣</span>
      </span>
    ),
  },
];

export default function Dashboard({ user, setUser, onLogout, onPlay }) {
  const [sheet, setSheet] = useState(null); // null | "pay" | "wallet" | "profile"

  return (
    <div className="shell">
      <header className="top">
        <button type="button" className="avatar-btn" onClick={() => setSheet("profile")} title="Modifier mon profil">
          <Avatar user={user} />
        </button>
        <div>
          <b>{user.pseudo}</b>
          <small>{user.phone}</small>
        </div>
        <ThemeToggle className="btn ghost theme-toggle" />
        <InstallButton className="btn ghost" />
        <button className="btn ghost" onClick={onLogout}>Sortir</button>
      </header>

      <div className="brand-top dash">
        <BrandLogo className="brand-logo sm" />
      </div>

      <section className="balance">
        <small>Solde</small>
        <strong>{fmt(user.balance)}</strong>
        <div className="row">
          <button className="btn gold" onClick={() => setSheet("pay")}>Dépôt / Retrait</button>
          <button className="btn" onClick={() => setSheet("wallet")}>Portefeuille</button>
        </div>
      </section>

      <h2>Jouer</h2>
      <div className="cards">
        {GAMES.map((g) => (
          <button key={g.id} className={`gcard ${g.live ? "" : "soon"}`} disabled={!g.live} onClick={() => onPlay(g.id)}>
            <span className="ico">{g.icon}</span>
            <span className="t"><b>{g.title}</b><small>{g.live ? "Toucher pour jouer" : "Bientôt"}</small></span>
            {g.live && <span className="go">›</span>}
          </button>
        ))}
      </div>

      {sheet === "profile" && <ProfileModal user={user} setUser={setUser} onClose={() => setSheet(null)} />}
      {(sheet === "pay" || sheet === "wallet") && (
        <WalletModal user={user} setUser={setUser} start={sheet} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
