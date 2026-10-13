// Backfills the products imported by import-ashkan-medical-content.js with
// actual image bytes (base64 data URL) in specs.image_data_url, so the
// frontend can render <img src={...}> directly with no static-file-serving
// route needed. Safe to re-run: only touches products whose specs.image
// (the local file path recorded at import time) matches a file on disk and
// whose specs.image_data_url isn't already set.
import { readFileSync, existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { db } from "../src/db/index.js";
import { productService } from "../src/services/productService.js";

const ROOT_DIR = join(dirname(new URL(import.meta.url).pathname), "..");

// Prefer the background-removed PNG (scripts/make-transparent-images.py)
// over the original white-seamless JPEG: the app renders these over dark
// surfaces and 3D stages where a white rectangle looks pasted on.
function preferTransparent(relativePath) {
  const stem = relativePath.split("/").pop().replace(/\.[^.]+$/, "");
  const png = join("content", "ashkan-medical", "images-transparent", stem + ".png");
  return existsSync(join(ROOT_DIR, png)) ? png : relativePath;
}

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".png": "image/png",
};

function toDataUrl(relativePath) {
  const absPath = join(ROOT_DIR, relativePath);
  if (!existsSync(absPath)) return null;
  const ext = extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  const bytes = readFileSync(absPath);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function main() {
  const products = db.products.list({ limit: 1000 });
  let updated = 0;
  let skipped = 0;

  for (const row of products) {
    const specs = JSON.parse(row.specs_json);
    if (!specs.image) continue; // not one of the imported Ashkan products
    const source = preferTransparent(specs.image);
    // Re-runs intentionally overwrite: the transparency pass changes the
    // bytes for an image that already had a data URL from a previous run.
    const dataUrl = toDataUrl(source);
    if (!dataUrl) {
      console.log(`Skipping "${row.name}" -- image file not found at ${source}`);
      continue;
    }
    if (specs.image_data_url === dataUrl) {
      skipped++;
      continue;
    }
    productService.update(
      row.id,
      { specs: { ...specs, image_data_url: dataUrl, image_transparent: source.includes("images-transparent") } },
      "content-import-script"
    );
    console.log(
      `Updated "${row.name}" <- ${source.split("/").pop()} (${(dataUrl.length / 1024).toFixed(0)} KB base64)`
    );
    updated++;
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped} (already up to date).`);
}

main();
