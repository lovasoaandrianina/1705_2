import { useEffect, useState } from "react";
import { getTheme, setTheme } from "../theme";

/** Bouton de bascule mode clair ↔ sombre */
export default function ThemeToggle({ className = "", style }) {
  const [theme, setT] = useState(getTheme);
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "gasyno_theme") setT(getTheme());
    };
    const onTheme = (e) => setT(e.detail || getTheme());
    window.addEventListener("storage", onStorage);
    window.addEventListener("gasyno-theme", onTheme);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("gasyno-theme", onTheme);
    };
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setT(next);
    window.dispatchEvent(new CustomEvent("gasyno-theme", { detail: next }));
  };
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      title={theme === "dark" ? "Mode clair" : "Mode sombre"}
      onClick={toggle}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
