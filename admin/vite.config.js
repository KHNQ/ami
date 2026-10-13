import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import colorMixFallbacks from "../frontend/scripts/color-mix-fallbacks.mjs";

const SHARED = fileURLToPath(new URL("../frontend/src", import.meta.url));

// @shared files physically live outside this project root, so a bare
// import inside one of them (e.g. ToastContext.jsx's `from "react"`) is
// resolved by walking up from THAT file's real location -- which finds
// frontend/node_modules, not admin/node_modules, if the two ever contain
// different copies of the same package. Two copies of React on one page
// means every hook in a @shared component throws "Invalid hook call",
// because the shared component's React and this app's react-dom render tree
// are different module instances that don't recognise each other's dispatch
// context. This bit the admin app for real: framer-motion (used by
// ToastContext, Button, BottomSheet, SegmentedControl) wasn't declared here
// at all, so it -- and the React copy underneath it -- silently resolved to
// frontend's install instead. Pinning both by absolute path, rather than
// just listing them in package.json, means this can't quietly recur the
// next time a @shared file starts using some other singleton-sensitive
// package.
const OWN = (pkg) => fileURLToPath(new URL(`./node_modules/${pkg}`, import.meta.url));

// The admin control room, built and deployed separately from the storefront.
//
// It compiles the *same* source files for shared primitives via the @shared
// alias rather than copying them -- one source of truth for Button, Card,
// useAsync, format, the theme, and the HTTP layer, with no package publishing
// and no drift between two copies that slowly diverge.
//
// Deliberately no PWA plugin and no SSR: an internal back-office tool has no
// use for offline precaching or for being crawled, and both would be pure
// weight here.
export default defineConfig({
  // colorMixFallbacks must come after tailwindcss(): it patches the generated
  // CSS so translucent theme colours stay right in dark mode on Safari < 16.2.
  plugins: [react(), tailwindcss(), colorMixFallbacks()],

  resolve: {
    alias: {
      "@shared": SHARED,
      react: OWN("react"),
      "react-dom": OWN("react-dom"),
      "framer-motion": OWN("framer-motion"),
      // The shared Markdown renderer must not pull in a regex lookbehind
      // (older Safari cannot parse it); see frontend/src/lib/shims/.
      "mdast-util-gfm-autolink-literal": fileURLToPath(
        new URL("../frontend/src/lib/shims/gfm-autolink-literal-mdast.js", import.meta.url)
      ),
      "micromark-extension-gfm-autolink-literal": fileURLToPath(
        new URL("../frontend/src/lib/shims/gfm-autolink-literal-micromark.js", import.meta.url)
      ),
    },
    dedupe: ["react", "react-dom", "framer-motion"],
  },

  server: {
    port: 5174,
    // The alias points outside this project root, so Vite's dev server has to
    // be told those files are allowed to be served.
    //
    // That includes the typefaces: they are npm packages installed under the
    // storefront (frontend/node_modules/@fontsource*), and the shared
    // stylesheet that declares them is compiled here too. Without this the dev
    // server answers 403 for the font files and the console silently renders
    // in the system fallback (a production build bundles them and is fine).
    fs: {
      allow: [
        SHARED,
        fileURLToPath(new URL("../frontend/node_modules", import.meta.url)),
        fileURLToPath(new URL(".", import.meta.url)),
      ],
    },
    proxy: {
      // Cheque scans and product images are served by the API as raw bytes.
      // Proxying them keeps them same-origin in dev, matching production.
      "^/(products|cheques)/[^/]+/image$": {
        // A backend on another machine (VITE_API_BASE_URL set, e.g. by
        // bootAdmin.sh) is proxied to directly; otherwise it is local.
        target: process.env.VITE_API_BASE_URL || `http://localhost:${process.env.VITE_API_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },

  // See frontend/vite.config.js: older Safari cannot parse syntax that some
  // dependencies ship (class static blocks), so the dev pre-bundle and the
  // production build are both lowered to Safari 14.
  // Tailwind v4 emits `@media (width >= 40rem)`, which Safari only parses from
  // 16.4; older Safari drops every breakpoint and shows the mobile layout.
  // Lightning CSS lowers them to min-width, in dev as well as in the build.
  css: {
    transformer: "lightningcss",
    lightningcss: { targets: { safari: 14 << 16 } },
  },

  optimizeDeps: {
    rolldownOptions: { transform: { target: ["es2020", "safari14"] } },
  },

  build: {
    target: ["es2020", "safari14"],
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // A function, not an object: Vite 8 / Rolldown requires it.
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-router")) return "vendor-router";
            if (id.includes("react")) return "vendor-react";
            if (id.includes("lucide")) return "vendor-icons";
            return "vendor";
          }
        },
      },
    },
  },

  esbuild: {
    drop: process.env.NODE_ENV === "production" ? ["console", "debugger"] : [],
  },
});
