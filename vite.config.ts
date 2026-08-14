import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare Vite plugin runs src/worker/index.ts inside the real
// Workers runtime (workerd) during `vite dev`. Production Worker bundling
// happens separately, at `wrangler deploy` time, straight from `main` in
// wrangler.jsonc — `vite build` here only produces the static client
// assets (dist/client) that the `assets` binding serves.
export default defineConfig({
  root: "src/frontend",
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src/frontend"),
    },
  },
});
