import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, Home, Search } from "lucide-react";
import { PageTitle } from "../components/layout/PageTitle.jsx";
import { PillButton } from "../b2b/ui/primitives.jsx";
import { useT } from "../i18n/I18nProvider.jsx";

// three.js is ~550KB and this is the one page nobody meant to open, so the
// scene is behind a lazy boundary. Everything below it is real, readable
// markup that stands on its own if the chunk never arrives.
const NotFoundScene = lazy(() =>
  import("../b2b/sections/NotFoundScene.jsx").then((m) => ({ default: m.NotFoundScene }))
);

// Where someone who hit a dead end most plausibly wanted to go. A 404 that
// only offers "back home" makes the visitor start their search over.
const DESTINATIONS = [
  { to: "/devices", labelKey: "store.cat.all", noteKey: "notFound.devicesNote" },
  { to: "/catalog", labelKey: "store.section.catalog.label", noteKey: "notFound.catalogNote" },
  {
    to: "/installations",
    labelKey: "store.section.installations.label",
    noteKey: "notFound.installedNote",
  },
  { to: "/blog", labelKey: "store.section.blog.label", noteKey: "notFound.blogNote" },
];

export default function NotFoundPage() {
  const t = useT();
  // The scene draws the "404" itself. Until it does -- and permanently for
  // anyone with reduced motion, no WebGL, or a failed chunk -- the
  // typographic one stands in. Showing both at once was the first version,
  // and the two read as one muddy overlapping mess.
  const [sceneUp, setSceneUp] = useState(false);

  return (
    <div className="b2b relative flex min-h-dvh flex-1 flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
      <PageTitle title={t("notFound.pageTitle")} />

      {/* The scene IS the 404 -- it spells the digits in instanced cubes.
          It gets its own band above the copy rather than sitting behind it. */}
      <div className="relative mx-auto grid h-[220px] w-full max-w-4xl place-items-center overflow-hidden sm:h-[300px]">
        <Suspense fallback={null}>
          <NotFoundScene className="absolute inset-0" onReady={() => setSceneUp(true)} />
        </Suspense>
        {!sceneUp ? (
          <span className="text-gradient absolute inset-0 flex items-center justify-center text-[88px] leading-none font-black tracking-tight sm:text-[120px]">
            404
          </span>
        ) : null}
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <h1 className="mt-4 text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {t("notFound.heading")}
        </h1>
        <p className="mt-2 max-w-md text-sm text-ink-2">{t("notFound.body")}</p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <PillButton as={Link} to="/" size="lg">
            <Home className="h-4 w-4" />
            {t("notFound.backToStore")}
          </PillButton>
          <PillButton as={Link} to="/devices" variant="white" size="lg">
            <Search className="h-4 w-4" />
            {t("notFound.searchRange")}
          </PillButton>
        </div>

        <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
          {DESTINATIONS.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="group flex items-center gap-3 rounded-2xl border border-line bg-panel/80 px-4 py-3 text-start backdrop-blur transition-colors hover:border-brand-green/40"
            >
              <Compass className="h-4 w-4 shrink-0 text-brand-green" />
              <span className="min-w-0">
                <b className="block text-[13px] font-black text-ink">{t(d.labelKey)}</b>
                <span className="block truncate text-[11px] text-ink-2">{t(d.noteKey)}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
