import { useContext } from "react";
import { SSRDataContext } from "../../lib/ssrDataContext.js";
import { resolveOrigin } from "../../lib/origin.js";
import { useSiteConfig } from "../../context/SiteConfigContext.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { LOCALE_CODES, localePath, localeMeta, splitLocalePath } from "../../i18n/config.js";

// Per-page head tags for the storefront.
//
// React 19 hoists <title>/<meta>/<link> from anywhere in the tree to the
// front of the render, and server.js splits that leading run out into the
// real <head> (see HEAD_TAG_RUN there). So a page states its own metadata
// inline and it works identically server-side and on the client.
//
// This exists because server.js strips the static <title> out of
// index.html for every server-rendered route -- a page that renders none of
// its own would otherwise ship with no title at all, which is the worst
// possible outcome for the routes that exist to be found in search.

// What the page may add beyond the basics:
//   image     absolute or site-relative URL for og:image / twitter:image
//   jsonLd    one schema.org object, or an array of them
//   type      og:type -- "website" | "product" | "article"
//   article   { publishedTime, modifiedTime, tags[], author } for og:type=article
//   canonical overrides the computed canonical path (rarely needed)
//
// The site name, the fallback description, the fallback share image and the
// Twitter handle come from the `seo_*` settings an admin maintains in the
// console, so search metadata can be corrected without a deploy.
export function PageMeta({
  title,
  description,
  path,
  image,
  jsonLd,
  type = "website",
  article = null,
  noIndex = false,
}) {
  const ssrData = useContext(SSRDataContext);
  const { locale } = useI18n();
  const config = useSiteConfig();
  const origin = resolveOrigin(ssrData);
  const siteName = (config?.seo_site_name || "").trim() || "Ashkan Medical Idea";
  const desc = (description || config?.seo_default_description || "").trim();
  const twitterSite = (config?.seo_twitter_handle || "").trim();

  // Social previews need an absolute URL: crawlers do not resolve a path
  // against a page they have not loaded.
  const rawImage = image || (config?.seo_default_image || "").trim() || null;
  const imageUrl = rawImage ? (/^https?:\/\//i.test(rawImage) ? rawImage : `${origin}${rawImage}`) : null;
  const jsonLdList = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  // `path` is written unprefixed by every caller (the router strips the
  // locale into a basename), so the canonical has to put it back -- without
  // this, all five languages claim the same canonical URL and four of them
  // are dropped from the index as duplicates.
  const { path: bare } = splitLocalePath(path || "/");
  const url = origin && path ? `${origin}${localePath(locale, bare)}` : undefined;
  const full = `${title} — ${siteName}`;

  // The signed-in screens (account, orders, support, profile) share this
  // component so they get a real <title> like every other page -- but a
  // canonical and five hreflang alternates for a page nobody can reach
  // without a session would advertise URLs that always return the login
  // screen to a crawler. They get the title and nothing else.
  if (noIndex) {
    return (
      <>
        <title>{full}</title>
        {desc ? <meta name="description" content={desc} /> : null}
        <meta name="robots" content="noindex,nofollow" />
      </>
    );
  }

  return (
    <>
      <title>{full}</title>
      {desc ? <meta name="description" content={desc} /> : null}
      {url ? <link rel="canonical" href={url} /> : null}
      {/* One alternate per language plus x-default. Without them the five
          locale variants compete as duplicate content instead of being
          understood as translations of one page. */}
      {origin
        ? LOCALE_CODES.map((code) => (
            <link
              key={code}
              rel="alternate"
              hrefLang={code}
              href={`${origin}${localePath(code, bare)}`}
            />
          ))
        : null}
      {origin ? <link rel="alternate" hrefLang="x-default" href={`${origin}${bare}`} /> : null}
      <meta name="robots" content="index,follow,max-image-preview:large" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:locale" content={localeMeta(locale).intl.replace("-", "_")} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={full} />
      {desc ? <meta property="og:description" content={desc} /> : null}
      {url ? <meta property="og:url" content={url} /> : null}
      {imageUrl ? <meta property="og:image" content={imageUrl} /> : null}
      {article?.publishedTime ? <meta property="article:published_time" content={article.publishedTime} /> : null}
      {article?.modifiedTime ? <meta property="article:modified_time" content={article.modifiedTime} /> : null}
      {(article?.tags || []).map((tag) => (
        <meta key={tag} property="article:tag" content={tag} />
      ))}
      <meta name="twitter:card" content={imageUrl ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={full} />
      {desc ? <meta name="twitter:description" content={desc} /> : null}
      {imageUrl ? <meta name="twitter:image" content={imageUrl} /> : null}
      {twitterSite ? <meta name="twitter:site" content={twitterSite} /> : null}
      {jsonLdList.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger -- structured data has
          // no text-node form; the payload is built from our own data.
          // "<" is escaped so a post title containing "</script>" cannot end
          // the block early.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item).replace(/</g, "\\u003c") }}
        />
      ))}
    </>
  );
}
