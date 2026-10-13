import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import DeviceStage from "../../three/DeviceStage.jsx";
import { showcaseFrame } from "./showcaseFrame.js";

// Lazily imported by ProductDetailPage so gsap + three stay out of the
// initial bundle and the server render (see HomeHeroMotion for the same
// pattern and the reason gsap.context is used instead of @gsap/react).
gsap.registerPlugin(ScrollTrigger);

// Scroll narrative for a single product.
//
// The page opens on the real product photograph. As you scroll into the
// description it dissolves, and the same device reassembles behind it from
// a fully exploded state -- photo becomes schematic, marketing becomes
// engineering. The model stays pinned for the whole read so the assembly
// tracks the description rather than scrolling away after two lines.
//
// Everything this module hides is hidden *here*, at runtime, never in the
// page markup: if this chunk never loads, the product photo and all the
// copy are simply there, fully visible.
export function ProductShowcaseMotion({ scopeRef, variant, accent, reducedMotion }) {
  const deviceRef = useRef(null);

  useEffect(() => {
    const device = deviceRef.current;
    const scope = scopeRef.current;
    if (!device || !scope) return undefined;

    const ctx = gsap.context(() => {
      device.setExplodeImmediate(1);

      const stage = scope.querySelector("[data-product-stage]");
      const aura = scope.querySelector("[data-product-aura]");
      const canvas = scope.querySelector(".device-stage");

      // One range drives both the pin and the choreography.
      //
      // This MUST be anchored to the stage at `top 84px`, not to the scope
      // at some fraction of the viewport: the scope's top is already ~100px
      // down the page on load, so a viewport-fraction start is already
      // behind us before the reader has scrolled a pixel, and ScrollTrigger
      // fires onUpdate on refresh -- so the page would open mid-animation.
      const PIN_START = "top 84px"; // clears the sticky TopBar
      if (stage) {
        ScrollTrigger.create({
          trigger: stage,
          start: PIN_START,
          endTrigger: scope,
          end: "bottom 78%",
          pin: true,
          pinSpacing: false,
          scrub: true,
        });
      }

      ScrollTrigger.create({
        trigger: stage || scope,
        start: PIN_START,
        endTrigger: scope,
        end: "bottom 78%",
        scrub: 0.5,
        onUpdate: (self) => {
          const f = showcaseFrame(self.progress);

          device.setExplodeImmediate(f.explode);
          // Slow orbit -- unless the reader has grabbed the device, in which
          // case DeviceStage's look() has already yielded and this is a no-op.
          device.look(f.lookX, f.lookY);

          if (aura) aura.style.opacity = String(f.auraOpacity);
          if (canvas) canvas.style.opacity = String(f.canvasOpacity);
        },
      });

      // Headline + price rise as the model locks together.
      gsap.from("[data-product-intro] > *", {
        opacity: 0,
        y: 20,
        duration: 0.7,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: { trigger: "[data-product-intro]", start: "top 92%" },
      });

      // Spec blocks rise in as they enter.
      const blocks = Array.from(scope.querySelectorAll("[data-spec]")).filter(
        (el) => el.getBoundingClientRect().top > window.innerHeight * 0.9
      );
      gsap.set(blocks, { opacity: 0, y: 22 });
      ScrollTrigger.batch(blocks, {
        start: "top 88%",
        onEnter: (els) =>
          gsap.to(els, { opacity: 1, y: 0, duration: 0.6, stagger: 0.07, ease: "power3.out", overwrite: true }),
      });
    }, scope);

    return () => ctx.revert();
  }, [scopeRef]);

  // z-[1] puts the canvas *under* the product photograph that dissolves
  // away over it -- see the stage layer stack in ProductDetailPage.
  return (
    <DeviceStage
      ref={deviceRef}
      reducedMotion={reducedMotion}
      variant={variant}
      accent={accent}
      autoSpin={false}
      initialExplode={1}
      interactive
      onInteract={() => {
        // First touch retires the affordance hint -- it has done its job,
        // and leaving it on top of a device you're already turning is noise.
        const hint = scopeRef.current?.querySelector("[data-stage-hint]");
        if (hint) gsap.to(hint, { opacity: 0, duration: 0.4, ease: "power2.out" });
      }}
      className="relative z-[1] h-full w-full"
    />
  );
}

export default ProductShowcaseMotion;
