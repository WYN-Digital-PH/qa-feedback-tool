// A shell with `NODE_ENV=production` set makes Vite resolve Node builtins for
// the browser, so `node:fs`/`node:path` arrive as empty stubs and every test
// that reads a source file off disk dies with "readFileSync is not a function".
// Tests always run in test mode; pin it here so the ambient value cannot leak in.
process.env.NODE_ENV = "test";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
