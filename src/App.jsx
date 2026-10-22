import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import RamiMenu from "./pages/RamiMenu";
import Lobby from "./pages/Lobby";
import TableRoom from "./pages/TableRoom";
import Invite from "./pages/Invite";
import PokerLobby from "./pages/PokerLobby";
import PokerInvite from "./pages/PokerInvite";
import PokerTable from "./games/PokerTable";
import Rami from "./games/Rami";

// Lien d'invitation : https://ton-site/?table=12 → l'id est mémorisé, il survit à la connexion / l'inscription
const invited = new URLSearchParams(window.location.search).get("table");
if (invited) { sessionStorage.setItem("invite", invited); window.history.replaceState({}, "", window.location.pathname); }

// Lien d'invitation poker : https://ton-site/?poker=12
const invitedPoker = new URLSearchParams(window.location.search).get("poker");
if (invitedPoker) { sessionStorage.setItem("invitePoker", invitedPoker); window.history.replaceState({}, "", window.location.pathname); }

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());
  const [waking, setWaking] = useState(false); // serveur gratuit en cours de réveil
  const [screen, setScreen] = useState("dashboard"); // dashboard | rami-menu | rami-free | rami-lobby | invite | table
  const [tableId, setTableId] = useState(null);
  const [pokerId, setPokerId] = useState(null);
  const [queue, setQueue] = useState(null); // id de la table dont j'attends une place
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!getToken()) return undefined;
    let alive = true, tries = 0, timer;
    const boot = () => api.me().then((u) => { if (alive) { setUser(u); setWaking(false); setReady(true); } }).catch((e) => {
      if (!alive) return;
      if (e.status === 401) { setToken(null); setReady(true); }                       // jeton vraiment invalide : retour à la connexion
      else if (tries++ < 45) { setWaking(true); timer = setTimeout(boot, 2500); }     // serveur qui dort / réseau coupé : on ne déconnecte pas, on réessaie
      else setReady(true);
    });
    boot();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  // une fois connecté : ouvrir l'invitation reçue, et retrouver ma liste d'attente éventuelle
  useEffect(() => {
    if (!user) return;
    const inv = sessionStorage.getItem("invite");
    if (inv) { setTableId(+inv); setScreen("invite"); }
    const ip = sessionStorage.getItem("invitePoker");
    if (ip) { setPokerId(+ip); setScreen("poker-invite"); }
    api.tables().then((d) => setQueue(d.myQueue ? d.myQueue.tableId : null)).catch(() => {});
  }, [!!user]);
  // le solde est relu à chaque retour vers un écran qui l'affiche
  useEffect(() => {
    if (user && ["dashboard", "rami-menu", "rami-lobby", "domino-lobby", "poker-lobby"].includes(screen)) api.me().then(setUser).catch(() => {});
  }, [screen]);
  // en liste d'attente : on surveille l'arrivée d'une place (le premier de la liste est assis automatiquement)
  useEffect(() => {
    if (!user || queue === null) return;
    const t = setInterval(async () => {
      try {
        const d = await api.tables();
        if (d.mine === queue) { setQueue(null); setToast(queue); }
        else setQueue(d.myQueue ? d.myQueue.tableId : null);
      } catch { /* réseau : on réessaie */ }
    }, 3000);
    return () => clearInterval(t);
  }, [user, queue]);

  const onAuth = ({ token, user }) => { setToken(token); setUser(user); };
  const logout = async () => {
    try { await api.logout(); } catch { /* session déjà expirée */ }
    setToken(null); setUser(null); setScreen("dashboard"); setQueue(null);
  };
  const open = (id) => { sessionStorage.removeItem("invite"); setTableId(id); setScreen("table"); };

  if (!ready) return <div className="shell center">{waking ? "Le serveur se réveille… (jusqu'à une minute après une période d'inactivité)" : "Chargement…"}</div>;
  if (!user) return <AuthPage onAuth={onAuth} />;

  let view;
  if (screen === "rami-free") view = <Rami onExit={() => setScreen("rami-menu")} />;
  else if (screen === "rami-menu") view = <RamiMenu onFree={() => setScreen("rami-free")} onFriends={() => setScreen("rami-lobby")} onBack={() => setScreen("dashboard")} />;
  else if (screen === "rami-lobby") view = <Lobby game="rami" user={user} setQueue={setQueue} onOpen={open} onBack={() => setScreen("rami-menu")} />;
  else if (screen === "domino-lobby") view = <Lobby game="domino" user={user} setQueue={setQueue} onOpen={open} onBack={() => setScreen("dashboard")} />;
  else if (screen === "poker-lobby") view = <PokerLobby user={user} onOpen={(id) => { setPokerId(id); setScreen("poker-table"); }} onBack={() => setScreen("dashboard")} />;
  else if (screen === "poker-invite") view = <PokerInvite id={pokerId} user={user} onOpen={(id) => { sessionStorage.removeItem("invitePoker"); setPokerId(id); setScreen("poker-table"); }} onBack={() => { sessionStorage.removeItem("invitePoker"); setScreen("dashboard"); }} />;
  else if (screen === "poker-table") view = <PokerTable id={pokerId} user={user} onExit={() => setScreen("poker-lobby")} />;
  else if (screen === "invite") view = <Invite id={tableId} setQueue={setQueue} onOpen={open} onBack={() => { sessionStorage.removeItem("invite"); setScreen("dashboard"); }} />;
  else if (screen === "table") view = <TableRoom id={tableId} user={user} onExit={(kind) => setScreen(kind === "domino" ? "domino-lobby" : "rami-lobby")} />;
  else view = <Dashboard user={user} setUser={setUser} onLogout={logout} onPlay={(g) => (g === "rami" ? setScreen("rami-menu") : g === "domino" ? setScreen("domino-lobby") : g === "poker" && setScreen("poker-lobby"))} />;

  return (
    <>
      {view}
      {toast && (
        <div className="toast">
          <span>🎉 Une place s'est libérée : tu es assis à la table #{toast} (ta mise a été versée au pot).</span>
          <button className="btn gold" onClick={() => { open(toast); setToast(null); }}>Ouvrir</button>
          <button className="btn ghost" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </>
  );
}