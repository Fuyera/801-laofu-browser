import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve("web"),
  plugins: [react()],
  build: { outDir: path.resolve("dist/web"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: { "/v1": { target: "http://127.0.0.1:17889", ws: true } },
  },
});
