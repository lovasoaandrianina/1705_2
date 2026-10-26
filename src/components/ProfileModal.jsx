import { useState } from "react";
import { api } from "../api";
import Avatar from "./Avatar";

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

export default function ProfileModal({ user, setUser, onClose }) {
  const [pseudo, setPseudo] = useState(user.pseudo || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [avatar, setAvatar] = useState(user.avatar || null);
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (f) try { setAvatar(await resize(f)); } catch { setErr("Image illisible"); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setOk(""); setBusy(true);
    try {
      const body = { pseudo, phone, avatar };
      if (pin) { body.pin = pin; body.currentPin = currentPin; }
      else if (phone !== user.phone) body.currentPin = currentPin;
      const { user: u } = await api.updateProfile(body);
      setUser(u);
      setOk("Profil mis à jour");
      setPin(""); setCurrentPin("");
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="head"><b style={{ fontSize: 18 }}>Mon profil</b><button type="button" className="btn ghost" onClick={onClose}>Fermer</button></div>

        <div className="photo" style={{ marginBottom: 12 }}>
          <Avatar user={{ pseudo, avatar }} big />
          <label className="btn ghost">
            {avatar ? "Changer la photo" : "Ajouter une photo"}
            <input type="file" accept="image/*" hidden onChange={pick} />
          </label>
        </div>

        <label className="field">Pseudo
          <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={16} required />
        </label>
        <label className="field">Téléphone
          <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        <label className="field">Nouveau PIN (facultatif)
          <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Laisser vide pour ne pas changer" />
        </label>
        {(pin || phone !== user.phone) && (
          <label className="field">PIN actuel (requis)
            <input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))} required />
          </label>
        )}

        {err && <div className="err">{err}</div>}
        {ok && <div className="info" style={{ borderColor: "var(--gold)" }}>{ok}</div>}
        <button className="btn gold" style={{ width: "100%" }} disabled={busy}>{busy ? "…" : "Enregistrer"}</button>
      </form>
    </div>
  );
}
