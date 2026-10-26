// Thème clair (blanc / jaune) ↔ sombre (vert sombre / or)
const KEY = "gasyno_theme";

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(t) {
  const theme = t === "dark" ? "dark" : "light";
  try {
    localStorage.setItem(KEY, theme);
  } catch { /* ignore */ }
  applyTheme(theme);
  return theme;
}

export function applyTheme(theme = getTheme()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

// Appliquer dès le chargement du module (avant paint si possible)
applyTheme();
