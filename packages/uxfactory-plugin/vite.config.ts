import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(__dirname, "ui"),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: path.join(__dirname, "dist"),
    emptyOutDir: false, // esbuild owns code.js in the same dir
    rollupOptions: { input: path.join(__dirname, "ui", "index.html") },
  },
});
