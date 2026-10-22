export default function RamiMenu({ onFree, onFriends, onBack }) {
  return (
    <div className="shell">
      <button className="btn ghost" onClick={onBack}>← Retour</button>
      <h1>Rami</h1>
      <p className="sub">Choisis ton mode de jeu</p>
      <div className="cards">
        <button className="gcard" onClick={onFree}>
          <span className="ico">🤖</span>
          <span className="t"><b>Jeu libre</b><small>Contre des bots, sans mise</small></span>
          <span className="go">›</span>
        </button>
        <button className="gcard" onClick={onFriends}>
          <span className="ico">👥</span>
          <span className="t"><b>Jeu entre amis</b><small>Tables de 3 à 5 joueurs inscrits, avec mise</small></span>
          <span className="go">›</span>
        </button>
      </div>
    </div>
  );
}
