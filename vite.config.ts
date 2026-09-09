import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
// `lovable-tagger` was dropped from package.json in 8ba2485 but its import was
// left here, so loading this config threw ERR_MODULE_NOT_FOUND and both `npm run
// dev` and `vite build` died on any clean install. Re-add the package as a
// devDependency if Lovable's component tagging is wanted back.
export default defineConfig(({ mode }) => {
  /*
    A shell with `NODE_ENV=production` set breaks dev outright: Vite picks
    React's production `jsx-runtime` through the export conditions while the SWC
    plugin still emits `jsxDEV` calls, so the app throws "_jsxDEV is not a
    function" on first render and serves a blank page. The command being run
    decides this, not whatever the shell happens to export.
  */
  process.env.NODE_ENV = mode === "production" ? "production" : "development";

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
