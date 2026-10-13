import { describe, it, expect } from "vitest";
import { isLand, buildDotGrid, LAND_BOXES, countryAt, countrySlug, groupByCountry } from "../src/lib/landMask.js";
import { PARTNERS } from "../src/lib/siteContent.generated.js";

// The point of describing land as boxes rather than drawing a bitmap: these
// are assertions, not something that has to be eyeballed.

describe("land mask", () => {
  it("puts every partner city on land", () => {
    // If a partner pin lands in the ocean the map looks broken, and this is
    // the only place that can be checked without a browser.
    const cities = [
      ["Tehran", 51.4103, 35.7575],
      ["Nuremberg", 11.0767, 49.4521],
      ["Seoul", 126.978, 37.5665],
      ["Barcelona", 2.1686, 41.3874],
      ["Sophia Antipolis", 7.05, 43.6167],
      ["Ljubljana", 14.5058, 46.0569],
      ["London", -0.1276, 51.5072],
      ["Verona", 10.9916, 45.4384],
      ["McKinney, Texas", -96.6398, 33.1972],
    ];
    for (const [name, lng, lat] of cities) {
      expect(`${name}=${isLand(lng, lat)}`).toBe(`${name}=true`);
    }
  });

  it("keeps the oceans empty", () => {
    const oceans = [
      ["mid-Atlantic", -30, 20],
      ["mid-Pacific", -150, 0],
      ["Indian Ocean", 75, -30],
      ["Southern Ocean", 0, -65],
      ["North Pacific", -170, 35],
    ];
    for (const [name, lng, lat] of oceans) {
      expect(`${name}=${isLand(lng, lat)}`).toBe(`${name}=false`);
    }
  });

  it("describes every continent", () => {
    const continents = [
      ["North America", -100, 40],
      ["South America", -55, -15],
      ["Europe", 10, 50],
      ["Africa", 20, 0],
      ["Asia", 100, 35],
      ["Australia", 135, -25],
    ];
    for (const [name, lng, lat] of continents) {
      expect(`${name}=${isLand(lng, lat)}`).toBe(`${name}=true`);
    }
  });

  it("uses well-formed boxes", () => {
    for (const [w, s, e, n] of LAND_BOXES) {
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      expect(w).toBeGreaterThanOrEqual(-180);
      expect(e).toBeLessThanOrEqual(180);
      expect(s).toBeGreaterThanOrEqual(-90);
      expect(n).toBeLessThanOrEqual(90);
    }
  });
});

describe("dot grid", () => {
  it("produces a usable number of dots in canvas space", () => {
    const dots = buildDotGrid();
    expect(dots.length).toBeGreaterThan(300);
    // An upper bound too: this array is iterated every frame, so a change
    // that accidentally 10x'd it should fail here rather than on a phone.
    expect(dots.length).toBeLessThan(6000);
    for (const d of dots) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(1);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(1);
    }
  });

  it("gets denser with a finer step", () => {
    expect(buildDotGrid({ step: 2 }).length).toBeGreaterThan(buildDotGrid({ step: 5 }).length);
  });

  it("compensates for equirectangular distortion near the poles", () => {
    // Without the cosine correction the Arctic renders as a solid bar and
    // the tropics look sparse by comparison.
    const dots = buildDotGrid({ step: 3.2 });
    const arctic = dots.filter((d) => d.y < 0.14).length;
    const temperate = dots.filter((d) => d.y > 0.25 && d.y < 0.4).length;
    expect(arctic).toBeLessThan(temperate);
  });
});

describe("country clustering", () => {
  // A country on this map is a *group* of dots, never one dot. A single point
  // standing in for all of Germany reads as a map pin rather than a landmass,
  // and highlighting one dot on hover is what made the previous version look
  // fake. These assertions are what keep that property true.

  it("resolves a partner's country name to a tagged region", () => {
    expect(countrySlug("Germany")).toBe("germany");
    expect(countrySlug("South Korea")).toBe("south-korea");
    expect(countrySlug("United States")).toBe("united-states");
    // A country with no region defined must return null rather than a slug
    // that matches nothing -- otherwise the highlight silently does nothing.
    expect(countrySlug("Atlantis")).toBeNull();
    expect(countrySlug(null)).toBeNull();
  });

  it("places known cities in the right country", () => {
    expect(countryAt(11.08, 49.45)).toBe("germany");      // Nuremberg
    expect(countryAt(126.98, 37.57)).toBe("south-korea"); // Seoul
    expect(countryAt(2.17, 41.39)).toBe("spain");         // Barcelona
    expect(countryAt(51.41, 35.76)).toBe("iran");         // Tehran
    // Mid-Atlantic belongs to nobody.
    expect(countryAt(-30, 30)).toBeNull();
  });

  it("gives every partner country a cluster of many dots, not one", () => {
    const groups = groupByCountry(buildDotGrid({ step: 3.1 }));
    const countries = [...new Set(PARTNERS.map((p) => countrySlug(p.country)).filter(Boolean))];
    expect(countries.length).toBeGreaterThan(0);

    for (const slug of countries) {
      const dots = groups.get(slug) || [];
      // "More than one" is the whole point; a country that resolves to a
      // single dot would render identically to a pin.
      expect(`${slug}: ${dots.length > 1}`).toBe(`${slug}: true`);
    }
  });

  it("tags only land dots, and leaves open ocean untagged", () => {
    const dots = buildDotGrid({ step: 3.1 });
    const tagged = dots.filter((d) => d.country);
    expect(tagged.length).toBeGreaterThan(0);
    // Most of the world is not a partner country, so tagging must be the
    // exception -- if it were not, the highlight would light up everything.
    expect(tagged.length).toBeLessThan(dots.length / 2);
  });
});
