import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Tipos e schemas zod do servidor (contrato da API), importados sem copiar
      "@server": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    // A API e o SSE ficam no Fastify; o proxy mantém uma só origem para o cookie de sessão
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
});
