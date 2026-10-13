import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const openRfq = vi.fn();
vi.mock("../../src/b2b/context/StorefrontContext.jsx", () => ({
  useStorefront: () => ({ openRfq }),
}));

const { LeaseConfigurator } = await import("../../src/b2b/sections/LeaseConfigurator.jsx");

const device = (over = {}) => ({
  id: "aurora",
  name: "Aurora",
  price: 40_000,
  priceOnRequest: false,
  leaseRules: {
    enabled: true,
    min_upfront_pct: 10,
    max_upfront_pct: 50,
    terms: [
      { months: 12, apr_bp: 1600 },
      { months: 36, apr_bp: 1900 },
      { months: 60, apr_bp: 2100 },
    ],
  },
  ...over,
});

beforeEach(() => openRfq.mockReset());

describe("the lease tab", () => {
  it("offers exactly the durations the admin allowed -- not a fixed 24 months", () => {
    render(<LeaseConfigurator device={device()} pricesVisible />);
    const group = screen.getByRole("radiogroup");
    const labels = within(group).getAllByRole("radio").map((r) => r.textContent);
    expect(labels).toEqual(["12 months", "36 months", "60 months"]);
    expect(screen.queryByText("24 months")).toBeNull();
  });

  it("falls back to 12/24/36/48 for a product with no rules", () => {
    render(<LeaseConfigurator device={device({ leaseRules: null })} pricesVisible />);
    const labels = within(screen.getByRole("radiogroup")).getAllByRole("radio").map((r) => r.textContent);
    expect(labels).toEqual(["12 months", "24 months", "36 months", "48 months"]);
  });

  it("selecting a duration changes the instalment", async () => {
    const user = userEvent.setup();
    render(<LeaseConfigurator device={device()} pricesVisible />);
    const monthly = () => document.querySelector(".bg-ink .text-3xl").textContent;
    await user.click(screen.getByRole("radio", { name: "12 months" }));
    const short = monthly();
    await user.click(screen.getByRole("radio", { name: "60 months" }));
    expect(monthly()).not.toBe(short);
    expect(screen.getByRole("radio", { name: "60 months" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the removed features nowhere: no pre-approval, no clinic or phone fields, no WhatsApp, no reserve", () => {
    const { container } = render(<LeaseConfigurator device={device()} pricesVisible />);
    const text = container.textContent.toLowerCase();
    expect(text).not.toContain("pre-approval");
    expect(text).not.toContain("whatsapp");
    // The "reserve a unit for 1%" offer and its deposit are gone.
    expect(text).not.toMatch(/reserve (a|this|for)|1\s?%|deposit/);
    expect(container.querySelector("input[type=text], input[type=tel], input[inputmode=tel], input[inputmode=numeric]")).toBeNull();
    expect(container.querySelector("a[href*='wa.me']")).toBeNull();
  });

  it("has one action, 'Request Proforma Invoice', which passes the chosen terms on", async () => {
    const user = userEvent.setup();
    render(<LeaseConfigurator device={device()} pricesVisible />);
    await user.click(screen.getByRole("radio", { name: "60 months" }));
    await user.click(screen.getByRole("button", { name: "Request Proforma Invoice" }));
    expect(openRfq).toHaveBeenCalledTimes(1);
    const [deviceId, enquiry, lease] = openRfq.mock.calls[0];
    expect(deviceId).toBe("aurora");
    expect(enquiry).toBeNull();
    expect(lease.months).toBe(60);
    expect(lease.upfrontPct).toBeGreaterThanOrEqual(10);
    expect(lease.upfrontPct).toBeLessThanOrEqual(50);
    expect(lease.priced).toBe(true);
  });

  it("leases against the admin's base price when there is one", () => {
    const { rerender } = render(<LeaseConfigurator device={device()} pricesVisible />);
    const cash = () => [...document.querySelectorAll("dt")].find((n) => n.textContent.includes("Cash price")).nextSibling.textContent;
    expect(cash()).toContain("40,000");
    rerender(
      <LeaseConfigurator
        device={device({ leaseRules: { ...device().leaseRules, base_price_cents: 3_000_000 } })}
        pricesVisible
      />
    );
    expect(cash()).toContain("30,000");
  });

  it("shows no figures when prices are hidden, but still lets the visitor ask", async () => {
    const user = userEvent.setup();
    render(<LeaseConfigurator device={device()} pricesVisible={false} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toContain("40,000");
    await user.click(screen.getByRole("button", { name: "Request Proforma Invoice" }));
    expect(openRfq.mock.calls[0][2].priced).toBe(false);
  });

  it("says so, and still offers a proforma, when leasing is switched off for the device", async () => {
    const user = userEvent.setup();
    render(<LeaseConfigurator device={device({ leaseRules: { enabled: false } })} pricesVisible />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(/isn.t offered/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request Proforma Invoice" }));
    expect(openRfq).toHaveBeenCalledWith("aurora");
  });

  it("the comparison table lists every allowed duration once", () => {
    render(<LeaseConfigurator device={device()} pricesVisible />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
  });
});
