import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const port = process.env.PORT || "8787";
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.HOST || "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${port}`,
      "/ws": { target: `ws://127.0.0.1:${port}`, ws: true },
    },
  },
  build: { outDir: "dist" },
});
