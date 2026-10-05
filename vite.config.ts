import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The agent server (npm run server) holds the API key; the UI only talks to it.
    proxy: { "/api": "http://localhost:8787" },
  },
});
