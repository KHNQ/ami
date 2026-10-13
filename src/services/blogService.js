import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { settingsService } from "./settingsService.js";
import { slugify } from "../lib/slug.js";
import { parseFrontmatter } from "../lib/frontmatter.js";

// Blog posts, authored in the admin console and published on /socials.
//
// Posts are Markdown. The body is stored and served as the author's Markdown
// source, never as HTML, and it is the renderer's job (the storefront uses
// react-markdown, which does not pass raw HTML through and strips unsafe URL
// schemes) to turn it into markup. An internal tool where staff paste
// arbitrary markup that is then rendered on a public page is a stored-XSS
// hole with extra steps, so the server never produces or trusts HTML.
//
// A post may open with a front-matter block (see lib/frontmatter.js). When it
// does, the block is lifted out into the post's fields and removed from the
// stored body -- the document the author sees and the columns the site reads
// are the same thing, with the document winning.

const MAX_TITLE = 200;
const MAX_BODY = 40_000;

function validate({ title, body }) {
  if (!title || !title.trim()) throw Errors.badRequest("A title is required", "title_required");
  if (title.length > MAX_TITLE) throw Errors.badRequest(`Title must be under ${MAX_TITLE} characters`, "title_too_long");
  if (body && body.length > MAX_BODY) throw Errors.badRequest("That post is too long", "body_too_long");
}

/**
 * Finds a slug nobody is using.
 *
 * Appending a counter rather than rejecting the save: two posts called
 * "Company update" is entirely reasonable, and making an author invent a
 * unique title to satisfy a database constraint is the wrong trade.
 */
function uniqueSlug(base, ignoreId = null) {
  const root = base || "post";
  let candidate = root;
  let n = 2;
  for (;;) {
    const existing = db.blog.getBySlug(candidate);
    if (!existing || existing.id === ignoreId) return candidate;
    candidate = `${root}-${n++}`;
  }
}

export { slugify };

/**
 * Folds front matter in the body into the request's fields.
 *
 * The document wins over the form: what the author can see in the editor is
 * what gets published. Keys the document does not mention fall back to the
 * explicit fields, so an API client that never uses front matter behaves
 * exactly as it did before.
 */
export function resolveFields(input) {
  const { data, body } = parseFrontmatter(input.body ?? "");
  const hasFrontmatter = Object.keys(data).length > 0;
  const out = { ...input };
  if (input.body !== undefined) out.body = body;
  if (!hasFrontmatter) return out;

  const str = (v) => (typeof v === "string" ? v.trim() : v == null ? null : String(v));
  if (data.title) out.title = str(data.title);
  if (data.slug) out.slug = str(data.slug);
  if ("excerpt" in data || "summary" in data) out.excerpt = str(data.excerpt ?? data.summary);
  const cover = data.cover ?? data.cover_url ?? data.image;
  if (cover !== undefined) out.cover_url = str(cover);
  if (Array.isArray(data.tags)) out.tags = data.tags.map(String);
  else if (typeof data.tags === "string") out.tags = data.tags.split(",").map((t) => t.trim()).filter(Boolean);
  if ("seo_title" in data) out.seo_title = str(data.seo_title);
  if ("seo_description" in data || "description" in data) out.seo_description = str(data.seo_description ?? data.description);
  if (typeof data.status === "string") out.status = data.status.toLowerCase() === "published" ? "published" : "draft";
  else if (typeof data.published === "boolean") out.status = data.published ? "published" : "draft";
  return out;
}

/** Whole minutes to read, never less than one. ~200 wpm; CJK/Persian count by characters. */
export function readingMinutes(markdown) {
  const text = String(markdown || "").replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`\[\]()!-]/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

const withMeta = (post) => (post ? { ...post, reading_minutes: readingMinutes(post.body) } : post);

export const blogService = {
  slugify,

  create(input, authorId) {
    const fields = resolveFields(input);
    validate(fields);
    return withMeta(
      db.blog.create({
        slug: uniqueSlug(fields.slug ? slugify(fields.slug) : slugify(fields.title)),
        title: fields.title.trim(),
        excerpt: fields.excerpt?.trim() || null,
        body: fields.body || "",
        coverUrl: fields.cover_url || null,
        tags: Array.isArray(fields.tags) ? fields.tags.slice(0, 12) : [],
        status: fields.status === "published" ? "published" : "draft",
        seoTitle: fields.seo_title || null,
        seoDescription: fields.seo_description || null,
        authorId,
      })
    );
  },

  update(id, input) {
    const existing = db.blog.get(id);
    if (!existing) throw Errors.notFound("Post not found");
    const fields = resolveFields(input);
    if (fields.title !== undefined || fields.body !== undefined) {
      validate({ title: fields.title ?? existing.title, body: fields.body ?? existing.body });
    }
    const patch = { ...fields };
    if (fields.slug !== undefined) patch.slug = uniqueSlug(slugify(fields.slug), id);
    if (fields.cover_url !== undefined) patch.coverUrl = fields.cover_url;
    if (fields.seo_title !== undefined) patch.seoTitle = fields.seo_title;
    if (fields.seo_description !== undefined) patch.seoDescription = fields.seo_description;
    return withMeta(db.blog.update(id, patch));
  },

  remove(id) {
    if (!db.blog.get(id)) throw Errors.notFound("Post not found");
    return db.blog.remove(id);
  },

  get(id) {
    const post = db.blog.get(id);
    if (!post) throw Errors.notFound("Post not found");
    return withMeta(post);
  },

  /** Admin listing -- drafts included. */
  list(opts) {
    return db.blog.list(opts).map(withMeta);
  },

  // --- public ------------------------------------------------------------
  // These enforce the blog_enabled flag and never return a draft. Both
  // conditions are checked here rather than in the route so there is no way
  // to reach an unpublished post through a path that forgot one of them.

  publicList({ limit = 20, offset = 0 } = {}) {
    if (!settingsService.isEnabled("blog_enabled")) return [];
    return db.blog.list({ status: "published", limit, offset }).map(withMeta);
  },

  /**
   * Every published slug with its dates -- for the sitemap, which needs all of
   * them and none of the bodies.
   */
  publicSlugs({ limit = 5000 } = {}) {
    if (!settingsService.isEnabled("blog_enabled")) return [];
    return db.blog
      .list({ status: "published", limit })
      .map((p) => ({ slug: p.slug, published_at: p.published_at, updated_at: p.updated_at }));
  },

  publicGet(slug) {
    if (!settingsService.isEnabled("blog_enabled")) throw Errors.notFound("Post not found");
    const post = db.blog.getBySlug(slug);
    if (!post || post.status !== "published") throw Errors.notFound("Post not found");
    return withMeta(post);
  },
};
