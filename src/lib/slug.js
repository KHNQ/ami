/** "Our new CO2 laser!" -> "our-new-co2-laser" */
export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    // Keep unicode letters so a Persian or Arabic title produces a real slug
    // rather than collapsing to an empty string and colliding with every
    // other non-Latin title.
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
