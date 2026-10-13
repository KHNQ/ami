// React 19 hoists <title>/<meta>/<link> found anywhere in the tree into
// the real document <head> automatically -- client-side AND during SSR
// (see server.js) -- no react-helmet-async or similar needed. Every page
// gets a real, distinct title instead of the site-wide default in
// index.html; these routes are all auth-gated (see public/robots.txt) so
// this is purely for browser tabs/bookmarks/history, not search indexing.
export function PageTitle({ title }) {
  return <title>{`${title} — Ashkan Medical Idea`}</title>;
}
