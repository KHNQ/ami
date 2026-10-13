import { Link } from "react-router-dom";
import { ExternalLink, Newspaper } from "lucide-react";
import { InstagramIcon } from "../components/ui/BrandIcons.jsx";
import { api } from "../lib/api.js";
import { useAsync } from "../hooks/useAsync.js";
import { ORG_NAME, ORG_SOCIAL } from "../lib/orgInfo.js";
import { PageTransition } from "../components/layout/PageTransition.jsx";
import { SiteFooter } from "../components/layout/SiteFooter.jsx";
import { Reveal } from "../components/ui/Reveal.jsx";
import { KineticHeadline } from "../components/ui/KineticHeadline.jsx";
import { TiltCard } from "../components/ui/TiltCard.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { useFeature } from "../context/SiteConfigContext.jsx";
import { useT } from "../i18n/I18nProvider.jsx";
import { fullDate } from "../lib/format.js";

// The company's public feed: Instagram posts alongside blog articles written
// in the admin console.
//
// The Instagram half degrades honestly. There is no key-free way to read a
// profile (see services/socialService.js), so with no access token configured
// this renders a link to the real profile rather than fabricating a grid of
// plausible-looking posts -- a fake feed is worse than an absent one, because
// nobody can tell it is fake.

function PostCard({ post }) {
  return (
    <TiltCard className="h-full rounded-2xl">
      <Link
        to={`/blog/${post.slug}`}
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-surface/10 bg-surface/[0.03]"
      >
        {post.cover_url && (
          <div className="aspect-[16/9] w-full overflow-hidden bg-surface/5">
            <img src={post.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="flex flex-1 flex-col p-4">
          {post.tags?.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {post.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-brand-green/25 bg-brand-green/8 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-green"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h3 className="text-[16px] font-extrabold leading-snug text-fg">{post.title}</h3>
          {post.excerpt && <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-fg/55">{post.excerpt}</p>}
          {post.published_at && (
            <p className="mt-auto pt-3 text-[11.5px] text-fg/35">{fullDate(post.published_at)}</p>
          )}
        </div>
      </Link>
    </TiltCard>
  );
}

export default function SocialsPage() {
  const t = useT();
  const enabled = useFeature("blog_enabled");
  const { data: postData, loading: postsLoading } = useAsync(() => api.listPosts({ limit: 24 }), []);
  const { data: feed, loading: feedLoading } = useAsync(() => api.instagramFeed(), []);

  const posts = postData?.posts || [];
  const igPosts = feed?.posts || [];
  const profileUrl = feed?.profile_url || ORG_SOCIAL?.instagram;

  const title = `${t("socials.metaTitle", { org: ORG_NAME })}`;

  return (
    <PageTransition className="flex min-h-dvh flex-col">
      <title>{title}</title>
      <meta name="description" content={t("socials.metaDescription", { org: ORG_NAME })} />
      <link rel="canonical" href="/socials" />
      <meta property="og:title" content={title} />
      <meta property="og:type" content="website" />

      <div className="flex-1">
        <section className="relative px-5 pb-4 pt-10">
          <div className="aurora pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <Link to="/" className="mb-4 inline-block text-[12.5px] font-semibold text-fg/40 hover:text-fg/70">
              ← {t("common.back")}
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-green">{t("socials.eyebrow")}</p>
            <KineticHeadline
              as="h1"
              text={t("socials.heading")}
              className="mt-1.5 max-w-lg text-[clamp(30px,3.4vw,46px)] font-extrabold leading-[1.15] lg:max-w-3xl tracking-tight text-fg"
            />
          </div>
        </section>

        {/* --- Instagram --- */}
        <section className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[17px] font-extrabold text-fg">
              <InstagramIcon width={17} height={17} className="text-brand-green" /> {t("socials.instagram")}
            </h2>
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-blue"
              >
                {t("socials.viewProfile")} <ExternalLink size={12} />
              </a>
            )}
          </div>

          {feedLoading && (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="aspect-square w-full" />
              ))}
            </div>
          )}

          {!feedLoading && igPosts.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {igPosts.map((p, i) => (
                <Reveal key={p.id} delay={(i % 3) * 60}>
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group block aspect-square overflow-hidden rounded-xl bg-surface/5"
                  >
                    <img
                      src={p.image}
                      alt={p.caption?.slice(0, 80) || ""}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </a>
                </Reveal>
              ))}
            </div>
          )}

          {!feedLoading && igPosts.length === 0 && (
            <div className="rounded-2xl border border-surface/10 bg-surface/[0.03] p-5 text-center">
              <p className="text-[13.5px] text-fg/55">{t("socials.feedUnavailable")}</p>
              {profileUrl && (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-brand-green to-brand-blue px-4 py-2 text-[13px] font-bold text-white"
                >
                  <InstagramIcon width={14} height={14} /> {t("socials.viewProfile")}
                </a>
              )}
            </div>
          )}
        </section>

        {/* --- Blog --- */}
        {enabled && (
          <section className="px-5 pb-10 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-[17px] font-extrabold text-fg">
                <Newspaper size={17} className="text-brand-green" /> {t("socials.fromUs")}
              </h2>
              <Link to="/blog" className="text-[13px] font-semibold text-brand-blue">
                {t("blog.allPosts")} →
              </Link>
            </div>

            {postsLoading && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            )}

            {!postsLoading && posts.length === 0 && (
              <EmptyState title={t("socials.noPosts")} description={t("socials.noPostsBody")} />
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {posts.map((p, i) => (
                <Reveal key={p.id} delay={(i % 2) * 80}>
                  <PostCard post={p} />
                </Reveal>
              ))}
            </div>
          </section>
        )}
      </div>

      <SiteFooter />
    </PageTransition>
  );
}
