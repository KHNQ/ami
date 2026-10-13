import { useContext } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Clock, Newspaper } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAsync } from "../../hooks/useAsync.js";
import { SSRDataContext } from "../../lib/ssrDataContext.js";
import { resolveOrigin } from "../../lib/origin.js";
import { useFeature, useSiteConfig } from "../../context/SiteConfigContext.jsx";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { localePath, splitLocalePath } from "../../i18n/config.js";
import { Markdown } from "../../components/ui/Markdown.jsx";
import { Skeleton } from "../../components/ui/Skeleton.jsx";
import { Chip, SectionHead, PillButton } from "../ui/primitives.jsx";
import { PageMeta } from "../ui/PageMeta.jsx";

// The public blog: /blog (the catalogue of published posts) and
// /blog/:slug (one post).
//
// Posts are Markdown written in the admin console. They are fetched as
// Markdown source and rendered here by components/ui/Markdown.jsx, which is
// where the sanitising happens -- the API never returns markup. Both routes
// are server-rendered (see server.js), so a crawler or a link-preview bot
// receives the article's text, title, description and structured data rather
// than an empty shell.

const longDate = (iso, intl) =>
  iso
    ? new Date(iso).toLocaleDateString(intl, { year: "numeric", month: "long", day: "numeric" })
    : "";

function useIntlTag() {
  const { locale } = useI18n();
  return locale;
}

function PostCard({ post }) {
  const { t } = useI18n();
  const intl = useIntlTag();
  return (
    <Link
      to={`/blog/${post.slug}`}
      data-spotlight
      className="b2b-card group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel"
    >
      {post.cover_url ? (
        <div className="aspect-[16/9] w-full overflow-hidden bg-panel-2">
          <img
            src={post.cover_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-4">
        {post.tags?.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {post.tags.slice(0, 3).map((tag) => (
              <Chip key={tag} tone="brand">
                {tag}
              </Chip>
            ))}
          </div>
        ) : null}
        <h2 className="text-[17px] leading-snug font-black text-ink">{post.title}</h2>
        {post.excerpt ? (
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-2">{post.excerpt}</p>
        ) : null}
        <p className="mt-auto flex items-center gap-3 pt-3 text-[11.5px] text-ink-3">
          {post.published_at ? <time dateTime={post.published_at}>{longDate(post.published_at, intl)}</time> : null}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden />
            {t("blog.minRead", { count: post.reading_minutes || 1 })}
          </span>
        </p>
      </div>
    </Link>
  );
}

export function BlogIndexPage() {
  const { t } = useI18n();
  const ssr = useContext(SSRDataContext);
  const enabled = useFeature("blog_enabled");
  const seeded = ssr?.route === "blog" ? ssr.posts : null;
  const { data, loading, error } = useAsync(() => (enabled ? api.listPosts({ limit: 50 }) : Promise.resolve({ posts: [] })), [enabled]);
  const posts = data?.posts ?? seeded ?? [];
  const showLoading = loading && !seeded;

  const origin = resolveOrigin(ssr);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: t("blog.title"),
    description: t("blog.metaDesc"),
    ...(origin ? { url: `${origin}/blog` } : {}),
    blogPost: posts.slice(0, 20).map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      datePublished: p.published_at,
      ...(origin ? { url: `${origin}/blog/${p.slug}` } : {}),
    })),
  };

  return (
    <div className="b2b-container py-8">
      <PageMeta title={t("blog.title")} description={t("blog.metaDesc")} path="/blog" jsonLd={jsonLd} />
      <SectionHead eyebrow={t("blog.eyebrow")} title={t("blog.title")} lead={t("blog.lead")} />

      <div className="mt-6">
        {showLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : null}

        {!showLoading && error && posts.length === 0 ? (
          <p className="rounded-2xl border border-line bg-panel p-6 text-center text-sm text-ink-2">
            {t("errors.loadFailed")}
          </p>
        ) : null}

        {!showLoading && !error && posts.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel p-10 text-center">
            <Newspaper className="mx-auto h-8 w-8 text-ink-3" aria-hidden />
            <b className="mt-3 block text-base font-black text-ink">{t("blog.emptyTitle")}</b>
            <p className="mt-1 text-sm text-ink-2">{t("blog.emptyBody")}</p>
          </div>
        ) : null}

        {posts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function BlogPostPage() {
  const { t } = useI18n();
  const intl = useIntlTag();
  const { slug } = useParams();
  const ssr = useContext(SSRDataContext);
  const config = useSiteConfig();
  const seeded = ssr?.route === "blogPost" && ssr.post?.slug === slug ? ssr.post : null;
  const { data, loading, error } = useAsync(() => api.getPost(slug), [slug]);
  const post = data ?? seeded;

  if (!post && loading) {
    return (
      <div className="b2b-container max-w-3xl py-10">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  if (!post) {
    // 404 and a failed fetch look the same to a visitor: there is no article
    // here. (The server answers 404 for an unknown slug; see server.js.)
    return (
      <div className="b2b-container py-20 text-center">
        <title>{t("blog.notFoundTitle")}</title>
        <meta name="robots" content="noindex" />
        <h1 className="text-2xl font-black text-ink">{t("blog.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {error?.status && error.status !== 404 ? t("errors.loadFailed") : t("blog.notFoundBody")}
        </p>
        <PillButton as={Link} to="/blog" className="mt-5">
          {t("blog.backToBlog")}
        </PillButton>
      </div>
    );
  }

  const origin = resolveOrigin(ssr);
  const { path: barePath } = splitLocalePath(`/blog/${post.slug}`);
  const articleUrl = origin ? `${origin}${localePath("en", barePath)}` : undefined;
  const siteName = (config?.seo_site_name || "").trim() || "Ashkan Medical Idea";
  const description = post.seo_description || post.excerpt || undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.seo_title || post.title,
    ...(description ? { description } : {}),
    ...(post.cover_url ? { image: [post.cover_url] } : {}),
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    ...(post.tags?.length ? { keywords: post.tags.join(", ") } : {}),
    author: { "@type": "Organization", name: siteName },
    publisher: { "@type": "Organization", name: siteName },
    ...(articleUrl ? { mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl } } : {}),
  };

  return (
    <article className="b2b-container max-w-3xl py-8">
      <PageMeta
        title={post.seo_title || post.title}
        description={description}
        path={`/blog/${post.slug}`}
        image={post.cover_url || undefined}
        type="article"
        article={{ publishedTime: post.published_at, modifiedTime: post.updated_at, tags: post.tags }}
        jsonLd={jsonLd}
      />

      <Link
        to="/blog"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        {t("blog.backToBlog")}
      </Link>

      <header className="mt-4">
        {post.tags?.length ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <Chip key={tag} tone="brand">
                {tag}
              </Chip>
            ))}
          </div>
        ) : null}
        <h1 className="text-3xl leading-tight font-black tracking-tight text-ink sm:text-4xl">{post.title}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {post.published_at ? (
            <time dateTime={post.published_at}>{longDate(post.published_at, intl)}</time>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {t("blog.minRead", { count: post.reading_minutes || 1 })}
          </span>
        </p>
      </header>

      {post.cover_url ? (
        <img
          src={post.cover_url}
          alt=""
          className="mt-6 aspect-[16/9] w-full rounded-2xl object-cover"
          fetchPriority="high"
        />
      ) : null}

      <Markdown className="mt-8">{post.body}</Markdown>
    </article>
  );
}
