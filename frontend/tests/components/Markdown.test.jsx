import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "../../src/components/ui/Markdown.jsx";

// Blog posts are written by staff and read by the public: this is the
// boundary where an author's text becomes markup in a visitor's browser.

const html = (md) => {
  const { container } = render(<Markdown>{md}</Markdown>);
  return container.innerHTML;
};

describe("Markdown renders what authors write", () => {
  it("headings, emphasis, lists, links, quotes and code", () => {
    const out = html("# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n> quoted\n\n`code`\n\n[link](https://example.com)");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain('href="https://example.com"');
  });

  it("GitHub-flavoured tables and task lists", () => {
    const out = html("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo");
    expect(out).toContain("<table>");
    expect(out).toContain('type="checkbox"');
  });

  it("opens external links safely in a new tab", () => {
    const out = html("[x](https://example.com)");
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });

  it("keeps same-site links in the page", () => {
    const out = html("[devices](/devices)");
    expect(out).toContain('href="/devices"');
    expect(out).not.toContain("_blank");
  });

  it("lazy-loads images", () => {
    expect(html("![alt text](https://example.com/a.png)")).toContain('loading="lazy"');
  });

  it("strips front matter that was stored with the post", () => {
    const out = html("---\ntitle: Secret metadata\n---\n\n# Visible");
    expect(out).toContain("Visible");
    expect(out).not.toContain("Secret metadata");
  });

  it("renders nothing for null or undefined", () => {
    expect(html(null)).toBe('<div class="md-content"></div>');
    expect(html(undefined)).toBe('<div class="md-content"></div>');
  });
});

describe("Markdown is not an injection vector", () => {
  it("does not turn a script tag into a script element", () => {
    const { container } = render(<Markdown>{"hello <script>window.__pwned = 1</script> world"}</Markdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });

  it("drops inline event handlers and raw HTML", () => {
    const { container } = render(<Markdown>{'<img src=x onerror="window.__pwned=1"> <b onclick="x()">b</b> <iframe src="https://evil.test"></iframe>'}</Markdown>);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.innerHTML).not.toContain("onclick");
  });

  it("refuses javascript: and data: URLs in links and images", () => {
    const out = html("[a](javascript:alert(1)) [b](data:text/html;base64,PHNjcmlwdD4=) [c](JaVaScRiPt:alert(1)) ![d](javascript:alert(1))");
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).not.toContain("data:text/html");
  });

  it("refuses vbscript: and file: URLs", () => {
    const out = html("[a](vbscript:msgbox(1)) [b](file:///etc/passwd)");
    expect(out.toLowerCase()).not.toContain("vbscript:");
    expect(out).not.toContain("file:");
  });

  it("allows mailto and tel", () => {
    const out = html("[mail](mailto:a@b.co) [call](tel:+982112345)");
    expect(out).toContain('href="mailto:a@b.co"');
    expect(out).toContain('href="tel:+982112345"');
  });

  it("does not let a style or class attribute through", () => {
    const { container } = render(<Markdown>{'<p style="position:fixed;inset:0" class="x">hi</p>'}</Markdown>);
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("escapes angle brackets in code spans rather than interpreting them", () => {
    const { container } = render(<Markdown>{"`<script>alert(1)</script>`"}</Markdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("code").textContent).toBe("<script>alert(1)</script>");
  });
});
