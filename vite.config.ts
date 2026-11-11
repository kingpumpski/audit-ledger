import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Project Pages deployment uses /audit-ledger/; development remains at /.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/audit-ledger/" : "/",
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalizedId)) return "react-vendor";
          if (normalizedId.includes("/node_modules/@supabase/")) return "supabase-vendor";
          if (normalizedId.includes("/node_modules/@tanstack/")) return "query-vendor";
        },
      },
    },
  },
}));
