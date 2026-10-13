import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library's auto-cleanup-between-tests relies on detecting a global
// `afterEach` -- this project runs Vitest with `globals: false` (no magic
// globals, matching the rest of the codebase's explicit-import style), so
// it has to be wired up by hand here instead.
afterEach(cleanup);

// Browser APIs jsdom does not implement, stubbed once here rather than in
// each test that happens to render a component using them.
//
// `matchMedia` is the one that bites: useReducedMotion calls it in an effect,
// so ANY component that animates throws on render under test rather than
// failing an assertion. The stub reports no preference, which is the default
// every test wants.
//
// IntersectionObserver is deliberately left undefined. Components here treat
// its absence as "assume visible" (see DriftWall, SupplyWorldMap), and a
// no-op stub would instead leave them waiting forever for a callback that
// never comes -- turning a working fallback into a silent blank render.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
