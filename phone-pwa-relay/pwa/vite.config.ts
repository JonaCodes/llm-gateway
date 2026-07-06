import { defineConfig } from "vite";

export default defineConfig({
  root: "pwa",
  build: {
    outDir: "../dist/pwa",
    emptyOutDir: true
  }
});
