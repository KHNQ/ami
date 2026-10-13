import { test, expect } from "@playwright/test";
import { BASE_URL } from "../playwright.config.js";

// A phone-width page that scrolls sideways feels broken in a way people
// notice immediately and cannot articulate -- the content drifts under the
// thumb, and the layout looks like it does not fit the device.
//
// It is also easy to reintroduce: one `-mx-5` full-bleed applied to an
// element whose parent has no matching padding is enough, which is exactly
// the bug this test was written for (the home page's partner-network section
// sat outside the padded column and cancelled padding that was not there).
// Nothing in a build or a unit test catches it, so it gets a real browser.

const ROUTES = ["/", "/partners", "/our-story", "/careers", "/contact", "/socials", "/login", "/signup", "/blog", "/devices"];

// 320 is the narrowest phone still in use and where a fixed-width child
// shows up first; 430 matches a current large handset. The rest are the
// breakpoints the app column steps at (768/1024/1280) plus one width beyond
// the widest step, where the column stops growing and the page has to stay
// centred rather than drift or overhang.
const WIDTHS = [320, 430, 768, 1024, 1280, 1920];

test.describe("no horizontal scroll", () => {
  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      test(`${route} does not scroll sideways at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(BASE_URL + route, { waitUntil: "load" });
        // Let lazy sections and any entrance animation settle -- an element
        // mid-transform can transiently overhang without being a real bug.
        await page.waitForTimeout(1200);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );

        // A 1px tolerance for sub-pixel rounding at fractional device ratios.
        expect(`${route}@${width} overflow=${overflow}`).toBe(`${route}@${width} overflow=0`);
      });
    }
  }

  // The check above passes just as happily for a 560px strip stranded in the
  // middle of a 1920px monitor -- no overflow, and no use of the screen
  // either. This asserts the column actually grows, so the phone-width cap
  // cannot quietly come back.
  for (const [width, min] of [
    [768, 700],
    [1024, 900],
    [1280, 1080],
  ]) {
    test(`the app column uses the width at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(BASE_URL + "/", { waitUntil: "load" });
      await page.waitForTimeout(800);
      const rootWidth = await page.evaluate(() => document.getElementById("root").getBoundingClientRect().width);
      expect(`@${width} column=${Math.round(rootWidth) >= min}`).toBe(`@${width} column=true`);
    });
  }

  // Phone rendering must be unaffected by any of the above. 560px is the
  // design width and the base cap; below it the column is simply the
  // viewport, exactly as before the app became responsive.
  test("the column is still full-bleed on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL + "/", { waitUntil: "load" });
    await page.waitForTimeout(600);
    const rootWidth = await page.evaluate(() => document.getElementById("root").getBoundingClientRect().width);
    expect(Math.round(rootWidth)).toBe(390);
  });
});
