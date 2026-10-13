#!/usr/bin/env node
/**
 * Converts physical Tailwind direction utilities to logical ones, so the
 * layout mirrors correctly under `dir="rtl"` for Arabic and Persian.
 *
 * `ml-3` is margin-LEFT and stays on the left in every language. `ms-3` is
 * margin-inline-START, which is the left in English and the right in Persian.
 * Without this pass, an RTL page has its text mirrored but every gap, icon
 * offset and rounded corner still glued to the wrong edge -- which reads as
 * broken rather than as translated.
 *
 * Deliberately conservative:
 *   - only rewrites inside className/class string literals, never arbitrary
 *     JS (a canvas `ctx.textAlign = "left"` must not become "start")
 *   - only whole class tokens, so `border-l` is rewritten but `border-lime`
 *     is not
 *   - leaves transforms alone: `translate-x-` and `-translate-x-` are
 *     geometry, not text direction, and flipping them would break animations
 *   - leaves `inset-x-`/`space-x-` alone: already symmetric
 *
 *   node scripts/rtl-codemod.mjs           # apply
 *   node scripts/rtl-codemod.mjs --check   # report only, exit 1 if any found
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;
const CHECK = process.argv.includes("--check");

// Ordered longest-first so `text-left` is matched before a bare `left-`.
const RULES = [
  [/\btext-left\b/g, "text-start"],
  [/\btext-right\b/g, "text-end"],
  [/\bfloat-left\b/g, "float-start"],
  [/\bfloat-right\b/g, "float-end"],
  [/\brounded-l-/g, "rounded-s-"],
  [/\brounded-r-/g, "rounded-e-"],
  [/\brounded-tl-/g, "rounded-ss-"],
  [/\brounded-tr-/g, "rounded-se-"],
  [/\brounded-bl-/g, "rounded-es-"],
  [/\brounded-br-/g, "rounded-ee-"],
  [/\bborder-l\b/g, "border-s"],
  [/\bborder-r\b/g, "border-e"],
  [/\bborder-l-/g, "border-s-"],
  [/\bborder-r-/g, "border-e-"],
  [/(?<![\w-])ml-/g, "ms-"],
  [/(?<![\w-])mr-/g, "me-"],
  [/(?<![\w-])pl-/g, "ps-"],
  [/(?<![\w-])pr-/g, "pe-"],
  // `left-`/`right-` only as positioning utilities. The negative lookbehind
  // keeps `translate-x` and any hyphenated word ending in these out of it.
  [/(?<![\w-])left-/g, "start-"],
  [/(?<![\w-])right-/g, "end-"],
  [/(?<![\w-])-left-/g, "-start-"],
  [/(?<![\w-])-right-/g, "-end-"],
];

// Matches className="..." / className={`...`} / class="..." and the contents
// of cn(...) template literals -- i.e. the places class names actually live.
const CLASS_ATTR = /\b(className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
const CN_CALL = /\bcn\(([\s\S]*?)\)/g;

function rewriteClassString(value) {
  let out = value;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

// A line carrying `rtl-keep` is left alone. Needed for the handful of places
// where a physical direction is geometry rather than text flow -- the pan/zoom
// tree canvas anchors its drawing surface at left:0 and computes every node
// position in that left-origin space, so mirroring the anchor would put the
// tree off-screen rather than mirror it.
const KEEP = /rtl-keep/;

// `left-1/2` paired with `-translate-x-1/2` is the standard centring idiom.
// Converting only the offset half of it is worse than converting neither: the
// element ends up off-centre under RTL, because `translate-x` does not mirror
// with the logical property. Left physical on purpose -- centring is geometry,
// not text direction.
const CENTRING = /(left|right)-1\/2[^"'`]*-translate-x-1\/2|-translate-x-1\/2[^"'`]*(left|right)-1\/2/;

function processSource(src) {
  let changes = 0;

  // Protect opted-out lines by processing line by line.
  const lines = src.split("\n");
  const protectedIdx = new Set();
  lines.forEach((line, i) => {
    if (KEEP.test(line) || CENTRING.test(line)) protectedIdx.add(i);
  });
  if (protectedIdx.size > 0) {
    const out = lines.map((line, i) => (protectedIdx.has(i) ? line : processSource(line).src));
    let n = 0;
    lines.forEach((line, i) => {
      if (!protectedIdx.has(i) && out[i] !== line) n++;
    });
    return { src: out.join("\n"), changes: n };
  }

  const withAttrs = src.replace(CLASS_ATTR, (whole) => {
    const next = rewriteClassString(whole);
    if (next !== whole) changes++;
    return next;
  });

  // cn() bodies are string literals concatenated with conditionals -- rewrite
  // only the quoted segments inside, never the expressions.
  const withCn = withAttrs.replace(CN_CALL, (whole) =>
    whole.replace(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g, (lit, quote, body) => {
      const next = rewriteClassString(body);
      if (next !== body) changes++;
      return `${quote}${next}${quote}`;
    })
  );

  return { src: withCn, changes };
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if ([".jsx", ".js"].includes(extname(entry))) files.push(full);
  }
  return files;
}

let touched = 0;
let total = 0;
for (const file of walk(ROOT)) {
  const original = readFileSync(file, "utf8");
  const { src, changes } = processSource(original);
  if (changes === 0 || src === original) continue;
  touched++;
  total += changes;
  const rel = file.replace(`${ROOT}/`, "");
  console.log(`${CHECK ? "would rewrite" : "rewrote"} ${rel} (${changes})`);
  if (!CHECK) writeFileSync(file, src);
}

console.log(`\n${touched} file(s), ${total} class group(s).`);
if (CHECK && touched > 0) process.exit(1);
