// Bloc (« card ») de paramètres : chaque famille de réglages de la création de table a sa propre carte.
export default function SetCard({ icon, title, hint, children, tone = "" }) {
  return (
    <section className={`setc ${tone}`}>
      <header className="setc-h">
        {icon && <span className="setc-i" aria-hidden="true">{icon}</span>}
        <div><b>{title}</b>{hint && <small>{hint}</small>}</div>
      </header>
      <div className="setc-b">{children}</div>
    </section>
  );
}
