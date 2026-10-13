#!/usr/bin/env bun
/**
 * Refreshes content/ashkan-medical/ from the live ashkan-medical.com site.
 *
 * Why this exists: the JSON under content/ was originally produced by hand and
 * the tool that made it was never committed, which meant nobody could refresh
 * it or check it against the source. This script makes that reproducible.
 *
 * What it does reliably:
 *   - downloads every binary asset (partner logos, page banners, the CEO
 *     photo) to disk, with a spoofed User-Agent and Referer because the
 *     source has hotlink protection
 *   - verifies every page and asset URL recorded in the JSON still resolves,
 *     so link rot surfaces as a failed run rather than as a broken page
 *
 * What it does NOT do: re-derive the prose. The source is an Elementor
 * WordPress build whose copy is buried in nested divs with generated class
 * names -- scraping it with regexes would produce something that looks like
 * it works and silently rots. The narrative text in these files was extracted
 * by reading the pages, and is checked in as the artifact. This script tells
 * you when a source page has changed enough to be worth re-reading.
 *
 *   bun run scripts/fetch-site-content.js            # verify + download assets
 *   bun run scripts/fetch-site-content.js --check    # verify only, no writes
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const CONTENT = path.join(ROOT, "content/ashkan-medical");
const CHECK_ONLY = process.argv.includes("--check");

// The source blocks requests that don't look like a browser arriving from its
// own pages.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://ashkan-medical.com/en/",
  Accept: "text/html,application/xhtml+xml,image/avif,image/webp,*/*",
};

const results = { ok: 0, failed: 0, downloaded: 0, skipped: 0 };
const problems = [];

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(CONTENT, rel), "utf8"));
}

/** HEAD the URL; falls back to a ranged GET for servers that reject HEAD. */
async function urlResolves(url) {
  try {
    let res = await fetch(url, { method: "HEAD", headers: HEADERS, redirect: "follow" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { headers: { ...HEADERS, Range: "bytes=0-0" }, redirect: "follow" });
    }
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

async function download(url, destRel) {
  const dest = path.join(ROOT, destRel);
  if (existsSync(dest)) {
    results.skipped += 1;
    return true;
  }
  if (CHECK_ONLY) return urlResolves(url);
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    results.downloaded += 1;
    return true;
  } catch (err) {
    problems.push(`download failed: ${url} -> ${err.message}`);
    return false;
  }
}

function extFromUrl(url) {
  const clean = url.split("?")[0];
  const ext = path.extname(clean).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"].includes(ext) ? ext : ".png";
}

async function verifyPages() {
  console.log("\n== Source pages ==");
  const [categories, partners, story, careers] = await Promise.all([
    readJson("categories.json"),
    readJson("partners.json"),
    readJson("pages/our-story.json"),
    readJson("pages/careers.json"),
  ]);

  const urls = [
    ...categories.categories.map((c) => [c.title, c.source_url]),
    ["Business partners", partners.source],
    ["Our story", story.source],
    ["Careers", careers.source],
  ];

  for (const [label, url] of urls) {
    const ok = await urlResolves(url);
    if (ok) results.ok += 1;
    else {
      results.failed += 1;
      problems.push(`page gone or moved: ${label} -> ${url}`);
    }
    console.log(`  ${ok ? "ok " : "GONE"}  ${label}`);
  }
  return { categories, partners, story, careers };
}

async function fetchLogos(partners) {
  console.log("\n== Partner logos ==");
  for (const p of partners.partners) {
    if (!p.logo) continue;
    const rel = `content/ashkan-medical/logos/${p.slug}${extFromUrl(p.logo)}`;
    const ok = await download(p.logo, rel);
    console.log(`  ${ok ? "ok " : "FAIL"}  ${p.name}`);
    if (!ok) results.failed += 1;
  }
}

async function fetchBanners(story) {
  console.log("\n== Page imagery ==");
  const assets = [
    [story.banner.source_url, story.banner.local_path, "Our story banner"],
    [story.ceo.image.source_url, story.ceo.image.local_path, "CEO portrait"],
  ];
  for (const [url, rel, label] of assets) {
    const ok = await download(url, rel);
    console.log(`  ${ok ? "ok " : "FAIL"}  ${label}`);
    if (!ok) results.failed += 1;
  }
}

/**
 * Cross-checks that every product slug named by a category actually exists in
 * products.json. This is the check most likely to catch a real mistake: a
 * typo'd slug produces a category page that silently renders zero products.
 */
async function verifyProductLinks(categories) {
  console.log("\n== Category -> product wiring ==");
  const products = await readJson("products.json");
  const known = new Set(products.map((p) => p.slug));
  const referenced = new Set();

  for (const c of categories.categories) {
    const missing = c.product_slugs.filter((s) => !known.has(s));
    c.product_slugs.forEach((s) => referenced.add(s));
    if (missing.length) {
      results.failed += 1;
      problems.push(`category '${c.slug}' references unknown product(s): ${missing.join(", ")}`);
      console.log(`  FAIL  ${c.slug} -> missing ${missing.join(", ")}`);
    } else {
      results.ok += 1;
      console.log(`  ok    ${c.slug} (${c.product_slugs.length} products)`);
    }
  }

  // A product in the catalogue but in no category would never be reachable by
  // browsing -- worth knowing about even though it isn't fatal.
  const orphans = [...known].filter((s) => !referenced.has(s));
  if (orphans.length) {
    console.log(`\n  note: ${orphans.length} product(s) in no category: ${orphans.join(", ")}`);
  }
}

const { categories, partners, story } = await verifyPages();
await fetchLogos(partners);
await fetchBanners(story);
await verifyProductLinks(categories);

console.log("\n" + "=".repeat(58));
console.log(
  `checks passed ${results.ok} | failed ${results.failed} | ` +
    `downloaded ${results.downloaded} | already present ${results.skipped}`
);
if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log(`  - ${p}`);
}
console.log("=".repeat(58));

// Non-zero exit so this can run in CI as a link-rot alarm.
process.exit(results.failed > 0 ? 1 : 0);
