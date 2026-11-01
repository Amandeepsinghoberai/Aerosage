import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// dev: `npm run dev` proxies /api to the backend on :8000.  build: `npm run build` -> dist/ (served by the backend).
export default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:8000" } } });
