import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Regex lookbehind -- (?<=...) and (?<!...) -- is a SyntaxError at PARSE time
// in Safari before 16.4. One in any file the app loads breaks the whole page
// there, while Chrome and Firefox are fine, so it is invisible in normal
// development. This keeps it out of our own source and out of the built
// bundles.

const SRC = resolve(import.meta.dirname, "../src");
const LOOKBEHIND = /\(\?<[=!]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name) && !name.includes("siteContent.generated")) out.push(p);
  }
  return out;
}

describe("no regex lookbehind in what ships to browsers", () => {
  it("our own source has none", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes("/shims/"))
      .filter((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && LOOKBEHIND.test(line))
      );
    expect(offenders.map((f) => f.replace(SRC, "src"))).toEqual([]);
  });

  it("the Markdown pipeline is wired to the lookbehind-free replacements", () => {
    const config = readFileSync(resolve(import.meta.dirname, "../vite.config.js"), "utf8");
    expect(config).toContain('"mdast-util-gfm-autolink-literal"');
    expect(config).toContain('"micromark-extension-gfm-autolink-literal"');
  });

  it("the bare-link stubs are valid extensions and add nothing", async () => {
    const a = await import("../src/lib/shims/gfm-autolink-literal-mdast.js");
    const b = await import("../src/lib/shims/gfm-autolink-literal-micromark.js");
    expect(a.gfmAutolinkLiteralFromMarkdown()).toEqual({});
    expect(a.gfmAutolinkLiteralToMarkdown()).toEqual({});
    expect(b.gfmAutolinkLiteral()).toEqual({});
  });
});
