import { useEffect, useState } from "react";
import { getTheme, setTheme } from "../theme";

/** Bouton de bascule mode clair ↔ sombre royal */
export default function ThemeToggle({ className = "", style }) {
  const [theme, setT] = useState(getTheme);
  useEffect(() => {
    // synchronise si un autre onglet change
    const onStorage = (e) => {
      if (e.key === "gasyno_theme") setT(getTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setT(next);
  };
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre royal"}
      title={theme === "dark" ? "Mode clair" : "Mode sombre royal"}
      onClick={toggle}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
