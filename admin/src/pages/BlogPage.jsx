import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bold, Code, Eye, EyeOff, FileText, Heading2, Italic, Link2, List, Plus, Quote, Save, Trash2,
} from "lucide-react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { Card } from "@shared/components/ui/Card.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { EmptyState } from "@shared/components/ui/EmptyState.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { StatusBadge } from "@shared/components/ui/Badge.jsx";
import { Markdown } from "@shared/components/ui/Markdown.jsx";
import { parseFrontmatter, setFrontmatterKey, stringifyFrontmatter } from "@shared/lib/frontmatter.js";
import { relativeTime } from "@shared/lib/format.js";
import { adminApi as api } from "../lib/adminApi.js";

// Blog authoring, in Markdown.
//
// A post is ONE document: a front-matter block of metadata, then the article.
//
//   ---
//   title: How diode lasers changed hair removal
//   slug: diode-lasers
//   excerpt: One line shown on the blog index.
//   description: What search engines show under the title.
//   tags: [lasers, news]
//   cover: https://example.com/cover.jpg
//   status: published
//   ---
//   ## The article starts here
//
// The server reads the metadata block and stores it in the post's fields, so
// the document you edit and the page that is published cannot disagree. The
// preview on the right is the public renderer itself (the same component the
// site uses), which also means it is subject to the same sanitising: raw HTML
// in a post is shown as nothing, not as markup.

const TEMPLATE = `---
title: Your title here
slug:
excerpt: One line shown on the blog index.
description: What search engines show under the title (about 155 characters).
tags: [news]
cover:
status: draft
---

## A heading

Write in **Markdown**. Lists, [links](https://example.com), quotes, tables and code all work.
`;

function docFromPost(post) {
  return stringifyFrontmatter(
    {
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      description: post.seo_description,
      seo_title: post.seo_title,
      tags: post.tags,
      cover: post.cover_url,
      status: post.status,
    },
    post.body || ""
  );
}

function Toolbar({ taRef, doc, setDoc }) {
  // Wraps or prefixes the current selection, then puts the caret back where an
  // author would expect it. Operates on the textarea so undo (Cmd/Ctrl+Z) keeps
  // working as far as the browser allows.
  function edit(fn) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b } = ta;
    const { text, from, to } = fn(doc, a, b);
    setDoc(text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(from, to);
    });
  }
  const wrap = (left, right = left, hint = "text") => (d, a, b) => {
    const sel = d.slice(a, b) || hint;
    return { text: d.slice(0, a) + left + sel + right + d.slice(b), from: a + left.length, to: a + left.length + sel.length };
  };
  const prefix = (mark, hint = "text") => (d, a, b) => {
    const start = d.lastIndexOf("\n", a - 1) + 1;
    const sel = d.slice(start, b) || hint;
    const lines = sel.split("\n").map((l) => mark + l).join("\n");
    return { text: d.slice(0, start) + lines + d.slice(b), from: start + mark.length, to: start + lines.length };
  };
  const link = (d, a, b) => {
    const sel = d.slice(a, b) || "link text";
    const out = `[${sel}](https://)`;
    return { text: d.slice(0, a) + out + d.slice(b), from: a + sel.length + 3, to: a + sel.length + 11 };
  };
  const buttons = [
    ["Bold", Bold, wrap("**")],
    ["Italic", Italic, wrap("*")],
    ["Heading", Heading2, prefix("## ", "Heading")],
    ["Link", Link2, link],
    ["List", List, prefix("- ", "item")],
    ["Quote", Quote, prefix("> ", "quote")],
    ["Code", Code, wrap("`", "`", "code")],
  ];
  return (
    <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formatting">
      {buttons.map(([label, Icon, fn]) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => edit(fn)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg/55 hover:bg-surface/10 hover:text-fg"
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

function Editor({ post, onClose, onSaved }) {
  const toast = useToast();
  const taRef = useRef(null);
  const [doc, setDoc] = useState(() => (post ? docFromPost(post) : TEMPLATE));
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const { data: meta, body } = useMemo(() => parseFrontmatter(doc), [doc]);
  const status = String(meta.status || "draft").toLowerCase() === "published" ? "published" : "draft";
  const titleMissing = !String(meta.title || "").trim();

  async function save(nextStatus) {
    const text = nextStatus ? setFrontmatterKey(doc, "status", nextStatus) : doc;
    if (!String(parseFrontmatter(text).data.title || "").trim()) {
      toast.error("Add a title: line to the front matter first");
      return;
    }
    setBusy(true);
    try {
      const saved = post ? await api.updatePost(post.id, { body: text }) : await api.createPost({ body: text });
      toast.success(nextStatus === "published" ? "Published" : nextStatus === "draft" ? "Saved as draft" : "Saved");
      // Reload what the server actually stored (it may have made the slug
      // unique, for one) so the editor never shows a slug that is not real.
      setDoc(docFromPost(saved));
      await onSaved(saved);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!post || !window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    try {
      await api.deletePost(post.id);
      toast.success("Post deleted");
      await onSaved(null);
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader
        title={post ? "Edit post" : "New post"}
        description={post ? `/blog/${post.slug}` : "Metadata first, then the article."}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={onClose}>
              <ArrowLeft size={14} className="rtl:rotate-180" /> Posts
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowPreview((v) => !v)} aria-pressed={showPreview}>
              {showPreview ? <EyeOff size={14} /> : <Eye size={14} />} Preview
            </Button>
          </>
        }
      />
      <PageBody>
        <div className={`grid gap-4 ${showPreview ? "xl:grid-cols-2" : ""}`}>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Toolbar taRef={taRef} doc={doc} setDoc={setDoc} />
              <StatusBadge status={status} />
            </div>
            <textarea
              ref={taRef}
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              spellCheck
              aria-label="Post document"
              dir="auto"
              className="min-h-[60vh] w-full resize-y rounded-xl border border-surface/12 bg-surface/5 p-3.5 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg/30 focus:border-brand-green/40"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" loading={busy} onClick={() => save()} disabled={titleMissing}>
                <Save size={14} /> Save
              </Button>
              {status === "published" ? (
                <Button size="sm" variant="secondary" disabled={busy || titleMissing} onClick={() => save("draft")}>
                  <EyeOff size={14} /> Unpublish
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy || titleMissing} onClick={() => save("published")}>
                  <Eye size={14} /> Publish
                </Button>
              )}
              <span className="flex-1" />
              {post && (
                <Button size="sm" variant="danger" onClick={remove}>
                  <Trash2 size={14} /> Delete
                </Button>
              )}
            </div>
            {titleMissing && (
              <p className="text-[12px] text-amber-400/90">The front matter needs a <code>title:</code> line.</p>
            )}
          </div>

          {showPreview && (
            <Card className="min-w-0 p-5">
              <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg/35">
                Preview — as published
              </div>
              {meta.title ? <h1 className="mb-4 text-[26px] font-black leading-tight text-fg">{meta.title}</h1> : null}
              {meta.cover ? (
                <img src={meta.cover} alt="" className="mb-4 aspect-[16/9] w-full rounded-xl object-cover" />
              ) : null}
              <Markdown>{body}</Markdown>
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}

export default function BlogPage() {
  const { data, loading, error, refetch } = useAsync(() => api.listPosts({ limit: 100 }), []);
  const [editing, setEditing] = useState(null); // null | "new" | post

  const posts = data?.posts || [];

  if (editing) {
    return (
      <>
        <PageTitle title="Admin · Blog" />
        <Editor
          key={editing === "new" ? "new" : editing.id}
          post={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            await refetch();
            if (saved) setEditing(saved);
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageTitle title="Admin · Blog" />
      <PageHeader
        title="Blog"
        description="Markdown posts published at /blog."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> New post
          </Button>
        }
      />
      <PageBody>
        {loading && !data && (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && posts.length === 0 && (
          <EmptyState icon={<FileText />} title="No posts yet" description="Write one in Markdown and publish it to /blog." />
        )}
        <div className="flex flex-col gap-2.5">
          {posts.map((p) => (
            <Card key={p.id} className="p-4">
              <button type="button" onClick={() => setEditing(p)} className="flex w-full items-start justify-between gap-3 text-start">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold text-fg">{p.title}</span>
                  {p.excerpt && <span className="block truncate text-[12px] text-fg/45">{p.excerpt}</span>}
                  <span className="mt-0.5 block text-[11px] text-fg/35">
                    /blog/{p.slug} · {p.reading_minutes} min · {p.published_at ? `published ${relativeTime(p.published_at)}` : "draft"}
                  </span>
                </span>
                <StatusBadge status={p.status} />
              </button>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
