const BASE = import.meta.env.VITE_API_URL || "/api"; // en prod : VITE_API_URL=https://ton-serveur/api
const KEY = "rami_token";

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function call(path, method = "GET", body) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(data?.error || (res.status >= 500 ? "API injoignable : lance le serveur (npm run dev:server)" : "Erreur réseau"));
  return data;
}

export const api = {
  register: (b) => call("/auth/register", "POST", b),
  login: (b) => call("/auth/login", "POST", b),
  me: () => call("/auth/me"),
  logout: () => call("/auth/logout", "POST"),
  wallet: () => call("/wallet"),
  deposit: (amount) => call("/wallet/deposit", "POST", { amount }),
  withdraw: (amount, pin) => call("/wallet/withdraw", "POST", { amount, pin }),
  tables: (game = "rami") => call(`/tables?game=${encodeURIComponent(game)}`),
  createTable: (b) => call("/tables", "POST", b),
  table: (id) => call(`/tables/${id}`),
  joinTable: (id) => call(`/tables/${id}/join`, "POST"),
  leaveTable: (id) => call(`/tables/${id}/leave`, "POST"),
  startTable: (id) => call(`/tables/${id}/start`, "POST"),
  publicTable: (id) => call(`/tables/${id}/public`),
  queueTable: (id) => call(`/tables/${id}/queue`, "POST"),
  unqueueTable: (id) => call(`/tables/${id}/unqueue`, "POST"),
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
