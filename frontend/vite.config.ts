import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";

export default defineConfig(({ mode }) => ({
  // "/" for Netlify and dev; the GitHub Pages workflow sets VITE_BASE=/<repo-name>/.
  base: loadEnv(mode, ".", "VITE_").VITE_BASE || "/",
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { port: 5173, proxy: { "/api": "http://localhost:8000" } },
}));
