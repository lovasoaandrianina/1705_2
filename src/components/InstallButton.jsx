import { useEffect, useState } from "react";

/** Bouton « Ajouter à l'écran d'accueil » (PWA) */
export default function InstallButton({ className = "btn" }) {
  const [prompt, setPrompt] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onBIP = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", () => { setDone(true); setPrompt(null); });
    // déjà installé ?
    if (window.matchMedia("(display-mode: standalone)").matches) setDone(true);
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  if (done) return null;

  const install = async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setDone(true);
      setPrompt(null);
      return;
    }
    // iOS / navigateurs sans beforeinstallprompt
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(isIOS
      ? "Sur iPhone : touche Partager ⎋ puis « Sur l'écran d'accueil »."
      : "Ouvre le menu du navigateur et choisis « Ajouter à l'écran d'accueil ».");
  };

  return (
    <button type="button" className={className} onClick={install} title="Installer l'application">
      Installer l'app
    </button>
  );
}
