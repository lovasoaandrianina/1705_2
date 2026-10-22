import { useState } from "react";
import { api } from "../api";
import Avatar from "../components/Avatar";
import ThemeToggle from "../components/ThemeToggle";

// Réduit la photo à 128×128 (carré) pour qu'elle reste légère dans Turso
const resize = (file) => new Promise((ok, ko) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const m = Math.min(img.width, img.height);
    c.getContext("2d").drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, 128, 128);
    URL.revokeObjectURL(url);
    ok(c.toDataURL("image/jpeg", 0.8));
  };
  img.onerror = ko;
  img.src = url;
});

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [pseudo, setPseudo] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const f = e.target.files[0];
    if (f) try { setAvatar(await resize(f)); } catch { setErr("Image illisible"); }
  };
  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      onAuth(mode === "login" ? await api.login({ phone, pin }) : await api.register({ pseudo, phone, pin, avatar }));
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="shell">
      <div className="auth-top">
        <h1>Gasyno</h1>
        <ThemeToggle className="btn ghost theme-toggle" />
      </div>
      <p className="sub">Domino, Poker et Rami entre amis - Gagnez dès maintenant</p>
      <div className="tabs">
        <button type="button" className={`btn ${mode === "login" ? "on" : ""}`} onClick={() => setMode("login")}>Connexion</button>
        <button type="button" className={`btn ${mode === "register" ? "on" : ""}`} onClick={() => setMode("register")}>Inscription</button>
      </div>
      <form onSubmit={submit}>
        {mode === "register" && (
          <>
            <div className="photo">
              <Avatar user={{ pseudo: pseudo || "?", avatar }} big />
              <label className="btn ghost">
                {avatar ? "Changer la photo" : "Ajouter une photo (facultatif)"}
                <input type="file" accept="image/*" hidden onChange={pick} />
              </label>
            </div>
            <label className="field">Pseudo
              <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={16} autoComplete="username" required />
            </label>
          </>
        )}
        <label className="field">Téléphone
          <input type="tel" inputMode="tel" placeholder="+261 34 00 000 00" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
        </label>
        <label className="field">Code PIN (4 à 6 chiffres)
          <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="current-password" required />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy}>
          {busy ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>
      </form>
    </div>
  );
}
