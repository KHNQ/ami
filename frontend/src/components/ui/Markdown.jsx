import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "../../lib/cn.js";

// Renders author-written Markdown as markup, safely.
//
// Blog posts are written by staff in the admin console and shown to the
// public, which makes this a stored-XSS boundary: whatever the post contains
// reaches every visitor's browser. Three layers, each sufficient on its own
// against the common attacks:
//
//   1. react-markdown never passes raw HTML through. `<script>` in a post is
//      rendered as the literal text "<script>" -- there is no rehype-raw in
//      this pipeline, and `skipHtml` drops it entirely rather than showing it.
//   2. rehype-sanitize then allow-lists the elements and attributes of what
//      Markdown itself produced, so a plugin or future change that did start
//      emitting HTML could not smuggle an event handler or a style attribute.
//   3. URLs are filtered: only http(s), mailto, tel and site-relative links
//      survive. `javascript:` and `data:` are dropped (react-markdown's
//      default transform also does this; the explicit one keeps the rule in
//      the open and covers images as well as links).
//
// Front matter is removed here too (remark-frontmatter), so a post that was
// stored with its metadata block still renders without it.

const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;

function safeUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  // A bare relative path ("images/a.png") has no scheme, so it is fine; the
  // check is only meant to refuse schemes that execute or embed.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return SAFE_URL.test(trimmed) ? trimmed : "";
  return trimmed;
}

const schema = {
  ...defaultSchema,
  // `tel:` is how a phone number in a post becomes tappable on a phone. The
  // default allow-list stops at http(s), mailto and a few chat schemes, and
  // would silently strip the href. Nothing executable is added by this.
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href || []), "tel"] },
  // Headings get ids so a table of contents or a shared anchor link works --
  // but only as a plain `id`, which the default schema prefixes with
  // "user-content-" to keep it from clobbering the page's own ids.
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ["className", /^language-[\w-]+$/]],
  },
};

// `node` is the syntax-tree node react-markdown hands every component; spread
// onto a DOM element it becomes a literal `node="[object Object]"` attribute.
function Link({ node: _node, href, children, ...rest }) {
  const external = /^https?:\/\//i.test(href || "");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow ugc" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

function Img({ node: _node, src, alt }) {
  // eslint-disable-next-line jsx-a11y/alt-text -- alt comes from the author; an empty one is correct for decoration
  return <img src={src} alt={alt || ""} loading="lazy" decoding="async" />;
}

export function Markdown({ children, className }) {
  return (
    <div className={cn("md-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        urlTransform={safeUrl}
        skipHtml
        components={{ a: Link, img: Img }}
      >
        {String(children ?? "")}
      </ReactMarkdown>
    </div>
  );
}
