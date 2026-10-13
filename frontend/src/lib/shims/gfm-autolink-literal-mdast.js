// Replaces `mdast-util-gfm-autolink-literal`, which ships a regex literal with
// a lookbehind (`(?<=^|\s|\p{P}|\p{S})`). Safari only supports lookbehind from
// 16.4; on anything older the engine cannot even parse the file, so merely
// importing the Markdown renderer threw
//   SyntaxError: Invalid regular expression: invalid group specifier name
// and took the page with it, while Chrome and Firefox carried on.
//
// What is lost: a bare `https://example.com` or `me@example.com` typed in a
// post is no longer turned into a link on its own. Explicit Markdown links
// (`[text](url)`) are unaffected, and that is the form the editor's toolbar
// writes. The matching tokenizer (see gfm-autolink-literal-micromark.js) is
// stubbed with it, so the two halves stay consistent.
//
// Wired up as an alias in vite.config.js (storefront) and admin/vite.config.js.
export function gfmAutolinkLiteralFromMarkdown() {
  return {};
}

export function gfmAutolinkLiteralToMarkdown() {
  return {};
}
