import { useEffect, useState } from "react";
import { isMuted, onMuteChange, play, setMuted } from "../sound";

// Bouton son (activé / coupé), mémorisé sur l'appareil
export default function SoundToggle({ className = "", style }) {
  const [m, setM] = useState(isMuted());
  useEffect(() => onMuteChange(() => setM(isMuted())), []);
  return (
    <button type="button" className={className} style={style} aria-label={m ? "Activer les sons" : "Couper les sons"} title="Sons"
      onClick={() => { setMuted(!m); if (m) setTimeout(() => play("click"), 30); }}>{m ? "🔇" : "🔊"}</button>
  );
}
