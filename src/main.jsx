import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "./theme"; // applique le thème sauvegardé dès le démarrage

createRoot(document.getElementById("root")).render(<App />);
