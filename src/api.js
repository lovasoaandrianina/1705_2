const BASE = import.meta.env.VITE_API_URL || "/api"; // en prod : VITE_API_URL=https://ton-serveur/api
const KEY = "rami_token";

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function call(path, method = "GET", body) {
  const token = getToken();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error("Connexion impossible : vérifie ton réseau (ou patiente, le serveur se réveille peut-être)");
    e.network = true; throw e;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // 502 / 503 / 504 : le serveur gratuit se réveille après une période d'inactivité
    const e = new Error(data?.error || (res.status >= 500 ? "Le serveur se réveille (offre gratuite) : réessaie dans 30 à 60 secondes" : "Erreur réseau"));
    e.status = res.status; throw e;
  }
  return data;
}

export const api = {
  register: (b) => call("/auth/register", "POST", b),
  login: (b) => call("/auth/login", "POST", b),
  me: () => call("/auth/me"),
  logout: () => call("/auth/logout", "POST"),
  updateProfile: (b) => call("/auth/profile", "POST", b),
  wallet: () => call("/wallet"),
  walletInfo: () => call("/wallet/info"),
  myRequests: () => call("/wallet/requests"),
  deposit: (b) => call("/wallet/deposit", "POST", b),      // demande de dépôt : validée à la main par l'administrateur
  withdraw: (b) => call("/wallet/withdraw", "POST", b),    // demande de retrait : jetons retirés du solde tout de suite
  cancelRequest: (id) => call(`/wallet/requests/${id}/cancel`, "POST"),
  tables: (game = "rami") => call(`/tables?game=${encodeURIComponent(game)}`),
  createTable: (b) => call("/tables", "POST", b),
  table: (id) => call(`/tables/${id}`),
  joinTable: (id) => call(`/tables/${id}/join`, "POST"),
  leaveTable: (id) => call(`/tables/${id}/leave`, "POST"),
  startTable: (id) => call(`/tables/${id}/start`, "POST"),
  publicTable: (id) => call(`/tables/${id}/public`),
  queueTable: (id) => call(`/tables/${id}/queue`, "POST"),
  unqueueTable: (id) => call(`/tables/${id}/unqueue`, "POST"),
  rematchTable: (id, stake) => call(`/tables/${id}/rematch`, "POST", { stake }),
  tableAction: (id, a) => call(`/tables/${id}/action`, "POST", a),
  pokerTables: () => call("/poker"),
  pokerCreate: (b) => call("/poker", "POST", b),
  pokerJoin: (id) => call(`/poker/${id}/join`, "POST", {}),
  chatPoll: (kind, id, since, typing) => call(`/chat/${kind}/${id}?since=${since}${typing ? "&typing=1" : ""}`),
  chatSend: (kind, id, body) => call(`/chat/${kind}/${id}`, "POST", body),
  pokerPublic: (id) => call(`/poker/${id}/public`),
  pokerTable: (id) => call(`/poker/${id}`),
  pokerAction: (id, a) => call(`/poker/${id}/action`, "POST", a),
  pokerRebuy: (id, amount) => call(`/poker/${id}/rebuy`, "POST", { amount }),
  pokerLeave: (id) => call(`/poker/${id}/leave`, "POST"),
};
