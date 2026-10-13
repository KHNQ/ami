import { describe, test, expect, beforeEach } from "bun:test";
import { GET, POST, PATCH, DELETE, signupAdmin, signupStaff, signup, nextEmail, PASSWORD } from "./httpHelpers.js";
import { settingsService } from "../src/services/settingsService.js";
import { blogService, slugify } from "../src/services/blogService.js";
import { socialService } from "../src/services/socialService.js";
import { subscribe, Topics, _reset } from "../src/lib/realtime.js";
import { db } from "../src/db/index.js";
import { config } from "../src/config.js";

beforeEach(() => {
  _reset();
  for (const k of ["blog_enabled", "require_email_verification"]) {
    try {
      settingsService.reset(k);
    } catch {
      /* not overridden */
    }
  }
});

describe("slugs", () => {
  test("turns a title into a usable slug", () => {
    expect(slugify("Our New CO2 Laser!")).toBe("our-new-co2-laser");
    expect(slugify("  spaced   out  ")).toBe("spaced-out");
  });

  test("keeps non-Latin scripts instead of collapsing them to nothing", () => {
    // A Persian title stripped to ASCII would produce an empty slug, and every
    // Persian post would then collide on the same one.
    const fa = slugify("لیزر جدید");
    expect(fa.length).toBeGreaterThan(0);
    expect(fa).not.toBe("-");
  });

  test("two posts with the same title both get a slug", async () => {
    const admin = await signupAdmin("blog-slug");
    const a = blogService.create({ title: "Company update" }, admin.user.id);
    const b = blogService.create({ title: "Company update" }, admin.user.id);
    // Rejecting the second would force an author to invent a unique title to
    // satisfy a database constraint, which is the wrong trade.
    expect(b.slug).not.toBe(a.slug);
    expect(b.slug).toContain("company-update");
  });
});

describe("blog authoring", () => {
  test("an author can create, edit, publish and delete", async () => {
    const admin = await signupAdmin("blog-crud");
    const created = await POST(
      "/blog/admin/posts",
      { title: "A new arrival", excerpt: "Short", body: "Long body", tags: ["news"] },
      { token: admin.token }
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    expect(created.body.published_at).toBeNull();

    const published = await PATCH(
      `/blog/admin/posts/${created.body.id}`,
      { status: "published" },
      { token: admin.token }
    );
    expect(published.body.status).toBe("published");
    expect(published.body.published_at).toBeTruthy();

    const gone = await DELETE(`/blog/admin/posts/${created.body.id}`, {}, { token: admin.token });
    expect(gone.status).toBe(200);
    expect((await GET(`/blog/admin/posts/${created.body.id}`, { token: admin.token })).status).toBe(404);
  });

  test("re-publishing an edited post does not reorder it to the top of the feed", async () => {
    const admin = await signupAdmin("blog-order");
    const post = blogService.create({ title: "Original", status: "published" }, admin.user.id);
    const firstPublishedAt = post.published_at;
    const edited = blogService.update(post.id, { body: "revised", status: "published" });
    // published_at is the publication date, not the last-touched date.
    expect(edited.published_at).toBe(firstPublishedAt);
  });

  test("authoring requires content.write, not merely staff", async () => {
    // The people admin works the support queue; publishing to the public site
    // is a different job with different blast radius.
    const people = await signupStaff("USERS_ADMIN", "blog-people");
    const res = await POST("/blog/admin/posts", { title: "Nope" }, { token: people.token });
    expect(res.status).toBe(403);

    const content = await signupStaff("CONTENT_ADMIN", "blog-content");
    const ok = await POST("/blog/admin/posts", { title: "Allowed" }, { token: content.token });
    expect(ok.status).toBe(201);
  });

  test("a title is required and length is bounded", async () => {
    const admin = await signupAdmin("blog-valid");
    expect((await POST("/blog/admin/posts", { title: "  " }, { token: admin.token })).status).toBe(400);
    expect(
      (await POST("/blog/admin/posts", { title: "x".repeat(201) }, { token: admin.token })).status
    ).toBe(400);
  });
});

describe("blog publishing rules", () => {
  test("a draft is never reachable publicly", async () => {
    const admin = await signupAdmin("blog-draft");
    const draft = blogService.create({ title: "Unfinished thoughts" }, admin.user.id);

    const list = await GET("/blog/posts");
    expect(list.body.posts.find((p) => p.id === draft.id)).toBeUndefined();

    const direct = await GET(`/blog/posts/${draft.slug}`);
    // 404, not 403: a draft's existence is not public information either.
    expect(direct.status).toBe(404);
  });

  test("a published post is public and needs no account", async () => {
    const admin = await signupAdmin("blog-public");
    const post = blogService.create({ title: "Now live", status: "published" }, admin.user.id);
    const res = await GET(`/blog/posts/${post.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Now live");
  });

  test("the blog_enabled flag is enforced server-side", async () => {
    const admin = await signupAdmin("blog-flag");
    blogService.create({ title: "Will be hidden", status: "published" }, admin.user.id);
    settingsService.update({ blog_enabled: false }, admin.user.id);

    expect((await GET("/blog/posts")).body.posts).toEqual([]);
  });
});

describe("the Instagram feed", () => {
  test("reports itself unconfigured rather than inventing posts", async () => {
    // A social feed that fabricates plausible content is worse than an empty
    // one, because nobody can tell it is empty.
    const original = config.instagramAccessToken;
    try {
      config.instagramAccessToken = null;
      const feed = await socialService.instagramFeed();
      expect(feed.configured).toBe(false);
      expect(feed.posts).toEqual([]);
      expect(feed.reason).toMatch(/access token/i);
    } finally {
      config.instagramAccessToken = original;
    }
  });

  test("the public endpoint answers even with no integration", async () => {
    const res = await GET("/blog/instagram");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.posts)).toBe(true);
  });
});

describe("email verification", () => {
  test("a new account starts unverified and is emailed a link", async () => {
    const email = nextEmail("verify");
    const res = await POST("/auth/signup", { email, password: PASSWORD, name: "Verify Me" });
    expect(res.status).toBe(201);
    expect(res.body.user.email_verified).toBe(false);
    // Outside production the link is echoed so the flow is testable without a
    // mail provider.
    expect(res.body.debug_verification_link).toContain("/verify-email?token=");
  });

  test("the link verifies the address, once", async () => {
    const email = nextEmail("verify-once");
    const signupRes = await POST("/auth/signup", { email, password: PASSWORD, name: "Once" });
    const token = new URL(signupRes.body.debug_verification_link).searchParams.get("token");

    const first = await POST("/auth/verify-email", { token });
    expect(first.status).toBe(200);
    expect(first.body.user.email_verified).toBe(true);

    // Single-use: the guard lives in the UPDATE's WHERE clause, so a replayed
    // link cannot re-verify (or verify a since-changed address).
    const second = await POST("/auth/verify-email", { token });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("invalid_verification_token");
  });

  test("a bogus or expired token gives one generic error", async () => {
    const bogus = await POST("/auth/verify-email", { token: "f".repeat(64) });
    expect(bogus.status).toBe(400);
    expect(bogus.body.error.code).toBe("invalid_verification_token");

    const user = await signup("verify-expired");
    const raw = "e".repeat(64);
    db.emailVerifications.create({
      userId: user.user.id,
      tokenHash: new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const expired = await POST("/auth/verify-email", { token: raw });
    // Deliberately the same code as "not found": a stolen link must not be
    // usable to probe which state it is in.
    expect(expired.body.error.code).toBe("invalid_verification_token");
  });

  test("verifying does not sign the user out", async () => {
    const email = nextEmail("verify-session");
    const signupRes = await POST("/auth/signup", { email, password: PASSWORD, name: "Stays In" });
    const token = new URL(signupRes.body.debug_verification_link).searchParams.get("token");
    await POST("/auth/verify-email", { token });

    // The token minted at signup must still work -- being logged out for
    // completing the step we asked for would be a baffling reward.
    // GET /auth/me returns the user object itself, not a { user } wrapper.
    const me = await GET("/auth/me", { token: signupRes.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email_verified).toBe(true);
  });

  test("resend requires being signed in and reports an already-verified address", async () => {
    expect((await POST("/auth/resend-verification", {})).status).toBe(401);

    const email = nextEmail("verify-resend");
    const s = await POST("/auth/signup", { email, password: PASSWORD, name: "Resend" });
    const again = await POST("/auth/resend-verification", {}, { token: s.body.token });
    expect(again.status).toBe(200);
    expect(again.body.debug_verification_link).toContain("token=");

    const token = new URL(again.body.debug_verification_link).searchParams.get("token");
    await POST("/auth/verify-email", { token });
    const noop = await POST("/auth/resend-verification", {}, { token: s.body.token });
    expect(noop.body.message).toMatch(/already confirmed/i);
  });

  test("resending invalidates the previous link", async () => {
    const email = nextEmail("verify-rotate");
    const s = await POST("/auth/signup", { email, password: PASSWORD, name: "Rotate" });
    const firstToken = new URL(s.body.debug_verification_link).searchParams.get("token");

    const resent = await POST("/auth/resend-verification", {}, { token: s.body.token });
    const secondToken = new URL(resent.body.debug_verification_link).searchParams.get("token");

    // Leaving several live links scattered across an inbox is exactly the
    // sort of thing that makes "which email do I click" a support ticket.
    expect((await POST("/auth/verify-email", { token: firstToken })).status).toBe(400);
    expect((await POST("/auth/verify-email", { token: secondToken })).status).toBe(200);
  });
});

describe("instant config propagation", () => {
  test("changing a setting publishes the new public config", async () => {
    const admin = await signupAdmin("cfg-push");
    const seen = [];
    const off = subscribe(Topics.siteConfig(), (p) => seen.push(p));

    settingsService.update({ online_purchase_enabled: false }, admin.user.id);

    expect(seen).toHaveLength(1);
    // What every open storefront receives: the full public config, so a
    // client applies one object rather than reconciling a diff.
    expect(seen[0].online_purchase_enabled).toBe(false);
    off();

    settingsService.update({ online_purchase_enabled: true }, admin.user.id);
  });

  test("the pushed payload never contains a private setting", async () => {
    const admin = await signupAdmin("cfg-private");
    const seen = [];
    const off = subscribe(Topics.siteConfig(), (p) => seen.push(p));
    settingsService.update({ show_prices: false }, admin.user.id);
    off();

    // require_down_payment_covers_payout is deliberately non-public; pushing
    // it to every anonymous browser would leak commercial policy.
    expect(seen[0].require_down_payment_covers_payout).toBeUndefined();
    expect(seen[0].cheque_reminder_lead_days).toBeUndefined();

    settingsService.update({ show_prices: true }, admin.user.id);
  });

  test("the SSE stream opens and sends the current config immediately", async () => {
    // A client connecting mid-change would otherwise wait for the *next*
    // change, which for a setting that flips once is forever.
    const { app } = await import("./httpHelpers.js");
    const streamRes = await app.request("/events/site-config");
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const reader = streamRes.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: config");
    expect(text).toContain("online_purchase_enabled");
    await reader.cancel();
  });
});
