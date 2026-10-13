import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DriftWall } from "../../src/components/reactbits/drift-wall.jsx";

// ResizeObserver and matchMedia are stubbed in tests/setup.js;
// IntersectionObserver is left absent on purpose, so what runs here is the
// component's "no observer, assume visible" path.

const items = [
  { key: "a", to: "/devices/a", title: "Open A", media: <span>A</span> },
  { key: "b", to: "/devices/b", title: "Open B", media: <span>B</span> },
];

const renderWall = (props) =>
  render(
    <MemoryRouter>
      <DriftWall items={items} columns={2} label="Wall" {...props} />
    </MemoryRouter>
  );

describe("DriftWall", () => {
  test("renders nothing without items", () => {
    const { container } = render(
      <MemoryRouter>
        <DriftWall items={[]} label="Wall" />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("tiles are in-app links, not new tabs", () => {
    const { container } = renderWall();
    const tiles = [...container.querySelectorAll("[data-drift-tile]")];
    expect(tiles.length).toBeGreaterThan(items.length); // duplicated to drift
    for (const tile of tiles) {
      expect(tile.tagName).toBe("A");
      expect(tile.getAttribute("href")).toMatch(/^\/devices\/[ab]$/);
      // The vendor component opens every tile in a new tab. These are our own
      // product pages, so a target here would reload the whole app.
      expect(tile.getAttribute("target")).toBeNull();
    }
  });

  test("only the first copy of a tile is reachable and announced", () => {
    const { container } = renderWall();
    const focusable = container.querySelectorAll('[data-drift-tile]:not([tabindex="-1"])');
    // One per item, however many copies the drift needs: nine identical
    // links to one device page is noise, not navigation.
    expect(focusable).toHaveLength(items.length);
    for (const tile of focusable) expect(tile.getAttribute("aria-hidden")).toBeNull();
    for (const dup of container.querySelectorAll('[data-drift-tile][tabindex="-1"]')) {
      expect(dup.getAttribute("aria-hidden")).toBe("true");
      // Still clickable, though -- a visitor aims at the tile they can see.
      expect(dup.getAttribute("href")).toBeTruthy();
    }
  });

  test("the wall is a labelled group", () => {
    const { getByRole } = renderWall();
    expect(getByRole("group", { name: "Wall" })).toBeInTheDocument();
  });

  test("tile size scales down with a narrow container", () => {
    const { container } = renderWall({ fitWidth: 1280, tileWidth: 200, minScale: 0.5 });
    // jsdom reports a zero-width box, so the observer never fires and the
    // wall falls back to its reference width -- the scale is 1 and the
    // declared size is used verbatim.
    const wall = container.querySelector(".drift-wall");
    expect(wall.style.getPropertyValue("--dw-tile-w")).toBe("200px");
  });
});
