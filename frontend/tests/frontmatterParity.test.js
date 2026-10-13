import { describe, expect, it } from "vitest";
import * as client from "../src/lib/frontmatter.js";
import * as server from "../../src/lib/frontmatter.js";

// The admin editor (client copy) and the API (server copy) must read a
// metadata block identically, or the editor would show one title and the
// server publish another.
const FIXTURES = [
  "no front matter at all",
  "---\ntitle: Plain\n---\nBody",
  '---\ntitle: "Quoted: with colon"\ntags: [a, "b, c", d]\nstatus: published\nexcerpt:\n---\n\nBody',
  "---\nlist:\n  - one\n  - two\npublished: true\n---\nx",
  "---\ntitle: oops unterminated\n\nBody",
  "﻿---\ntitle: BOM\n---\nBody",
  "---\r\ntitle: CRLF\r\n---\r\nBody\r\n",
];

describe("front matter: client and server agree", () => {
  it.each(FIXTURES.map((f, i) => [i, f]))("parses fixture %i identically", (_i, text) => {
    expect(client.parseFrontmatter(text)).toEqual(server.parseFrontmatter(text));
  });

  it("stringifies identically", () => {
    const data = { title: "A: b", tags: ["x", "y, z"], status: "draft", empty: "" };
    expect(client.stringifyFrontmatter(data, "Body")).toBe(server.stringifyFrontmatter(data, "Body"));
  });

  it("setFrontmatterKey changes one key and keeps the rest", () => {
    const out = client.setFrontmatterKey("---\ntitle: T\nstatus: draft\n---\nBody", "status", "published");
    const { data, body } = client.parseFrontmatter(out);
    expect(data).toEqual({ title: "T", status: "published" });
    expect(body).toBe("Body");
    // and adds a block when there was none
    expect(client.parseFrontmatter(client.setFrontmatterKey("Just body", "status", "published")).data.status).toBe("published");
  });
});
