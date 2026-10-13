import { describe, expect, it } from "vitest";
import {
  defaultLeaseRules,
  defaultLeaseTerm,
  instalment,
  leaseOption,
  leasePrice,
  resolveLeaseRules,
} from "../src/b2b/lib/finance.js";
// The server's own module: the browser shows an instalment, the server
// writes one onto the proforma request, and they must be the same number.
import {
  defaultLeaseRules as serverDefaults,
  instalmentCents,
  normalizeLeaseRules,
  quoteLease,
} from "../../src/lib/leaseRules.js";

describe("lease maths: browser and server agree", () => {
  it("computes the same instalment for a grid of inputs", () => {
    for (const price of [1_000, 12_345.67, 36_000, 55_000]) {
      for (const months of [6, 12, 24, 36, 48, 60]) {
        for (const aprBp of [0, 900, 1800, 2400]) {
          const client = instalment({ principal: price * 0.8, months, aprBp });
          const server = instalmentCents({ principalCents: Math.round(price * 0.8 * 100), months, aprBp });
          // Whole cents on the server, floating euros here: they must agree to the cent.
          expect(Math.round(client * 100)).toBeCloseTo(server, -0.5);
          expect(Math.abs(Math.round(client * 100) - server)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("quotes the same option the server does", () => {
    const rules = {
      enabled: true,
      min_upfront_pct: 20,
      max_upfront_pct: 60,
      terms: [
        { months: 12, apr_bp: 1500 },
        { months: 36, apr_bp: 1900 },
      ],
    };
    const server = quoteLease(normalizeLeaseRules(rules), 3_800_000, { months: 36, upfrontPct: 25 });
    const client = leaseOption(resolveLeaseRules({ leaseRules: rules }), 38_000, { months: 36, upfrontPct: 25 });
    expect(Math.round(client.upfront * 100)).toBe(server.upfront_cents);
    expect(Math.round(client.principal * 100)).toBe(server.principal_cents);
    expect(Math.abs(Math.round(client.monthly * 100) - server.instalment_cents)).toBeLessThanOrEqual(1);
    expect(client.aprBp).toBe(server.apr_bp);
  });

  it("defaults are the same four terms on both sides", () => {
    expect(defaultLeaseRules(1700)).toEqual(serverDefaults(1700));
  });
});

describe("lease rules in the browser", () => {
  const rules = resolveLeaseRules({ leaseRules: { enabled: true, min_upfront_pct: 10, max_upfront_pct: 50, terms: [{ months: 48, apr_bp: 2000 }, { months: 12, apr_bp: 1600 }] } });

  it("sorts the terms and keeps each term's own rate", () => {
    expect(rules.terms.map((t) => t.months)).toEqual([12, 48]);
    expect(rules.terms.find((t) => t.months === 48).apr_bp).toBe(2000);
  });

  it("falls back to the defaults for missing or broken rules", () => {
    expect(resolveLeaseRules({}).terms.map((t) => t.months)).toEqual([12, 24, 36, 48]);
    expect(resolveLeaseRules({ leaseRules: { enabled: true, terms: [] } }).terms).toHaveLength(4);
    expect(resolveLeaseRules({ leaseRules: "junk" }).enabled).toBe(true);
    expect(resolveLeaseRules({}, 1700).terms[0].apr_bp).toBe(1700);
  });

  it("an explicitly disabled product stays disabled", () => {
    expect(resolveLeaseRules({ leaseRules: { enabled: false } }).enabled).toBe(false);
  });

  it("refuses an option outside the rules rather than inventing a number", () => {
    expect(leaseOption(rules, 10_000, { months: 24, upfrontPct: 20 })).toBeNull();
    expect(leaseOption(rules, 10_000, { months: 12, upfrontPct: 5 })).toBeNull();
    expect(leaseOption(rules, 10_000, { months: 12, upfrontPct: 80 })).toBeNull();
    expect(leaseOption(rules, 0, { months: 12, upfrontPct: 20 })).toBeNull();
    expect(leaseOption({ ...rules, enabled: false }, 10_000, { months: 12, upfrontPct: 20 })).toBeNull();
  });

  it("a longer term lowers the instalment and raises the total", () => {
    const short = leaseOption(rules, 20_000, { months: 12, upfrontPct: 20 });
    const long = leaseOption(rules, 20_000, { months: 48, upfrontPct: 20 });
    expect(long.monthly).toBeLessThan(short.monthly);
    expect(long.total).toBeGreaterThan(short.total);
  });

  it("the admin's lease base price wins over the device price", () => {
    const withBase = resolveLeaseRules({ leaseRules: { enabled: true, base_price_cents: 5_000_000, terms: [{ months: 12, apr_bp: 0 }] } });
    expect(leasePrice({ price: 99_999 }, withBase)).toBe(50_000);
    expect(leasePrice({ price: 99_999 }, rules)).toBe(99_999);
  });

  it("pre-selects the term nearest two years, not a hardcoded 24", () => {
    expect(defaultLeaseTerm(rules)).toBe(12); // 12 and 48 are equally far; the earlier wins
    expect(defaultLeaseTerm(defaultLeaseRules())).toBe(24);
    expect(defaultLeaseTerm(resolveLeaseRules({ leaseRules: { enabled: true, terms: [{ months: 36, apr_bp: 1 }, { months: 60, apr_bp: 1 }] } }))).toBe(36);
    expect(defaultLeaseTerm({ terms: [] })).toBeNull();
  });
});
