import { useEffect, useState } from "react";
import { getTheme } from "../theme";

/** Logo Gasyno : version sombre (métal) en clair, golden en sombre */
export default function BrandLogo({ className = "", alt = "Gasyno" }) {
  const [theme, setTheme] = useState(getTheme);
  useEffect(() => {
    const sync = () => setTheme(getTheme());
    const onTheme = (e) => setTheme(e.detail || getTheme());
    window.addEventListener("storage", sync);
    window.addEventListener("gasyno-theme", onTheme);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("gasyno-theme", onTheme);
    };
  }, []);
  const src = theme === "dark" ? "/gasyno-logo-gold.png" : "/gasyno-logo-dark.png";
  return <img className={className} src={src} alt={alt} />;
}
