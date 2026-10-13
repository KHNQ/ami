import { describe, test, expect, vi, afterEach } from "vitest";
import { money, pct, shortDate, fullDate, relativeTime, initials, truncate } from "../src/lib/format.js";

describe("money", () => {
  test("formats cents as USD currency", () => {
    expect(money(12345)).toBe("$123.45");
    expect(money(0)).toBe("$0.00");
    expect(money(-500)).toBe("-$5.00");
  });

  test("null/undefined render as an em dash", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
  });

  test("opts override Intl.NumberFormat options", () => {
    expect(money(12345, { minimumFractionDigits: 0, maximumFractionDigits: 0 })).toBe("$123");
  });
});

describe("pct", () => {
  test("null/undefined render as an em dash", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });

  test("whole-percent basis points render with no decimal", () => {
    expect(pct(6500)).toBe("65%");
    expect(pct(0)).toBe("0%");
  });

  test("fractional basis points render with one decimal", () => {
    expect(pct(6550)).toBe("65.5%");
  });
});

describe("shortDate / fullDate", () => {
  test("falsy input renders as an em dash", () => {
    expect(shortDate(null)).toBe("—");
    expect(shortDate("")).toBe("—");
    expect(fullDate(null)).toBe("—");
  });

  test("valid ISO date formats without throwing", () => {
    expect(shortDate("2026-03-05T00:00:00.000Z")).toMatch(/\w+ \d+/);
    expect(fullDate("2026-03-05T00:00:00.000Z")).toMatch(/\d{4}/);
  });
});

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("falsy input renders as an em dash", () => {
    expect(relativeTime(null)).toBe("—");
  });

  test("'now', for sub-minute differences", () => {
    // This used to be a hardcoded "just now". It now comes from
    // Intl.RelativeTimeFormat like every other branch, which changes the
    // English wording slightly but means the sub-minute case actually
    // translates -- it was the one string in this file that would have
    // stayed English on a Persian or Arabic page.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
    expect(relativeTime("2026-03-05T11:59:31.000Z")).toBe("now");
  });

  test("formats in the requested locale, not always English", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
    const french = relativeTime("2026-03-05T09:00:00.000Z", "fr");
    expect(french).toContain("heures");
    expect(french).not.toContain("hours");
  });

  test("minutes ago, once the minute threshold is crossed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
    expect(relativeTime("2026-03-05T11:58:00.000Z")).toBe("2 minutes ago");
  });

  test("future timestamps render as 'in N minutes'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T12:00:00.000Z"));
    expect(relativeTime("2026-03-05T12:05:00.000Z")).toBe("in 5 minutes");
  });
});

describe("initials", () => {
  test("falsy input renders a question mark", () => {
    expect(initials(null)).toBe("?");
    expect(initials("")).toBe("?");
  });

  test("single word uses its first letter", () => {
    expect(initials("Trex")).toBe("T");
  });

  test("multi-word names use the first two words' initials", () => {
    expect(initials("Sam Shopper")).toBe("SS");
    expect(initials("  Sam   Middle Shopper  ")).toBe("SM");
  });
});

describe("truncate", () => {
  test("falsy input renders empty string", () => {
    expect(truncate(null)).toBe("");
  });

  test("short strings pass through unchanged", () => {
    expect(truncate("hello", 24)).toBe("hello");
  });

  test("long strings are cut with an ellipsis", () => {
    const long = "a".repeat(30);
    expect(truncate(long, 24)).toBe(`${"a".repeat(24)}…`);
  });

  test("default length is 24", () => {
    const long = "b".repeat(30);
    expect(truncate(long)).toBe(`${"b".repeat(24)}…`);
  });
});
