import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    // @solana/web3.js v1 reaches for node globals when building transactions.
    global: "globalThis",
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: { buffer: "buffer" },
  },
  optimizeDeps: { include: ["buffer", "@solana/web3.js"] },
});
