#!/usr/bin/env node
/**
 * Builds `public/favicon-source.png` from the real Ashkan Medical logo.
 *
 * The shipped logo (`src/assets/ashkan-medical-logo.webp`) is a full lockup:
 * the loop mark, an "ashkan" wordmark, and a line of Persian text. Scaled to
 * a 16px browser tab that whole thing is an unreadable smudge, so this crops
 * to the loop mark alone -- the part that is actually recognisable at size --
 * and sets it on a rounded white plate, matching how BrandLogo presents it
 * in-app. The white plate is not decoration: the mark is drawn for a light
 * ground and its blue half disappears against a dark browser tab.
 *
 * The crop box is found by scanning the alpha channel rather than being
 * hardcoded, so re-running this after a logo update finds the new bounds
 * instead of silently cropping the wrong region.
 *
 *   node scripts/make-favicon.mjs        # -> src/assets/favicon-source.png
 *   node node_modules/@vite-pwa/assets-generator/bin/pwa-assets-generator.mjs
 */

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SRC = fileURLToPath(new URL("../src/assets/ashkan-medical-logo.webp", import.meta.url));
// Deliberately NOT in public/: Vite copies that directory verbatim into the
// build, so a 214KB generation input would ship to every visitor for nothing.
// This is a build artefact the icon generator reads, not a served asset.
const OUT = fileURLToPath(new URL("../src/assets/favicon-source.png", import.meta.url));

const SIZE = 512;
const INSET = 56; // breathing room inside the plate
const RADIUS = 96;
const ALPHA_THRESHOLD = 24;

/**
 * Bounding box of the mark.
 *
 * The lockup has a blank row between the mark and the wordmark, so the mark
 * is "everything above the first fully empty row after ink starts". Relying
 * on that gap is what keeps the wordmark out of the crop without hardcoding
 * a pixel row that a logo revision would invalidate.
 */
async function findMarkBounds() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const inked = (x, y) => data[(y * width + x) * channels + 3] > ALPHA_THRESHOLD;

  const rowHasInk = [];
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) if (inked(x, y)) n++;
    rowHasInk.push(n > 0);
  }

  const top = rowHasInk.indexOf(true);
  if (top === -1) throw new Error("logo appears to be fully transparent");

  let bottom = top;
  while (bottom + 1 < height && rowHasInk[bottom + 1]) bottom++;

  let left = width;
  let right = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      if (!inked(x, y)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const box = await findMarkBounds();
console.log(`mark bounds: ${box.width}x${box.height} at (${box.left}, ${box.top})`);

const mark = await sharp(SRC)
  .extract(box)
  .resize(SIZE - INSET * 2, SIZE - INSET * 2, {
    fit: "contain",
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  })
  .png()
  .toBuffer();

const plate = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
     <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#ffffff"/>
   </svg>`
);

// Composed once, then reused. sharp applies `resize` BEFORE `composite`
// regardless of call order, so resizing the plate first and compositing after
// fails with "image to composite must have same dimensions or smaller" -- the
// full-size mark no longer fits the shrunken canvas. Rendering to a buffer
// and scaling that buffer sidesteps the pipeline ordering entirely.
const composed = await sharp(plate)
  .composite([{ input: mark, top: INSET, left: INSET }])
  .png()
  .toBuffer();

await writeFile(OUT, composed);
console.log(`wrote ${OUT}`);

// The admin console is a separate Vite app with its own public/ directory, so
// it needs its own copy or every page load 404s on /favicon.ico. Written from
// here rather than hand-copied, so the two can never drift: they are one
// product and a different tab icon on the back office would say otherwise.
const ADMIN_ICON = fileURLToPath(new URL("../../admin/public/favicon.ico", import.meta.url));
const ADMIN_PNG = ADMIN_ICON.replace(/\.ico$/, ".png");
await mkdir(dirname(ADMIN_PNG), { recursive: true });
await sharp(composed).resize(64, 64).png().toFile(ADMIN_PNG);
console.log(`wrote ${ADMIN_PNG}`);
