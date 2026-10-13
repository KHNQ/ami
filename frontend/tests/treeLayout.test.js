import { describe, test, expect } from "vitest";
import { layoutTree } from "../src/lib/treeLayout.js";

function leaf(id) {
  return { node_id: id, children: [] };
}
function node(id, children) {
  return { node_id: id, children };
}

describe("layoutTree", () => {
  test("null root produces an empty layout", () => {
    const layout = layoutTree(null);
    expect(layout.positions.size).toBe(0);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  test("a single leaf root is its own layout, at depth 0, with no edges", () => {
    const layout = layoutTree(leaf("a"));
    expect(layout.positions.size).toBe(1);
    expect(layout.edges).toEqual([]);
    const pos = layout.positions.get("a");
    expect(pos.depth).toBe(0);
    expect(pos.childCount).toBe(0);
    expect(pos.descendantCount).toBe(0);
  });

  test("a parent with two leaf children is centered exactly between them", () => {
    const tree = node("root", [leaf("a"), leaf("b")]);
    const layout = layoutTree(tree);

    expect(layout.positions.size).toBe(3);
    expect(layout.edges).toEqual([
      { fromId: "root", toId: "a" },
      { fromId: "root", toId: "b" },
    ]);

    const root = layout.positions.get("root");
    const a = layout.positions.get("a");
    const b = layout.positions.get("b");

    expect(root.x).toBeCloseTo((a.x + b.x) / 2);
    expect(a.depth).toBe(1);
    expect(b.depth).toBe(1);
    expect(root.depth).toBe(0);
    expect(root.childCount).toBe(2);
    expect(root.descendantCount).toBe(2);
  });

  test("depth increases y by a constant step per level, and always downward", () => {
    // root -> mid -> leaf, a straight 3-level chain.
    const tree = node("root", [node("mid", [leaf("grandchild")])]);
    const layout = layoutTree(tree);

    const root = layout.positions.get("root");
    const mid = layout.positions.get("mid");
    const grandchild = layout.positions.get("grandchild");

    const step1 = mid.y - root.y;
    const step2 = grandchild.y - mid.y;
    expect(step1).toBeGreaterThan(0);
    expect(step2).toBe(step1);
  });

  test("edge count always equals node count minus one (tree invariant)", () => {
    const tree = node("root", [
      node("a", [leaf("a1"), leaf("a2")]),
      node("b", [leaf("b1"), leaf("b2"), leaf("b3")]),
    ]);
    const layout = layoutTree(tree);
    expect(layout.edges.length).toBe(layout.positions.size - 1);
  });

  test("sibling leaves are evenly spaced left-to-right", () => {
    const tree = node("root", [leaf("a"), leaf("b"), leaf("c"), leaf("d")]);
    const layout = layoutTree(tree);
    const xs = ["a", "b", "c", "d"].map((id) => layout.positions.get(id).x);

    const step1 = xs[1] - xs[0];
    const step2 = xs[2] - xs[1];
    const step3 = xs[3] - xs[2];
    expect(step1).toBeGreaterThan(0);
    expect(step1).toBe(step2);
    expect(step2).toBe(step3);
  });

  test("descendantCount counts the whole subtree, not just direct children", () => {
    const tree = node("root", [node("a", [leaf("a1"), leaf("a2")]), leaf("b")]);
    const layout = layoutTree(tree);
    expect(layout.positions.get("root").descendantCount).toBe(4); // a, a1, a2, b
    expect(layout.positions.get("a").descendantCount).toBe(2); // a1, a2
    expect(layout.positions.get("b").descendantCount).toBe(0);
  });

  test("width and height grow with tree breadth and depth", () => {
    const wide = layoutTree(node("root", [leaf("a"), leaf("b"), leaf("c")]));
    const narrow = layoutTree(node("root", [leaf("a")]));
    expect(wide.width).toBeGreaterThan(narrow.width);

    const deep = layoutTree(node("root", [node("mid", [leaf("leaf")])]));
    const shallow = layoutTree(leaf("root"));
    expect(deep.height).toBeGreaterThan(shallow.height);
  });
});
