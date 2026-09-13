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
    alias: {
      // Trailing slash forces the npm package rather than the node builtin.
      // Without it Vite externalises "buffer" and globalThis.Buffer is never
      // set, which only surfaces when web3.js serialises a transaction.
      buffer: "buffer/",
    },
  },
  optimizeDeps: { include: ["buffer", "@solana/web3.js"] },
});
