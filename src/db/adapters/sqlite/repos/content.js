import { newId } from "../../../../lib/id.js";

// Blog posts (migration 015) and email verification tokens (migration 016).

export function makeBlogRepo(raw) {
  const hydrate = (row) =>
    row ? { ...row, tags: JSON.parse(row.tags_json || "[]") } : null;

  return {
    create(fields) {
      const id = newId("post");
      const now = new Date().toISOString();
      raw
        .query(
          `INSERT INTO blog_posts
             (id, slug, title, excerpt, body, cover_url, tags_json, status, author_id,
              published_at, seo_title, seo_description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          fields.slug,
          fields.title,
          fields.excerpt || null,
          fields.body || "",
          fields.coverUrl || null,
          JSON.stringify(fields.tags || []),
          fields.status || "draft",
          fields.authorId || null,
          fields.status === "published" ? now : null,
          fields.seoTitle || null,
          fields.seoDescription || null,
          now,
          now
        );
      return this.get(id);
    },

    get(id) {
      return hydrate(raw.query(`SELECT * FROM blog_posts WHERE id = ?`).get(id));
    },

    getBySlug(slug) {
      return hydrate(raw.query(`SELECT * FROM blog_posts WHERE slug = ?`).get(slug));
    },

    update(id, fields) {
      const current = this.get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      const next = {
        slug: fields.slug ?? current.slug,
        title: fields.title ?? current.title,
        excerpt: fields.excerpt === undefined ? current.excerpt : fields.excerpt,
        body: fields.body ?? current.body,
        coverUrl: fields.coverUrl === undefined ? current.cover_url : fields.coverUrl,
        tags: fields.tags ?? current.tags,
        status: fields.status ?? current.status,
        // Nullable on purpose: `undefined` means "leave it", but a null from
        // the author (front matter key removed) clears the override.
        seoTitle: fields.seoTitle === undefined ? current.seo_title : fields.seoTitle,
        seoDescription: fields.seoDescription === undefined ? current.seo_description : fields.seoDescription,
      };
      // published_at is stamped the first time a post goes live and then left
      // alone -- re-publishing an edited post must not silently reorder it to
      // the top of the feed as though it were new.
      const publishedAt =
        next.status === "published" ? current.published_at || now : current.published_at;

      raw
        .query(
          `UPDATE blog_posts
              SET slug = ?, title = ?, excerpt = ?, body = ?, cover_url = ?, tags_json = ?,
                  status = ?, published_at = ?, seo_title = ?, seo_description = ?, updated_at = ?
            WHERE id = ?`
        )
        .run(
          next.slug,
          next.title,
          next.excerpt,
          next.body,
          next.coverUrl,
          JSON.stringify(next.tags),
          next.status,
          publishedAt,
          next.seoTitle,
          next.seoDescription,
          now,
          id
        );
      return this.get(id);
    },

    remove(id) {
      raw.query(`DELETE FROM blog_posts WHERE id = ?`).run(id);
      // `.run()` yields no row count on this runtime; ask SQLite instead.
      return raw.query("SELECT changes() AS n").get().n > 0;
    },

    list({ status = null, limit = 50, offset = 0 } = {}) {
      const where = status ? `WHERE status = ?` : "";
      const args = status ? [status, limit, offset] : [limit, offset];
      // Published posts order by publication date; drafts have none, so
      // COALESCE falls back to creation so the admin list stays stable.
      return raw
        .query(
          `SELECT * FROM blog_posts ${where}
            ORDER BY COALESCE(published_at, created_at) DESC LIMIT ? OFFSET ?`
        )
        .all(...args)
        .map(hydrate);
    },
  };
}

export function makeEmailVerificationRepo(raw) {
  return {
    create({ userId, tokenHash, expiresAt }) {
      const id = newId("ev");
      raw
        .query(
          `INSERT INTO email_verifications (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, userId, tokenHash, expiresAt, new Date().toISOString());
      return raw.query(`SELECT * FROM email_verifications WHERE id = ?`).get(id);
    },

    findByHash(tokenHash) {
      return raw.query(`SELECT * FROM email_verifications WHERE token_hash = ?`).get(tokenHash) || null;
    },

    /**
     * Marks a token spent, atomically.
     *
     * Same reasoning as chat invite claiming: the `used_at IS NULL` guard is
     * what makes the token genuinely single-use under concurrent requests.
     */
    markUsed(id) {
      raw
        .query(`UPDATE email_verifications SET used_at = ? WHERE id = ? AND used_at IS NULL`)
        .run(new Date().toISOString(), id);
      // See the note in repos/chat.js: `.run()` yields no row count on this
      // Bun version, and this guard is the whole single-use guarantee.
      return raw.query("SELECT changes() AS n").get().n > 0;
    },

    /** Invalidates outstanding tokens, so "resend" doesn't leave several live. */
    revokeActiveForUser(userId) {
      raw
        .query(`UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL`)
        .run(new Date().toISOString(), userId);
    },
  };
}
