#!/usr/bin/env bun
/**
 * Builds the assistant's background knowledge from the live ashkan-medical.com
 * site, into `content/ashkan-medical/site-corpus.json`.
 *
 * --- Why the WordPress REST API and not HTML scraping --------------------
 * The sibling script `fetch-site-content.js` deliberately refuses to scrape
 * prose, and its reasoning is sound: the public pages are an Elementor build
 * whose copy is buried in nested divs with generated class names, so regex
 * extraction produces something that looks right and silently rots.
 *
 * That reasoning does not apply here, because the site exposes
 * `/wp-json/wp/v2/` publicly. That returns the *authored* content for every
 * page, product and post as structured JSON -- the same fields the CMS editor
 * types into, without the theme's markup wrapped around them. It is a stable,
 * documented contract rather than a guess about someone's div nesting.
 *
 * `?lang=en` selects the English translations; without it the API returns the
 * Persian originals, which is the site's default language.
 *
 * --- What this is for ------------------------------------------------------
 * The assistant already grounds product answers in the live database (stock
 * and price have to be current, and price is gated on the show_prices flag --
 * see aiService.js). This corpus is the *background*: the manufacturer
 * histories, the treatment explanations, the company story. Static prose that
 * changes a few times a year and is not sensitive.
 *
 *   bun run scripts/crawl-site.js
 *   bun run scripts/crawl-site.js --check   # report only, write nothing
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, "content/ashkan-medical/site-corpus.json");
const CHECK_ONLY = process.argv.includes("--check");

const BASE = "https://ashkan-medical.com/wp-json/wp/v2";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json",
};

// Collections worth reading. `product` is the WooCommerce post type; `pages`
// carries the marketing pages; `posts` is the news/article feed.
const COLLECTIONS = [
  { kind: "product", endpoint: "product" },
  { kind: "page", endpoint: "pages" },
  { kind: "article", endpoint: "posts" },
];

// A single document's ceiling. The longest product pages run past 8,000
// characters, most of which is the same marketing paragraph restated; the
// first ~3,500 reliably contain the specification and the manufacturer
// context, which is what anyone actually asks about.
const MAX_DOC_CHARS = 3500;

// Pages that exist in the CMS but say nothing an assistant should repeat.
const SKIP_SLUGS = new Set(["cart", "checkout", "my-account", "shop", "wishlist", "compare"]);

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * HTML -> readable plain text.
 *
 * Block-level tags become newlines *before* tags are stripped, so
 * `<li>A</li><li>B</li>` reads as two lines rather than the run-on "AB" that
 * a naive tag strip produces -- which matters because specification lists are
 * exactly how this site presents the facts people ask for.
 */
export function htmlToText(html) {
  if (!html) return "";
  let s = html;
  // Script/style content is not prose and would otherwise survive tag
  // stripping as a wall of minified JavaScript.
  s = s.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(p|div|section|h[1-6]|li|br|tr|td)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");

  // The handful of entities WordPress actually emits.
  const entities = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#039;": "'", "&#8217;": "'", "&#8216;": "'", "&#8220;": '"',
    "&#8221;": '"', "&#8211;": "-", "&#8212;": "--", "&hellip;": "...",
  };
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => entities[m] ?? " ");

  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Drops lines that appear across most documents.
 *
 * Theme chrome (breadcrumbs, "View the company website", the nav) is repeated
 * in every rendered page. Left in, it would be restated dozens of times in a
 * prompt that is paid for per token on every single request.
 */
export function stripBoilerplate(docs, threshold = 0.5) {
  const seen = new Map();
  for (const doc of docs) {
    for (const line of new Set(doc.lines)) {
      seen.set(line, (seen.get(line) || 0) + 1);
    }
  }
  const limit = Math.max(2, Math.floor(docs.length * threshold));
  // Short lines only: a long paragraph appearing in several documents is
  // genuinely shared copy (the company boilerplate about representation), and
  // dropping it would lose real information.
  const boiler = new Set([...seen].filter(([line, n]) => n >= limit && line.length < 120).map(([line]) => line));

  for (const doc of docs) doc.lines = doc.lines.filter((l) => !boiler.has(l));
  return boiler;
}

const FIELDS = "id,slug,link,title,content,excerpt,modified";

function shape(items, kind, lang) {
  return items
    .filter((it) => !SKIP_SLUGS.has(it.slug))
    .map((it) => ({
      kind,
      lang,
      slug: it.slug,
      url: it.link,
      title: htmlToText(it.title?.rendered || "").replace(/\n/g, " ").trim(),
      modified: it.modified || null,
      lines: htmlToText(it.content?.rendered || "").split("\n"),
    }))
    .filter((doc) => doc.lines.join(" ").length > 120); // skip near-empty stubs
}

/**
 * Fetches a collection in English, falling back to the site's own language.
 *
 * The news posts have no English translations at all -- `?lang=en` returns an
 * empty list for them, while the site really does publish eleven Persian
 * articles. Dropping those silently would leave the assistant unable to
 * discuss the company's own writing to the Persian-speaking audience that is
 * most of its market, so untranslated collections are taken in the original
 * and tagged with their language for the prompt.
 */
async function collect(kind, endpoint) {
  let items;
  try {
    items = await getJson(`${BASE}/${endpoint}?per_page=100&lang=en&_fields=${FIELDS}`);
  } catch (err) {
    console.warn(`  ! ${kind}: ${err.message}`);
    return [];
  }
  if (Array.isArray(items) && items.length > 0) return shape(items, kind, "en");

  try {
    const original = await getJson(`${BASE}/${endpoint}?per_page=100&_fields=${FIELDS}`);
    if (!Array.isArray(original) || original.length === 0) return [];
    console.log(`  ${kind.padEnd(8)}  (no English translations -- using originals)`);
    return shape(original, kind, "fa");
  } catch {
    return [];
  }
}

async function main() {
  console.log("Crawling ashkan-medical.com via its WordPress REST API...\n");

  const docs = [];
  for (const { kind, endpoint } of COLLECTIONS) {
    const found = await collect(kind, endpoint);
    console.log(`  ${kind.padEnd(8)} ${String(found.length).padStart(3)} documents`);
    docs.push(...found);
  }

  if (docs.length === 0) {
    console.error("\nNo documents retrieved -- refusing to write an empty corpus.");
    process.exit(1);
  }

  const boiler = stripBoilerplate(docs);
  console.log(`\n  dropped ${boiler.size} boilerplate line(s) repeated across pages`);

  let truncated = 0;
  const documents = docs.map((doc) => {
    let text = doc.lines.join("\n");
    if (text.length > MAX_DOC_CHARS) {
      // Cut at a line boundary so a specification never ends mid-number.
      text = text.slice(0, MAX_DOC_CHARS);
      text = text.slice(0, text.lastIndexOf("\n") + 1 || MAX_DOC_CHARS).trim();
      truncated++;
    }
    return { kind: doc.kind, lang: doc.lang, slug: doc.slug, title: doc.title, url: doc.url, modified: doc.modified, text };
  });

  const chars = documents.reduce((n, d) => n + d.text.length, 0);
  const corpus = {
    source: "https://ashkan-medical.com/wp-json/wp/v2 (?lang=en)",
    crawled_at: new Date().toISOString().slice(0, 10),
    note:
      "Background knowledge for the AI assistant, injected into its system prompt. " +
      "Live product price and stock deliberately come from the database instead -- see src/services/aiService.js.",
    document_count: documents.length,
    approx_chars: chars,
    documents,
  };

  console.log(`  ${documents.length} documents, ${truncated} truncated to ${MAX_DOC_CHARS} chars`);
  console.log(`  ~${chars.toLocaleString()} chars (~${Math.round(chars / 4).toLocaleString()} tokens)\n`);

  if (CHECK_ONLY) {
    console.log("--check: nothing written.");
    return;
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(corpus, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

// Only run when invoked directly, so the helpers above stay unit-testable.
if (import.meta.main) await main();
