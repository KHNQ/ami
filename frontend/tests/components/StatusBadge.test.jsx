import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusBadge } from "../../src/components/ui/Badge.jsx";

describe("StatusBadge", () => {
  test("renders nothing for a falsy status", () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("known status renders its mapped tone and its catalog label", () => {
    const { getByText } = render(<StatusBadge status="active" />);
    // The label comes from `status.*` in the catalogs now, not from the raw
    // id -- rendered here through the no-provider English fallback.
    const el = getByText("Active");
    // Asserts the tone FAMILY, not the exact tint: the palette was retuned
    // for the storefront's light canvas and will be again, but "active"
    // mapping to the success tone is the behaviour worth pinning.
    expect(el.className).toContain("emerald"); // "success" tone
  });

  test("a multi-word status reads as words, not as its id", () => {
    const { getByText } = render(<StatusBadge status="partially_refunded" />);
    expect(getByText("Partially refunded")).toBeInTheDocument();
  });

  test("an unmapped status falls back to the neutral tone and humanized id", () => {
    const { getByText } = render(<StatusBadge status="totally_made_up" />);
    // No catalog entry: the translator degrades to the final key segment with
    // its underscores stripped, so a status the backend adds later still
    // reads as words rather than as a key path.
    const el = getByText("totally made up");
    expect(el.className).toContain("bg-panel-2"); // "neutral" tone
    expect(el.className).not.toContain("emerald");
  });
});
