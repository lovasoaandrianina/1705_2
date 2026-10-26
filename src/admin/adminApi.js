// Appels du back office. Le jeton admin (30 jours) reste sur le téléphone ; la clé ADMIN_KEY n'est jamais conservée.
const BASE = import.meta.env.VITE_API_URL || "/api";
const KEY = "adm_token";
export const getAdminToken = () => localStorage.getItem(KEY);
export const setAdminToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function call(path, method = "GET", body) {
  const token = getAdminToken();
  let res;
  try {
    res = await fetch(`${BASE}/admin${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { const e = new Error("Pas de connexion au serveur"); e.network = true; throw e; }
  const data = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(data?.error || (res.status >= 500 ? "Le serveur se réveille, réessaie dans un instant" : "Erreur")); e.status = res.status; throw e; }
  return data;
}

export const adm = {
  login: (key) => call("/login", "POST", { key }),
  poll: () => call("/poll"),
  requests: (kind = "") => call(`/requests?limit=60${kind ? `&kind=${kind}` : ""}`),
  approve: (id, amount, note) => call(`/requests/${id}/approve`, "POST", { amount, note }),
  reject: (id, note) => call(`/requests/${id}/reject`, "POST", { note }),
  players: (q = "", sort = "new", offset = 0) => call(`/players?q=${encodeURIComponent(q)}&sort=${sort}&offset=${offset}&limit=40`),
  player: (id) => call(`/players/${id}`),
  adjust: (id, amount, note) => call(`/players/${id}/adjust`, "POST", { amount, note }),
  block: (id, blocked) => call(`/players/${id}/block`, "POST", { blocked }),
  summary: () => call("/summary"),
  settings: () => call("/settings"),
  saveSettings: (b) => call("/settings", "PUT", b),
  pushKey: () => call("/push/key"),
  pushSubscribe: (sub) => call("/push/subscribe", "POST", sub),
  pushTest: () => call("/push/test", "POST", {}),
};
