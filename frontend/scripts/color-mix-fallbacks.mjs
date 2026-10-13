// Vite plugin: gives `color-mix()` colours a working fallback on browsers that
// lack it (Safari < 16.2), in BOTH themes.
//
// Two shapes of CSS need it.
//
// 1. Tailwind's `/opacity` utilities. `bg-panel/90` becomes
//
//      .bg-panel\/90 {
//        background-color: #ffffffe6;                      <- fallback
//        @supports (color: color-mix(in lab, red, red)) {
//          background-color: color-mix(in oklab, var(--color-panel) 90%, transparent);
//        }
//      }
//
//    The fallback is resolved at build time from the @theme value, which is the
//    LIGHT theme -- it cannot see the `:root[data-theme="dark"]` override. So on
//    an older Safari every translucent colour stayed light in dark mode (a white
//    header on a dark page).
//
// 2. Hand-written `color-mix()` in index.css, which has no fallback at all: the
//    browser drops the whole declaration, so the border, shadow, glow or
//    background simply is not there, in either theme.
//
// For both, this emits the light value as a plain colour and, where the dark
// theme resolves differently, a dark twin that applies only when color-mix is
// unsupported:
//
//    @supports not (color: color-mix(in lab, red, red)) {
//      :where(:root[data-theme="dark"]) .bg-panel\/90 { background-color: #0a1815e6 }
//    }
//
// `:where()` keeps the twin's specificity equal to the original rule, so
// variants that come later in the cascade (hover:, focus:) still win exactly as
// before. Browsers that do support color-mix never see any of it change.
//
// It runs as a Vite plugin rather than through `css.postcss`: with the
// lightningcss transformer Vite skips PostCSS entirely, and the nested form in
// (1) only exists in Tailwind's raw output (Lightning CSS flattens it).

import postcss from "postcss";

const DARK_ROOT = ':root[data-theme="dark"]';
const MIX_TEST = "color-mix(in lab, red, red)";

const COLOR = String.raw`(var\(--[\w-]+\)|transparent|#[0-9a-fA-F]{3,8})`;
const PCT = String.raw`(?:\s+([\d.]+)%)?`;
const MIX = new RegExp(String.raw`color-mix\(in oklab,\s*${COLOR}${PCT},\s*${COLOR}${PCT}\)`, "g");


// Tailwind's build-time minifier drops the quotes: [data-theme="dark"] becomes
// [data-theme=dark]. Compare without them.
const unquoted = (selector) => selector.replace(/["']/g, "");

function collectTokens(root) {
  const light = new Map();
  const dark = new Map();
  root.walkRules((rule) => {
    const isDark = splitSelectorList(rule.selector).map(unquoted).includes(unquoted(DARK_ROOT));
    const isLight = splitSelectorList(rule.selector).includes(":root");
    if (!isDark && !isLight) return;
    rule.walkDecls(/^--/, (decl) => (isDark ? dark : light).set(decl.prop, decl.value.trim()));
  });
  return { light, dark };
}

// "#rgb" | "#rrggbb" | "#rrggbbaa" -> [r, g, b, a] (a in 0..1), else null.
function parseHex(value) {
  const m = /^#([0-9a-f]+)$/i.exec(value);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

// A colour operand -> [r, g, b, a]. Follows var() aliases (--color-surface ->
// --color-fg). A token the dark theme does not override falls back to the light
// value, which is what the browser would use too.
function resolve(operand, tokens, theme, seen = new Set()) {
  if (operand === "transparent") return [0, 0, 0, 0];
  const v = /^var\((--[\w-]+)\)$/.exec(operand);
  if (!v) return parseHex(operand);
  const name = v[1];
  if (seen.has(name)) return null;
  seen.add(name);
  const value = (theme === "dark" ? tokens.dark.get(name) : undefined) ?? tokens.light.get(name);
  return value ? resolve(value.trim(), tokens, theme, seen) : null;
}

// Premultiplied-alpha mix, the way color-mix() treats transparent. Done in sRGB
// rather than oklab: this is only the fallback for browsers without the real
// thing, and the two agree to within a few units at these percentages.
function mix(a, pa, b, pb) {
  if (pa == null && pb == null) pa = pb = 50;
  else if (pa == null) pa = 100 - pb;
  else if (pb == null) pb = 100 - pa;
  const total = pa + pb;
  const wa = pa / total;
  const wb = pb / total;
  const alpha = a[3] * wa + b[3] * wb;
  if (alpha === 0) return [0, 0, 0, 0];
  const ch = (i) => Math.round((a[i] * a[3] * wa + b[i] * b[3] * wb) / alpha);
  return [ch(0), ch(1), ch(2), alpha];
}

const toHex = ([r, g, b, a]) => {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ""}`;
};

// Replaces every color-mix() in a value with a plain colour for `theme`.
// Returns null if any of them cannot be resolved -- a half-converted value is
// worse than none.
function flatten(value, tokens, theme) {
  let ok = true;
  const out = value.replace(MIX, (_, c1, p1, c2, p2) => {
    const a = resolve(c1, tokens, theme);
    const b = resolve(c2, tokens, theme);
    if (!a || !b) {
      ok = false;
      return "";
    }
    return toHex(mix(a, p1 == null ? null : parseFloat(p1), b, p2 == null ? null : parseFloat(p2)));
  });
  return ok && !out.includes("color-mix(") ? out : null;
}

// Splits a selector list on its top-level commas. Class names from Tailwind's
// arbitrary values contain escaped commas (`\,`) and bracketed or parenthesised
// ones, none of which separate selectors.
function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "\\") i++;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map((p) => p.trim());
}

// ".a, .b" -> ':where(:root[data-theme="dark"]) .a, :where(...) .b'
const darkSelector = (selector) =>
  splitSelectorList(selector)
    .map((s) => `:where(${DARK_ROOT}) ${s}`)
    .join(", ");

const insideSupports = (node) => {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "supports") return true;
  return false;
};

function plugin() {
  return {
    postcssPlugin: "trex-color-mix-fallbacks",
    Once(root, { Rule, AtRule }) {
      const tokens = collectTokens(root);
      if (tokens.dark.size === 0) return;

      // anchor: the node the dark twin goes after.
      const jobs = [];

      // (1) Tailwind: decls inside an @supports(color-mix) block already have a
      // light fallback next to them; only the dark twin is missing.
      root.walkAtRules("supports", (at) => {
        if (!at.params.includes(MIX_TEST)) return;
        const targets =
          at.parent?.type === "rule"
            ? [{ anchor: at.parent, rule: at.parent, decls: at.nodes }]
            : (at.nodes ?? []).filter((n) => n.type === "rule").map((rule) => ({ anchor: at, rule, decls: rule.nodes }));
        for (const { anchor, rule, decls } of targets) {
          const dark = decls
            .filter((d) => d.type === "decl")
            .map((d) => ({ prop: d.prop, value: flatten(d.value, tokens, "dark"), important: d.important }));
          // When the colour is a runtime alias (shadcn's `bg-input/30` ->
          // var(--input)) Tailwind cannot resolve it, so its fallback is the
          // bare `var(--input)`: opaque, alpha lost. Replace it with the real
          // translucent light value.
          // Nested form: the fallback sits beside the @supports. Flattened form
          // (build output): it is the rule just before the @supports block.
          const fallbackRule = at.parent?.type === "rule" ? rule : at.prev()?.type === "rule" && at.prev().selector === rule.selector ? at.prev() : null;
          if (fallbackRule) {
            for (const d of decls) {
              if (d.type !== "decl") continue;
              const light = flatten(d.value, tokens, "light");
              if (!light) continue;
              fallbackRule.each((n) => {
                if (n.type === "decl" && n.prop === d.prop && /^var\(--[\w-]+\)$/.test(n.value.trim())) n.value = light;
              });
            }
          }
          jobs.push({ anchor, selector: rule.selector, light: [], dark });
        }
      });

      // (2) Hand-written: no fallback exists, so add the light one too.
      root.walkDecls((decl) => {
        if (!decl.value.includes("color-mix(") || insideSupports(decl)) return;
        if (decl.parent?.type !== "rule" || decl.prop.startsWith("--")) return;
        const rule = decl.parent;
        const lightValue = flatten(decl.value, tokens, "light");
        if (!lightValue) return;
        jobs.push({
          anchor: rule,
          selector: rule.selector,
          light: [{ node: decl, prop: decl.prop, value: lightValue, important: decl.important }],
          dark: [{ prop: decl.prop, value: flatten(decl.value, tokens, "dark"), important: decl.important }],
        });
      });

      for (const job of jobs) {
        // The light fallback goes BEFORE the color-mix declaration so the real
        // one overrides it wherever it is supported.
        for (const { node, prop, value, important } of job.light) node.before({ prop, value, important });

        const lightByProp = new Map(job.light.map((l) => [l.prop, l.value]));
        const changed = job.dark.filter((d) => d.value && d.value !== lightByProp.get(d.prop));
        if (changed.length === 0) continue;

        const twin = new AtRule({ name: "supports", params: `not (color: ${MIX_TEST})` });
        const rule = new Rule({ selector: darkSelector(job.selector) });
        for (const { prop, value, important } of changed) rule.append({ prop, value, important });
        twin.append(rule);
        job.anchor.after(twin);
      }
    },
  };
}
plugin.postcss = true;

// Must be listed AFTER the tailwindcss() plugin so it sees the generated CSS.
export default function colorMixFallbacks() {
  return {
    name: "trex:color-mix-fallbacks",
    enforce: "pre",
    async transform(code, id) {
      if (!/\.css(?:$|\?)/.test(id) || !code.includes("color-mix(")) return null;
      const result = await postcss([plugin()]).process(code, { from: id, map: false });
      return { code: result.css, map: null };
    },
  };
}
