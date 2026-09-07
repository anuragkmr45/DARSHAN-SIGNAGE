import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "^/(media-staging|media-source|media-ready|media-thumbnails|device-screenshots|logs-audit|logs-system|logs-auth|logs-heartbeats|logs-proof-of-play|archives)/": {
        target: "http://localhost:9000",
        changeOrigin: false,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    sourcemap: false,
    minify: "esbuild",
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query", "@reduxjs/toolkit", "react-redux", "redux-persist"],
        },
      },
    },
  },
  esbuild: {
    drop: mode === "production" ? ["debugger"] : [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
