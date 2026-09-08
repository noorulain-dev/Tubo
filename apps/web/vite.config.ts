import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Load .env from the repo root so VITE_* vars (VITE_API_URL, VITE_AUTH_TOKEN)
// defined in the root .env are exposed to the browser. Vite's default envDir is
// this package's directory, which has no .env.
export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
});
