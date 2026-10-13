import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { cn } from "../../lib/cn.js";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/shadcn/carousel.jsx";
import { Button } from "@/components/shadcn/button.jsx";
import { KineticHeadline } from "../../components/ui/KineticHeadline.jsx";
import { LazyDeviceStage } from "../../three/LazyDeviceStage.jsx";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import { PillButton, Chip, CertMarks } from "../ui/primitives.jsx";
import { useStorefront } from "../context/StorefrontContext.jsx";
import { DeviceVisual } from "./DeviceVisual.jsx";
import { useCatalogue } from "../context/CatalogContext.jsx";
import { HeroDitheringBackdrop } from "../../components/cult/hero-dithering-backdrop.jsx";
import { useT } from "../../i18n/I18nProvider.jsx";

// The hero.
//
// Structurally this is the three-slide spread the brief asked for. What
// fills the right-hand half is the app's own procedural 3D stage rather
// than a stock photograph: each slide's device is modelled from the
// manufacturer's component decomposition, and it *reassembles itself* as
// the slide arrives -- exploded to whole over roughly a second. That is the
// deconstruct/reconstruct idea from the previous hero, kept and given a
// reason to exist here, because a machine assembling itself is a far better
// argument for "we know this hardware to the component" than a photo is.
//
// Everything degrades: no WebGL, or a reduced-motion preference, and the
// fallback is a framed crop of the device straight out of the printed
// catalogue. The copy is real DOM either way, so the hero is readable
// server-side and by a crawler.

// Each slide keeps its identity, its artwork and its links here; the words
// live in the catalogs under `store.hero.<key>`. A hero headline is the first
// sentence a visitor reads, so it is also the first one that has to be in
// their language.
const SLIDES = [
  {
    deviceId: "primelase",
    key: "primelase",
    eyebrowTone: "teal",
    gradientFrom: 4,
    // No 3D on this slide -- see SlideStage. The catalogue photograph is
    // the real machine; the model was an approximation of it.
    variant: null,
    ctas: [
      { key: "see", to: "/devices/primelase" },
      { key: "lock", action: "rfq", ghost: true },
    ],
  },
  {
    deviceId: "cooltech",
    key: "cooltech",
    eyebrowTone: "blue",
    gradientFrom: 3,
    variant: null,
    ctas: [
      { key: "see", to: "/devices/cooltech" },
      { key: "clinics", to: "/installations", ghost: true },
    ],
  },
  {
    // The InBody slide is deliberately the one that closes the loop: it is
    // the device the previous hero was built around, and the analyzer
    // archetype is the cleanest assembly in the catalogue to watch.
    deviceId: "inbody",
    key: "inbody",
    eyebrowTone: "brand",
    gradientFrom: 3,
    // The one model that stays. The analyzer is the cleanest assembly in
    // the catalogue to watch put itself together, and this slide is where
    // that motion earns its keep -- it is an argument about how well we
    // know the hardware, not a substitute for a product photo.
    variant: "analyzer",
    accent: 0x22c55e,
    ctas: [
      { key: "see", to: "/devices/inbody" },
      { key: "match", to: "/tools#matcher", ghost: true },
    ],
  },
];

const INTERVAL = 7000;

function SlideStage({ slide, active, device }) {
  // A slide without a `variant` is a photograph, full stop -- no WebGL
  // probe, no lazy chunk, nothing to reassemble.
  if (!slide.variant) {
    return (
      <div className="absolute inset-0 p-6">
        <DeviceVisual device={device} />
      </div>
    );
  }
  return <SlideModel slide={slide} active={active} device={device} />;
}

function SlideModel({ slide, active, device }) {
  const stageRef = useRef(null);
  const reduced = useReducedMotion();
  // The stage is behind two async boundaries -- a WebGL probe in an effect
  // and a lazy chunk -- so on the first render the ref is still null. The
  // animation below is therefore keyed off the stage's own ready callback
  // rather than off mount; keyed off mount it silently never ran, and the
  // device sat permanently exploded.
  const [ready, setReady] = useState(false);

  // Reassemble on arrival. Driven from a rAF loop rather than a CSS
  // transition because "explode" is a uniform inside the 3D scene, not a
  // style -- and driving it per frame is what makes the parts visibly fly
  // back together instead of snapping.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready || !active || reduced) return undefined;

    let raf = 0;
    const start = performance.now();
    const DURATION = 1400;

    stage.setExplodeImmediate?.(1);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / DURATION);
      // easeOutCubic: fast convergence then a settle, which reads as parts
      // being drawn home rather than as a linear slide.
      const eased = 1 - Math.pow(1 - t, 3);
      stage.setExplodeImmediate?.(1 - eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, ready, reduced, slide.deviceId]);

  // A new slide mounts a new stage; clear the flag so the next one runs its
  // own assembly rather than inheriting the previous slide's.
  useEffect(() => setReady(false), [slide.deviceId]);

  return (
    <div className="relative h-full w-full">
      <LazyDeviceStage
        ref={stageRef}
        variant={slide.variant}
        accent={slide.accent}
        autoSpin
        interactive
        initialExplode={reduced ? 0 : 1}
        onReady={() => setReady(true)}
        className="device-stage h-full w-full"
        fallback={<DeviceVisual device={device} className="p-4" />}
      />
    </div>
  );
}

export function HeroSlider() {
  const t = useT();
  const { openRfq } = useStorefront();
  const { getDevice } = useCatalogue();
  const reduced = useReducedMotion();
  // Embla's own API object, handed back by shadcn's Carousel. Everything
  // this component needs to know about position -- and every way it moves
  // the carousel -- goes through it, so the DOM and React can never
  // disagree about which slide is showing.
  const [api, setApi] = useState(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!api) return undefined;
    const sync = () => setIndex(api.selectedScrollSnap());
    sync();
    api.on("select", sync);
    return () => api.off("select", sync);
  }, [api]);

  // Autoplay pauses on hover and on focus within. A carousel that keeps
  // advancing while someone is reading the slide they stopped on is the
  // reason carousels have the reputation they do. Reduced motion turns it
  // off entirely.
  //
  // Deliberately not the Embla autoplay plugin: this needs to pause on
  // focus (not just hover) for keyboard users, and the plugin's own
  // stop/play lifecycle is more moving parts than one timeout.
  useEffect(() => {
    if (!api || paused || reduced) return undefined;
    const t = setTimeout(() => api.scrollNext(), INTERVAL);
    return () => clearTimeout(t);
  }, [api, paused, reduced, index]);

  return (
    <section className="b2b-container pt-5">
      <Carousel
        setApi={setApi}
        opts={{ loop: true }}
        className="b2b-deep relative overflow-hidden rounded-[28px]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        aria-label={t("store.hero.featured")}
      >
        {/* cult-ui's dithering shader, behind the deep panel's own glow.
            Masked to the left half so it sits under the copy and never
            behind the white product panel, where a swirling texture would
            fight the device photograph. */}
        <HeroDitheringBackdrop
          className="[mask-image:linear-gradient(to_right,black,black_38%,transparent_62%)]"
          colorFront="#22c55e"
          opacity={0.4}
        />

        <div aria-hidden className="b2b-glow top-[-10%] start-[8%] h-[420px] w-[420px] opacity-70" />

        {/* -ml-0 / pl-0: shadcn's carousel spaces items with a negative
            margin and per-item padding, which is right for a multi-card
            track and wrong for full-bleed slides -- it would show a sliver
            of the next slide down the edge of every one. */}
        <CarouselContent className="ms-0">
          {SLIDES.map((slide, i) => {
            const device = getDevice(slide.deviceId);
            const active = i === index;
            const headline = t(`store.hero.${slide.key}.headline`);
            return (
              <CarouselItem key={slide.deviceId} className="ps-0">
                <div className="relative grid items-stretch lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="flex flex-col justify-center gap-4 px-6 py-10 sm:px-9 sm:py-12 lg:py-16">
                    <Chip tone="onDeep" className="w-fit">
                      {t(`store.hero.${slide.key}.eyebrow`)}
                    </Chip>

                    {/* Re-keyed on the active slide so the word-by-word
                        entrance replays on each change rather than only on
                        first mount. */}
                    <KineticHeadline
                      key={`${headline}-${active}`}
                      as="h1"
                      text={headline}
                      gradientFrom={slide.gradientFrom}
                      className="max-w-xl text-[34px] leading-[1.02] font-black tracking-tight text-white sm:text-[44px] lg:text-[52px]"
                    />

                    <p className="max-w-xl text-[15px] leading-relaxed text-white/70">
                      {t(`store.hero.${slide.key}.lead`)}
                    </p>

                    <div className="flex flex-wrap gap-2.5 pt-1">
                      {slide.ctas.map((cta) =>
                        cta.action === "rfq" ? (
                          <PillButton
                            key={cta.key}
                            variant={cta.ghost ? "ghost" : "primary"}
                            size="lg"
                            onClick={() => openRfq(slide.deviceId)}
                          >
                            {t(`store.hero.${slide.key}.cta.${cta.key}`)}
                          </PillButton>
                        ) : (
                          <PillButton
                            key={cta.key}
                            as={Link}
                            to={cta.to}
                            variant={cta.ghost ? "ghost" : "primary"}
                            size="lg"
                          >
                            {t(`store.hero.${slide.key}.cta.${cta.key}`)}
                          </PillButton>
                        )
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <CertMarks device={device} />
                      <span className="text-[11px] font-bold text-white/45">
                        {device.flag} {device.country} · {device.brand}
                      </span>
                    </div>
                  </div>

                  {/* White, not the dark wash. Every product shot in the catalogue is
                      photographed on white, so a dark panel put a grey halo
                      around each machine; on white they read as cut out. */}
                  <div className="relative min-h-[280px] bg-white p-4 sm:min-h-[340px] lg:min-h-[480px]">
                    {/* Only the visible slide gets a 3D stage. Mounting all
                        three would run three WebGL contexts at once for two
                        slides nobody is looking at. */}
                    {active ? <SlideStage slide={slide} device={device} active /> : null}
                    {slide.variant ? (
                      <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[10px] font-extrabold tracking-[0.14em] text-ink-3 uppercase">
                        {t("store.device.dragHint")}
                      </span>
                    ) : null}
                  </div>
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>

        {/* Dots carry the device name as their label, so the control set is
            meaningful without sight of the slide. */}
        <div className="absolute bottom-4 start-6 z-10 flex items-center gap-2 sm:start-9">
          {SLIDES.map((s, i) => (
            <button
              key={s.deviceId}
              type="button"
              onClick={() => api?.scrollTo(i)}
              aria-label={`Show ${getDevice(s.deviceId).name}`}
              aria-current={i === index}
              className={cn(
                "h-1.5 cursor-pointer rounded-full transition-all",
                i === index ? "w-9 bg-white" : "w-6 bg-white/30 hover:bg-white/60"
              )}
            />
          ))}
          {!reduced ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? t("store.hero.resume") : t("store.hero.pause")}
              className="ms-2 h-7 w-7 rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </Button>
          ) : null}
        </div>

        {/* shadcn's own prev/next, restyled onto the dark panel. They bring
            the arrow-key handling and disabled-at-the-ends logic with them. */}
        <CarouselPrevious className="start-auto end-4 top-[calc(50%-1.5rem)] hidden h-10 w-10 border-white/20 bg-white/12 text-white backdrop-blur hover:bg-white hover:text-ink sm:flex" />
        <CarouselNext className="end-4 top-[calc(50%+1.5rem)] hidden h-10 w-10 border-white/20 bg-white/12 text-white backdrop-blur hover:bg-white hover:text-ink sm:flex" />
      </Carousel>
    </section>
  );
}
