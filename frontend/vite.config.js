import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

// Read the ONE root .env as the source of truth for the network identity.
// PORT + PUBLIC_HOST here must match what the Go backend reads in main.go,
// so the dev server proxies /api and /uploads to the same place the
// production bundle calls home (relative URLs, same-origin in prod).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const publicHost = process.env.PUBLIC_HOST || "localhost";
const backendPort = process.env.PORT || "8087";
// Override with VITE_PROXY_TARGET if the backend runs somewhere else.
const backendTarget =
  process.env.VITE_PROXY_TARGET || `http://${publicHost}:${backendPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  server: {
    port: 3000,
    host: true,
    // Development mode: the app talks to the backend with relative URLs
    // (/api/..., /uploads/...). In production the embedded bundle is served
    // from the backend itself so these resolve same-origin. In dev, vite
    // lives on :3000 and has no backend of its own — proxy those paths to
    // the backend at http://<PUBLIC_HOST>:<PORT> from the root .env.
    proxy: {
      "/api": { target: backendTarget, changeOrigin: true },
      "/uploads": { target: backendTarget, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-select", "lucide-react"],
        },
      },
    },
  },
});
