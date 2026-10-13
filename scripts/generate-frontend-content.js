#!/usr/bin/env bun
/**
 * Generates frontend/src/lib/siteContent.generated.js from content/.
 *
 * Why a generation step rather than an import: content/ sits outside the Vite
 * project root, so the frontend cannot import it directly. Until now the fix
 * was a hand-typed copy in frontend/src/lib/storyContent.js -- which meant the
 * company's address, partner list and service copy existed in two places and
 * drifted the moment either was edited.
 *
 * Generating instead makes content/ the single source of truth, keeps the data
 * as a plain module (no runtime fetch, no SSR round trip, tree-shakeable), and
 * makes the derivation reviewable in a diff.
 *
 *   bun run scripts/generate-frontend-content.js
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CONTENT = join(ROOT, "content/ashkan-medical");
const OUT = join(ROOT, "frontend/src/lib/siteContent.generated.js");

const read = (rel) => JSON.parse(readFileSync(join(CONTENT, rel), "utf8"));

const company = read("company.json");
const { categories } = read("categories.json");
const partnersDoc = read("partners.json");
const story = read("pages/our-story.json");
const careers = read("pages/careers.json");

// Logos are copied into the frontend's public/ so they are served as static
// assets rather than inlined. Verified present rather than assumed -- a
// missing file here becomes a broken image on the partners page.
const missingLogos = partnersDoc.partners.filter((p) => {
  const ext = p.logo ? (p.logo.split("?")[0].match(/\.[a-z]+$/i)?.[0] ?? ".png") : ".png";
  return p.logo && !existsSync(join(CONTENT, `logos/${p.slug}${ext}`));
});
if (missingLogos.length) {
  console.warn(
    `warning: ${missingLogos.length} logo file(s) not on disk -- run scripts/fetch-site-content.js first:\n` +
      missingLogos.map((p) => `  - ${p.slug}`).join("\n")
  );
}

const logoPath = (p) => {
  const ext = p.logo ? (p.logo.split("?")[0].match(/\.[a-z]+$/i)?.[0] ?? ".png") : ".png";
  return `/partners/${p.slug}${ext}`;
};

const payload = {
  ORG: {
    name: company.name,
    tagline: company.tagline,
    description: company.description,
    email: company.contact.email,
    phones: company.contact.phones,
    address: company.contact.address,
    supportHours: "24 hours a day, 7 days a week",
    social: {
      aparat: "https://www.aparat.com/medicalidea/",
      instagram: "https://www.instagram.com/ashkan_medical/",
      // The real footer URL from the source site. A commonly-passed-around
      // variant (linkedin/in/ashkan-medical-idea) is malformed and 404s.
      linkedin: "https://ir.linkedin.com/in/ashkan-medical-4a31a11a3",
    },
    map: {
      lat: partnersDoc.origin.lat,
      lng: partnersDoc.origin.lng,
      url: `https://www.openstreetmap.org/?mlat=${partnersDoc.origin.lat}&mlon=${partnersDoc.origin.lng}#map=17/${partnersDoc.origin.lat}/${partnersDoc.origin.lng}`,
    },
  },

  CATEGORIES: categories.map((c) => ({
    slug: c.slug,
    title: c.title,
    shortTitle: c.short_title,
    intro: c.intro,
    body: c.body,
    effect: c.effect,
    productSlugs: c.product_slugs,
  })),

  PARTNERS: partnersDoc.partners.map((p) => ({
    slug: p.slug,
    name: p.name,
    country: p.country,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    founded: p.founded,
    description: p.description,
    website: p.website,
    logo: logoPath(p),
  })),

  PARTNER_ORIGIN: partnersDoc.origin,
  PARTNERS_HERO: partnersDoc.hero,

  STORY: {
    title: story.title,
    tagline: story.tagline,
    banner: "/story/banner.webp",
    sections: story.sections,
    proofPoint: story.proof_point,
    ceo: { ...story.ceo, image: "/story/ceo.jpg" },
    stats: story.stats,
  },

  CAREERS: {
    title: careers.title,
    hero: careers.hero,
    intro: careers.intro,
    openPositions: careers.open_positions,
    formFields: careers.form.fields,
  },
};

const banner = `// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// Produced by scripts/generate-frontend-content.js from content/ashkan-medical/.
// Edit the JSON there and re-run the script; edits made here are lost on the
// next generation and, worse, silently diverge from what the AI assistant and
// the import script read.
//
// Generated: ${new Date().toISOString().slice(0, 10)}
/* eslint-disable */
`;

const body = Object.entries(payload)
  .map(([name, value]) => `export const ${name} = ${JSON.stringify(value, null, 2)};`)
  .join("\n\n");

writeFileSync(OUT, `${banner}\n${body}\n`);

console.log(`Wrote ${OUT.replace(ROOT + "/", "")}`);
console.log(
  `  ${payload.CATEGORIES.length} categories · ${payload.PARTNERS.length} partners · ` +
    `${payload.STORY.sections.length} story sections · ${payload.CAREERS.formFields.length} career form fields`
);
