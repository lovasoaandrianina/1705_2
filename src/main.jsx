import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "./theme"; // applique le thème sauvegardé dès le démarrage

// Back office : https://ton-site/admin (chargé à part : les joueurs ne téléchargent jamais ce code)
const Admin = lazy(() => import("./admin/AdminApp.jsx"));
const isAdmin = /^\/admin\/?$/.test(window.location.pathname);

createRoot(document.getElementById("root")).render(
  isAdmin ? <Suspense fallback={<div style={{ padding: 30, color: "#888" }}>Chargement…</div>}><Admin /></Suspense> : <App />
);
