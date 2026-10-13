import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import colorMixFallbacks from "./scripts/color-mix-fallbacks.mjs";

// The oldest browsers the storefront must run on. Safari is the one that sets
// the floor: it ships syntax later than the others, and a single construct it
// cannot parse (a class `static { }` block, a regex lookbehind) is not a
// degraded page but a BLANK one -- the module fails to load and nothing
// renders. Safari 15 (the last release for macOS 11/12 machines that cannot
// upgrade) is the target; the bundler lowers anything newer, including inside
// dependencies, which is where the offending syntax was (radix-ui, three).
const BROWSER_TARGET = ["es2020", "safari14"];

// The same floor, for CSS. Tailwind v4 writes breakpoints as range-syntax media
// queries (`@media (width >= 40rem)`), which Safari only parses from 16.4. An
// older Safari silently drops every one of them, so no `md:`/`lg:` rule ever
// applies and a desktop window renders the mobile layout. Lightning CSS lowers
// them to `(min-width: 40rem)`. The production build already did that through
// build.target; this applies it to the dev server too, where Tailwind's output
// was served raw.
const CSS_TARGETS = { safari: 14 << 16 };

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiOrigin = (() => {
    try {
      return new URL(env.VITE_API_BASE_URL || "http://localhost:3000").origin;
    } catch {
      return "http://localhost:3000";
    }
  })();
  // Workbox serializes function-form urlPattern predicates via .toString()
  // into the compiled service worker -- a reference to this outer
  // `apiOrigin` closure variable would come along as literal dead text
  // (`apiOrigin`) with nothing defining it in the SW's scope, throwing
  // ReferenceError the first time that route is evaluated. A RegExp
  // doesn't have this problem: Workbox matches it internally without
  // needing to serialize a predicate function at all.
  const apiOriginPattern = new RegExp(`^${apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

  return {
    plugins: [
      react(),
      // The SSR bundle (`vite build --ssr`, see server.js) only needs the
      // JSX transform -- CSS processing and a service worker manifest are
      // meaningless for a Bun-side render-to-string module.
      !isSsrBuild && tailwindcss(),
      // Static fallbacks (light and dark) for color-mix() colours on browsers without
      // it, i.e. Safari < 16.2 -- see the plugin for why Tailwind's own fallback is wrong.
      // Order matters: it has to run on Tailwind's generated CSS.
      !isSsrBuild && colorMixFallbacks(),
      !isSsrBuild &&
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
        // SW only ever built for `vite build` -- matches the dev/prod split
        // already used for esbuild.drop below, and means the caching layer
        // never has to be reasoned about while iterating locally.
        devOptions: { enabled: false },
        manifest: {
          name: "Ashkan Medical Idea",
          short_name: "Ashkan Medical",
          description: "Ashkan Medical Idea — buy products, build your space, earn on your network.",
          // Matches the <meta name="theme-color"> in index.html and the
          // light default in index.css -- OS chrome (status bar / task
          // switcher / splash) should agree with the theme the app
          // actually opens in.
          theme_color: "#ffffff",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,svg,woff2,png,ico}"],
          // The 3D stage is lazily imported and only ever reached by
          // scrolling a hero or opening a product page. Precaching it makes
          // every first visit pay ~670KB (three + gsap + the stage itself)
          // up front for something most sessions never render. Excluded
          // here, they still get cached the moment they're actually
          // fetched, by the CacheFirst /assets/ rule below -- so a repeat
          // visit is exactly as fast, and the first one is far cheaper.
          //
          // Partner logos and the story imagery are the same argument at a
          // smaller scale: they belong to /partners and /our-story, which most
          // sessions never open, so precaching all sixteen of them taxes every
          // first visit for nothing. The runtime rule below catches them on
          // first real fetch.
          globIgnores: [
            "**/vendor-three-*.js",
            "**/vendor-gsap-*.js",
            "**/vendor-worldmap-*.js",
            "**/DeviceStage-*.js",
            // Same reasoning as the 3D stage, and more so: the assistant
            // ships switched off (AI_ENABLED), so precaching its chunks made
            // every first visit pay ~100KB for a feature that is not there.
            // Still cached by the CacheFirst /assets/ rule the moment they
            // are genuinely fetched, so a deployment that turns it back on
            // loses nothing.
            "**/ChatDock-*.js",
            "**/AiRuntime-*.js",
            "**/AiStorefrontRuntime-*.js",
            "**/vendor-metalfx-*.js",
            "partners/**",
            "story/**",
            // Persian and Arabic type is for visitors reading those
            // languages; precaching it would charge every English visitor
            // for faces they will never render. The /assets/ CacheFirst rule
            // below picks it up the moment a page actually uses it.
            "**/vazirmatn-*.woff2",
            "**/ibm-plex-sans-arabic-*.woff2",
          ],
          navigateFallback: "/index.html",
          // Product images are served same-origin (proxied to the API, see
          // `server.proxy` above and api.productImageUrl). Without this they
          // match the navigation fallback and every <img> offline resolves
          // to the HTML shell -- a broken image on every card, which looks
          // far worse than a missing one.
          navigateFallbackDenylist: [/^\/products\/[^/]+\/image$/, /^\/cheques\//],
          runtimeCaching: [
            // Explicit guardrail, kept even though it's currently redundant
            // (the API is a different origin from the SPA today, so
            // Workbox's precache -- same-origin build output only -- could
            // never touch it anyway): if this ever moves to a same-origin
            // `/api` proxy path, this rule is what stops a live-money
            // response from ever being served stale from cache.
            { urlPattern: apiOriginPattern, handler: "NetworkOnly" },
            {
              urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith("/assets/"),
              handler: "CacheFirst",
              options: {
                cacheName: "trex-assets",
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            // Page imagery excluded from precache above -- cached once it is
            // actually rendered, so a repeat visit to /partners is instant
            // while a first visit to the storefront never pays for it.
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                (url.pathname.startsWith("/partners/") || url.pathname.startsWith("/story/")),
              handler: "CacheFirst",
              options: {
                cacheName: "trex-media",
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 },
              },
            },
          ],
        },
      }),
    ].filter(Boolean),
    // shadcn generates every component against the `@/` alias, so it has to
    // resolve here as well as in jsconfig.json (which only teaches the
    // editor, not the bundler).
    // Dev serves dependencies from a pre-bundle, built with its own target
    // (esnext by default). Without this the dev server works in Chrome and
    // serves Safari a radix-ui it cannot parse -- a blank page at :5173.
    css: {
      transformer: "lightningcss",
      lightningcss: { targets: CSS_TARGETS },
    },
    optimizeDeps: {
      rolldownOptions: { transform: { target: BROWSER_TARGET } },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // Bare-link detection in Markdown needs regex lookbehind, which older
        // Safari cannot parse -- see src/lib/shims/ for the whole story.
        "mdast-util-gfm-autolink-literal": fileURLToPath(
          new URL("./src/lib/shims/gfm-autolink-literal-mdast.js", import.meta.url)
        ),
        "micromark-extension-gfm-autolink-literal": fileURLToPath(
          new URL("./src/lib/shims/gfm-autolink-literal-micromark.js", import.meta.url)
        ),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Product images are referenced by a same-origin path so the same
        // markup works when server-rendered, on localhost, and from a phone
        // on the LAN (see api.productImageUrl). server.js proxies this in
        // production; this is the dev-server equivalent. Resolved here, on
        // the dev machine, so `localhost` is always the right target no
        // matter which host the browser used to reach Vite.
        "^/products/[^/]+/image$": {
          target: `http://localhost:${env.VITE_API_PORT || "3000"}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      // Mobile-only app targeting current browsers (per idea.md) -- no need
      // to transpile down for legacy engines, which just bloats output and
      // slows the parse/eval time that actually matters for load time.
      //
      // Not "es2022": that is a language level, and it lets class static blocks
      // through untranspiled, which older Safari cannot parse (blank page).
      // The SSR bundle runs on Bun, which has no such floor.
      target: isSsrBuild ? "es2022" : BROWSER_TARGET,
      // Client build -> dist/client, SSR build (`vite build --ssr`, see
      // server.js) -> dist/server -- kept apart since both exist alongside
      // each other for a single deploy (server.js reads from both).
      outDir: isSsrBuild ? "dist/server" : "dist/client",
      // Lets server.js reconstruct exactly which built asset each dynamic
      // import maps to -- unused for now (server.js reads the built
      // index.html directly instead) but cheap to have for later
      // (e.g. <link rel="modulepreload"> injection per SSR'd route).
      ssrManifest: !isSsrBuild,
      cssCodeSplit: true,
      // Skip the safari10 modulepreload polyfill; every target browser here
      // supports native modulepreload.
      modulePreload: { polyfill: false },
      esbuild: {
        // Dead-strip console/debugger from the production bundle only --
        // dev builds keep them for debugging.
        drop: mode === "production" ? ["console", "debugger"] : [],
        legalComments: "none",
      },
      rollupOptions: isSsrBuild
        ? undefined
        : {
            output: {
              // Split the rarely-changing, large third-party deps into their own
              // cacheable chunks so a normal app-code deploy doesn't invalidate
              // the vendor bundle the browser already cached from a prior visit.
              // (Rolldown, Vite 8's default bundler, requires this as a function
              // rather than the classic Rollup object-map form.)
              manualChunks(id) {
                if (!id.includes("node_modules")) return undefined;
                if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return "vendor-react";
                // framer-motion v13 delegates most of its implementation to the
                // separate motion-dom/motion-utils packages -- without matching
                // those too, most of its actual code silently lands in the
                // generic vendor chunk instead of caching alongside it.
                if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return "vendor-motion";
                if (id.includes("node_modules/lucide-react")) return "vendor-icons";
                // three and gsap are only ever reached through the lazily
                // imported DeviceStage / scroll-choreography modules, so
                // isolating them keeps them out of the initial payload --
                // a first paint of the storefront must not pay for WebGL.
                if (id.includes("node_modules/three")) return "vendor-three";
                if (id.includes("node_modules/gsap/")) return "vendor-gsap";
                // ~1.2MB of SVG path data for the supply-chain map. It is
                // lazily imported behind an intersection observer, but
                // falling through to the generic `vendor` chunk below would
                // put it back in the eager bundle and undo that entirely.
                if (id.includes("node_modules/@react-map/")) return "vendor-worldmap";
                // Same trap, same fix. The cult-ui shader backdrop and the
                // metal button are both lazily imported decoration, but
                // falling through to the generic `vendor` chunk below would
                // put ~550KB of WebGL back into the eager bundle and undo
                // the lazy boundary completely -- which is exactly what
                // happened the first time these were added.
                if (id.includes("node_modules/@paper-design/")) return "vendor-shaders";
                if (id.includes("node_modules/metal-fx/")) return "vendor-metalfx";
                return "vendor";
              },
            },
          },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./tests/setup.js",
      globals: false,
      // Scoped to tests/ only -- e2e/*.spec.js are Playwright specs (their
      // own `test`/`expect` from @playwright/test, run via `playwright
      // test`, not Vitest) and would otherwise get picked up by Vitest's
      // default include glob and fail on the API mismatch.
      include: ["tests/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    },
  };
});
