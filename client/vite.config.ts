import Path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": Path.resolve(import.meta.dirname!, "../shared/src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The app is opened through the backend's port; HMR connects to Vite directly
    hmr: { clientPort: 5173 },
    proxy: {
      "/api": "http://localhost:8600",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
