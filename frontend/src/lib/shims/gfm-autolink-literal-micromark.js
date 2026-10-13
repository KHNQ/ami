// The tokenizer half of the bare-link feature; see gfm-autolink-literal-mdast.js
// for why it is switched off. An empty extension is valid micromark input and
// adds nothing.
export function gfmAutolinkLiteral() {
  return {};
}

export function gfmAutolinkLiteralHtml() {
  return {};
}
