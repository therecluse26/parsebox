import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  return {
    base: "",
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      // An identifier, not an object: Vite replaces the name as text, and libraries use `global` as a parameter name
      global: "globalThis",
    },
    build: {
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true
      }
    },
    worker: {
      format: "es",
    },
    optimizeDeps: {
      // The worker imports the parsers, so the dev server scans it for dependencies too
      entries: ["index.html", "src/workers/convert.worker.ts"],
      include: ["react", "react-dom"],
    },
  };
});
