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
          // Keep the optional presenter SDK out of the page's UI chunk and
          // retain the existing per-chunk size gate for its protocol code.
          livekit: ["livekit-client"],
          livekitProtocol: ["@livekit/protocol", "@bufbuild/protobuf"],
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
      // The pinned SDK publishes its TS sources. Its prebundled ESM file
      // inlines protocol code, preventing Rollup from enforcing our chunk
      // budget through normal dependency splitting. Build those same sources
      // so the SDK and protocol remain independently bounded chunks.
      "livekit-client": path.resolve(__dirname, "node_modules/livekit-client/src/index.ts"),
    },
  },
}));
