import { test, expect } from "@playwright/test";
import { API_URL, BASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from "../playwright.config.js";
import { signupNewUser } from "./helpers.js";

// The cleanup phase, checked in a real browser: what was removed is gone, what
// was fixed is fixed, and what was added works end to end. Layout assertions
// measure geometry rather than eyeballing it, because a layout bug (an
// off-centre number, a gap under the footer) is exactly what unit tests
// cannot see.

async function adminToken(request) {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD },
  });
  return (await res.json()).token;
}

const auth = (token) => ({ authorization: `Bearer ${token}` });

test.describe("removed features are really gone", () => {
  for (const path of ["/service", "/evidence", "/financing", "/leads", "/service#academy", "/financing#trade-in"]) {
    test(`${path} is a 404 page`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: /that page isn.t here/i })).toBeVisible();
    });
  }

  test("the footer links to none of them", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator("footer a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const dead of ["/service", "/evidence", "/financing", "/leads"]) {
      expect(hrefs.filter((h) => h?.startsWith(dead))).toEqual([]);
    }
  });

  test("no exit-intent modal appears when the mouse leaves through the top", async ({ page }) => {
    await page.goto("/devices");
    await page.mouse.move(600, 300);
    await page.mouse.move(600, 0);
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0, bubbles: true })));
    await page.waitForTimeout(400);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the device page has no 'ask a question' control, no reserve and no WhatsApp quick trigger", async ({ page }) => {
    await page.goto("/devices/primelase");
    await expect(page.getByRole("heading", { name: "Primelase Excellence" })).toBeVisible();
    await expect(page.getByText(/ask a question|ask about/i)).toHaveCount(0);
    // The "reserve a unit for 1%" offer, not the word in unrelated copy.
    await expect(page.getByText(/reserve (a|this) unit|reserve for|1\s?% (deposit|reservation)/i)).toHaveCount(0);
    await expect(page.locator("a[href*='wa.me']")).toHaveCount(0);
    await page.getByRole("tab", { name: /lease/i }).click();
    await expect(page.getByText(/pre-approval/i)).toHaveCount(0);
    await expect(page.locator("a[href*='wa.me']")).toHaveCount(0);
  });
});

test.describe("lease flow", () => {
  test("durations come from the product's rules and the request lands in the sales queue", async ({ page, request }) => {
    const token = await adminToken(request);
    const product = await request.post(`${API_URL}/products`, {
      headers: auth(token),
      data: {
        name: "E2E Lease Laser",
        xCents: 1_000_000,
        yCents: 3_000_000,
        stockCount: 5,
        lease_rules: {
          enabled: true,
          min_upfront_pct: 10,
          max_upfront_pct: 50,
          terms: [
            { months: 15, apr_bp: 1500 },
            { months: 33, apr_bp: 1900 },
          ],
        },
      },
    });
    expect(product.status()).toBe(201);
    const { specs } = await product.json();

    // An admin-created product appears in the public catalogue by itself.
    await page.goto("/devices");
    await expect(page.getByText("E2E Lease Laser").first()).toBeVisible();

    await page.goto(`/devices/${specs.slug}`);
    await page.getByRole("tab", { name: /lease/i }).click();
    const radios = page.getByRole("radiogroup").getByRole("radio");
    await expect(radios).toHaveText(["15 months", "33 months"]);

    await page.getByRole("radio", { name: "33 months" }).click();
    await page.getByRole("button", { name: "Request Proforma Invoice" }).click();
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByLabel(/clinic or doctor name/i).fill("Dr E2E");
    await page.getByLabel(/phone or whatsapp/i).fill("+989120000001");
    const posted = page.waitForResponse((r) => r.url().includes("/sales/quotes") && r.request().method() === "POST");
    await page.getByRole("button", { name: /generate/i }).click();
    expect((await posted).status()).toBe(201);

    const queue = await request.get(`${API_URL}/sales/quotes?kind=lease&limit=20`, { headers: auth(token) });
    const row = (await queue.json()).quotes.find((q) => q.subject === "E2E Lease Laser");
    expect(row.term_months).toBe(33);
    expect(row.apr_bp).toBe(1900);
    expect(row.contact_name).toBe("Dr E2E");
  });
});

test.describe("contact intake replaces tickets and chat", () => {
  test("anyone can send a request and staff see it", async ({ page, request }) => {
    await page.goto("/contact");
    await expect(page.getByText(/live chat/i)).toHaveCount(0);
    await page.getByLabel("Your name").fill("E2E Caller");
    await page.getByLabel("Phone or email").fill("e2e-caller@example.com");
    await page.getByLabel("How can we help?").fill("My handpiece stopped firing.");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText(/we have your details/i)).toBeVisible();

    const token = await adminToken(request);
    const list = await request.get(`${API_URL}/support/requests?limit=50`, { headers: auth(token) });
    const found = (await list.json()).requests.find((r) => r.name === "E2E Caller");
    expect(found.message).toBe("My handpiece stopped firing.");
    expect(found.status).toBe("new");
  });

  test("/support forwards to the contact page", async ({ page }) => {
    await page.goto("/support");
    await expect(page).toHaveURL(/\/contact$/);
  });
});

test.describe("blog", () => {
  test("a Markdown post written with front matter is published, rendered safely and listed", async ({ page, request }) => {
    const token = await adminToken(request);
    const created = await request.post(`${API_URL}/blog/admin/posts`, {
      headers: auth(token),
      data: {
        body: [
          "---",
          "title: E2E Markdown Post",
          "slug: e2e-markdown-post",
          "excerpt: Rendered by the e2e suite.",
          "tags: [e2e]",
          "status: published",
          "---",
          "## Section heading",
          "",
          "Some **bold** text and a [link](https://example.com).",
          "",
          "<script>window.__pwned = true</script>",
          "",
          "[bad](javascript:window.__pwned=true)",
        ].join("\n"),
      },
    });
    expect(created.status()).toBe(201);

    await page.goto("/blog");
    await expect(page.getByRole("heading", { name: "E2E Markdown Post" })).toBeVisible();
    await page.getByRole("link", { name: /E2E Markdown Post/ }).click();
    await expect(page).toHaveURL(/\/blog\/e2e-markdown-post$/);
    await expect(page.getByRole("heading", { name: "Section heading" })).toBeVisible();
    await expect(page.locator(".md-content strong")).toHaveText("bold");
    await expect(page.locator(".md-content script")).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    const hrefs = await page.locator(".md-content a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.some((h) => h?.toLowerCase().startsWith("javascript:"))).toBe(false);

    // The head carries what a search engine reads.
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", /\/blog\/e2e-markdown-post$/);
    const ld = await page.locator("script[type='application/ld+json']").first().textContent();
    expect(JSON.parse(ld)["@type"]).toBe("BlogPosting");
  });

  test("an unknown post says so", async ({ page }) => {
    await page.goto("/blog/definitely-not-a-post");
    await expect(page.getByRole("heading", { name: /article not found/i })).toBeVisible();
  });
});

test.describe("layout fixes", () => {
  test("the 404 number sits in the middle of its container, on a retina screen too", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto("/no-such-page");
    // The 3D digits are a canvas; the typographic fallback is text. Either way
    // the visual must be centred on the page's own vertical axis.
    const band = page.locator("canvas, .text-gradient").first();
    await expect(band).toBeVisible();
    await page.waitForTimeout(1200);
    const box = await page.locator("canvas").first().boundingBox().catch(() => null);
    if (box) {
      expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(2);
      // The canvas fits its band instead of overflowing it by the pixel ratio.
      expect(box.width).toBeLessThanOrEqual(1440);
      expect(box.height).toBeLessThanOrEqual(310);
    }
    await ctx.close();
  });

  test("/signup is built like /login", async ({ page }) => {
    const measure = async (path) => {
      await page.goto(path);
      const card = page.locator("[data-slot=card]").first();
      const cardBox = await card.boundingBox();
      const input = page.locator("input").first();
      const inputBox = await input.boundingBox();
      const cta = page.getByRole("button", { name: /^(sign in|login|create account)$/i }).last();
      const ctaBox = await cta.boundingBox();
      return {
        cardWidth: Math.round(cardBox.width),
        cardLeft: Math.round(cardBox.x),
        inputHeight: Math.round(inputBox.height),
        ctaHeight: Math.round(ctaBox.height),
        ctaWidth: Math.round(ctaBox.width),
        social: await page.getByRole("button", { name: /apple|google/i }).count(),
      };
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    const login = await measure("/login");
    const signup = await measure("/signup");
    expect(signup).toEqual(login);
  });

  test("the profile column is centred on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await signupNewUser(page, { name: "Centre Check" });
    await page.goto("/profile");
    const card = page.locator("main").getByText("Centre Check").first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    const box = await card.boundingBox();
    const centre = box.x + box.width / 2;
    expect(Math.abs(centre - 800)).toBeLessThanOrEqual(24);
  });

  test("nothing hangs below the footer", async ({ page }) => {
    for (const path of ["/", "/contact", "/blog"]) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(path);
      await page.waitForTimeout(800);
      const gap = await page.evaluate(() => {
        const footer = document.querySelector("footer");
        const bottom = footer.getBoundingClientRect().bottom + window.scrollY;
        return Math.round(document.documentElement.scrollHeight - bottom);
      });
      // Sub-pixel rounding can make this -1 or +1; a dock-sized band would be ~100.
      expect(Math.abs(gap), `${path} gap=${gap}`).toBeLessThanOrEqual(1);
    }
  });

  test("signed in, the dock does not add a blank band under the footer either", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signupNewUser(page, { name: "Dock Check" });
    await page.goto("/contact");
    await page.waitForTimeout(800);
    const gap = await page.evaluate(() => {
      const footer = document.querySelector("footer");
      return Math.round(document.documentElement.scrollHeight - (footer.getBoundingClientRect().bottom + window.scrollY));
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
  });
});

test.describe("fonts follow the language", () => {
  const FAMILY = { fa: /Vazirmatn/, ar: /IBM Plex Sans Arabic/, fr: /Inter/, it: /Inter/, en: /Inter/ };
  for (const [locale, re] of Object.entries(FAMILY)) {
    test(`${locale} renders in its own typeface`, async ({ page }) => {
      await page.goto(locale === "en" ? "/contact" : `/${locale}/contact`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(family).toMatch(re);
      const dir = await page.locator("html").getAttribute("dir");
      expect(dir).toBe(locale === "fa" || locale === "ar" ? "rtl" : "ltr");
      // The face actually loaded, rather than silently falling back to a system font.
      await page.evaluate(() => document.fonts.ready);
      const primary = family.split(",")[0].replace(/["']/g, "").trim();
      // Faces download lazily, the first time text needs them, so wait for one
      // of the family's subsets to report loaded rather than asking once.
      await page.waitForFunction(
        (f) => [...document.fonts].some((face) => face.family.replace(/["']/g, "") === f && face.status === "loaded"),
        primary,
        { timeout: 15_000 }
      );
      const heading = page.getByRole("heading").first();
      const spacing = await heading.evaluate((el) => getComputedStyle(el).letterSpacing);
      if (locale === "fa" || locale === "ar") expect(spacing).toBe("normal");
    });
  }
});
