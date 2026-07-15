import { defineConfig } from "vite";
import react from "@vitejs/plugin-react"; // <-- This import was missing!
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // 1. Register both React and Tailwind plugins
  plugins: [
    react(), 
    tailwindcss()
  ],
  
  // 2. Tauri specific configurations
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Tell Vite to ignore watching `src-tauri` to prevent restart loops
      ignored: ["**/src-tauri/**"],
    },
  },
});