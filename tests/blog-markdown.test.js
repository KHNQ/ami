import { describe, test, expect } from "bun:test";
import { GET, POST, PATCH, signup, signupAdmin, createProduct, buy } from "./httpHelpers.js";
import { parseFrontmatter, stringifyFrontmatter } from "../src/lib/frontmatter.js";
import { readingMinutes, resolveFields } from "../src/services/blogService.js";

describe("front matter", () => {
  test("reads scalars, quoted strings, inline and block lists, and booleans", () => {
    const { data, body } = parseFrontmatter(`---
title: "Hello: World"
slug: hello-world
tags: [a, "b, c", d]
published: true
excerpt:
cover: https://x.test/z.jpg
authors:
  - one
  - two
---

# Body
text`);
    expect(data.title).toBe("Hello: World");
    expect(data.slug).toBe("hello-world");
    expect(data.tags).toEqual(["a", "b, c", "d"]);
    expect(data.published).toBe(true);
    expect(data.excerpt).toBeNull();
    expect(data.authors).toEqual(["one", "two"]);
    expect(body).toBe("# Body\ntext");
  });

  test("a document without front matter is returned untouched", () => {
    expect(parseFrontmatter("# Just markdown\n\n---\nnot front matter\n---")).toEqual({
      data: {},
      body: "# Just markdown\n\n---\nnot front matter\n---",
    });
    expect(parseFrontmatter("").body).toBe("");
    expect(parseFrontmatter(undefined).data).toEqual({});
  });

  test("an unterminated block is not front matter", () => {
    const text = "---\ntitle: oops\n\nNo closing fence";
    expect(parseFrontmatter(text)).toEqual({ data: {}, body: text });
  });

  test("it round-trips through stringify", () => {
    const original = { title: "A: tricky title", tags: ["x", "y, z"], status: "draft" };
    const again = parseFrontmatter(stringifyFrontmatter(original, "Body here"));
    expect(again.data).toEqual(original);
    expect(again.body).toBe("Body here");
  });

  test("it does not execute or expand anything YAML would", () => {
    const { data } = parseFrontmatter("---\nanchor: &a [1,2]\nref: *a\ntag: !!js/function 'x'\n---\nbody");
    // Anchors and tags are just text to this reader.
    expect(data.ref).toBe("*a");
    expect(typeof data.tag).toBe("string");
  });
});

describe("blog service helpers", () => {
  test("front matter in the body wins over form fields, and is stripped from the stored body", () => {
    const out = resolveFields({
      title: "Form title",
      status: "draft",
      body: "---\ntitle: Document title\nstatus: published\ntags: [laser]\ndescription: Meta text\n---\nHello",
    });
    expect(out.title).toBe("Document title");
    expect(out.status).toBe("published");
    expect(out.tags).toEqual(["laser"]);
    expect(out.seo_description).toBe("Meta text");
    expect(out.body).toBe("Hello");
  });

  test("without front matter the explicit fields are used as before", () => {
    const out = resolveFields({ title: "T", body: "Plain", status: "draft" });
    expect(out).toEqual({ title: "T", body: "Plain", status: "draft" });
  });

  test("reading time is at least a minute and scales with length", () => {
    expect(readingMinutes("short")).toBe(1);
    expect(readingMinutes("word ".repeat(1000))).toBe(5);
    expect(readingMinutes("```\n" + "code ".repeat(5000) + "\n```")).toBe(1);
  });
});

describe("blog authoring over HTTP", () => {
  const doc = (extra = "") => `---
title: New CO2 range ${Math.random().toString(36).slice(2, 6)}
slug: new-co2-range
excerpt: What changed this year.
tags: [lasers, news]
cover: https://cdn.test/cover.jpg
description: A search engine summary.
status: published
${extra}---

## Heading

Some **bold** text and a [link](https://example.com).
`;

  test("one Markdown document creates a fully-described, published post", async () => {
    const admin = await signupAdmin("md-author");
    const res = await POST("/blog/admin/posts", { body: doc() }, { token: admin.token });
    expect(res.status).toBe(201);
    expect(res.body.slug).toStartWith("new-co2-range");
    expect(res.body.excerpt).toBe("What changed this year.");
    expect(res.body.tags).toEqual(["lasers", "news"]);
    expect(res.body.cover_url).toBe("https://cdn.test/cover.jpg");
    expect(res.body.seo_description).toBe("A search engine summary.");
    expect(res.body.status).toBe("published");
    expect(res.body.body).toStartWith("## Heading");
    expect(res.body.body).not.toContain("---");
    expect(res.body.reading_minutes).toBeGreaterThanOrEqual(1);
  });

  test("a published post is public by slug; a draft is not", async () => {
    const admin = await signupAdmin("md-visibility");
    const live = await POST("/blog/admin/posts", { body: doc() }, { token: admin.token });
    const draft = await POST("/blog/admin/posts", { title: "Secret draft", body: "# nope" }, { token: admin.token });

    const read = await GET(`/blog/posts/${live.body.slug}`);
    expect(read.status).toBe(200);
    expect(read.body.body).toContain("**bold**");
    expect((await GET(`/blog/posts/${draft.body.slug}`)).status).toBe(404);

    const list = await GET("/blog/posts");
    expect(list.body.posts.some((p) => p.slug === live.body.slug)).toBe(true);
    expect(list.body.posts.some((p) => p.slug === draft.body.slug)).toBe(false);
  });

  test("the public slug list (for the sitemap) holds published posts only", async () => {
    const admin = await signupAdmin("md-slugs");
    const live = await POST("/blog/admin/posts", { body: doc() }, { token: admin.token });
    const draft = await POST("/blog/admin/posts", { title: "Hidden from sitemap" }, { token: admin.token });
    const slugs = (await GET("/blog/slugs")).body.posts.map((p) => p.slug);
    expect(slugs).toContain(live.body.slug);
    expect(slugs).not.toContain(draft.body.slug);
  });

  test("editing the document updates the fields, and removing a key clears it", async () => {
    const admin = await signupAdmin("md-edit");
    const created = await POST("/blog/admin/posts", { body: doc() }, { token: admin.token });

    const edited = await PATCH(
      `/blog/admin/posts/${created.body.id}`,
      { body: "---\ntitle: Renamed\nstatus: draft\n---\nNew body" },
      { token: admin.token }
    );
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe("Renamed");
    expect(edited.body.status).toBe("draft");
    expect(edited.body.body).toBe("New body");
    // Front matter that no longer mentions a key leaves the stored value alone;
    // a key present but empty clears it.
    expect(edited.body.excerpt).toBe("What changed this year.");

    const cleared = await PATCH(
      `/blog/admin/posts/${created.body.id}`,
      { body: "---\ntitle: Renamed\nexcerpt:\n---\nNew body" },
      { token: admin.token }
    );
    expect(cleared.body.excerpt).toBeNull();
  });

  test("raw HTML is stored as text and never promoted to markup by the API", async () => {
    const admin = await signupAdmin("md-xss");
    const res = await POST(
      "/blog/admin/posts",
      { title: "Script test", body: "<script>alert(1)</script>\n\n[x](javascript:alert(1))", status: "published" },
      { token: admin.token }
    );
    const read = await GET(`/blog/posts/${res.body.slug}`);
    // The API returns Markdown source, as data. Turning it into markup (and
    // refusing script and javascript: URLs) is the renderer's job, which has
    // its own test in the frontend suite.
    expect(read.headers.get("content-type")).toContain("application/json");
    expect(read.body.body).toContain("<script>");
  });

  test("a post needs a title from somewhere", async () => {
    const admin = await signupAdmin("md-title");
    expect((await POST("/blog/admin/posts", { body: "no title anywhere" }, { token: admin.token })).status).toBe(400);
  });

  test("blog_enabled=false hides the public blog entirely", async () => {
    const admin = await signupAdmin("md-off");
    const live = await POST("/blog/admin/posts", { body: doc() }, { token: admin.token });
    await PATCH("/admin/settings", { blog_enabled: false }, { token: admin.token });
    try {
      expect((await GET(`/blog/posts/${live.body.slug}`)).status).toBe(404);
      expect((await GET("/blog/posts")).body.posts).toEqual([]);
      expect((await GET("/blog/slugs")).body.posts).toEqual([]);
    } finally {
      await POST("/admin/settings/blog_enabled/reset", {}, { token: admin.token });
    }
  });
});

describe("admin people view: a user's referral network", () => {
  test("shows sponsors above and the whole tree below, with names", async () => {
    const admin = await signupAdmin("net-admin");
    const product = await createProduct(admin.token, { yCents: 30_000 });
    const root = await signup("net-root");
    const rootBuy = await buy(root, product);
    const child = await signup("net-child");
    const childBuy = await buy(child, product, { redeemCode: rootBuy.body.ownRedeemCode.code });
    const grandchild = await signup("net-grandchild");
    await buy(grandchild, product, { redeemCode: childBuy.body.ownRedeemCode.code });

    const res = await GET(`/admin/users/${child.user.id}/network`, { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(child.user.email);
    expect(res.body.memberships.length).toBe(1);
    const m = res.body.memberships[0];
    expect(m.product_id).toBe(product.id);
    expect(m.upline.map((u) => u.user_id)).toEqual([root.user.id]);
    expect(m.downline_size).toBe(1);
    expect(m.tree.user_id).toBe(child.user.id);
    expect(m.tree.name).toBeTruthy();
    expect(m.tree.children[0].user_id).toBe(grandchild.user.id);

    // The root's tree shows both descendants, nested.
    const top = (await GET(`/admin/users/${root.user.id}/network`, { token: admin.token })).body.memberships[0];
    expect(top.downline_size).toBe(2);
    expect(top.upline).toEqual([]);
    expect(top.tree.children[0].children[0].user_id).toBe(grandchild.user.id);
  });

  test("depth is capped and truncation is reported", async () => {
    const admin = await signupAdmin("net-depth");
    const product = await createProduct(admin.token, { yCents: 30_000 });
    let sponsor = await signup("net-d0");
    let receipt = await buy(sponsor, product);
    const top = sponsor;
    for (let i = 1; i <= 3; i++) {
      const next = await signup(`net-d${i}`);
      receipt = await buy(next, product, { redeemCode: receipt.body.ownRedeemCode.code });
      sponsor = next;
    }
    const res = await GET(`/admin/users/${top.user.id}/network?depth=2`, { token: admin.token });
    const tree = res.body.memberships[0].tree;
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].truncated).toBe(true);
    expect(tree.children[0].children).toEqual([]);
  });

  test("a user with no network has no memberships; an unknown user is a 404", async () => {
    const admin = await signupAdmin("net-none");
    const lone = await signup("net-lone");
    expect((await GET(`/admin/users/${lone.user.id}/network`, { token: admin.token })).body.memberships).toEqual([]);
    expect((await GET("/admin/users/usr_nope/network", { token: admin.token })).status).toBe(404);
    expect((await GET(`/admin/users/${lone.user.id}/network`, { token: lone.token })).status).toBe(403);
  });
});
