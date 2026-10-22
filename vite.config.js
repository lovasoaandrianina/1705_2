import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, /api est redirigé vers le serveur Express (pas de CORS à gérer)
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
});
