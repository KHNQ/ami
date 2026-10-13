import { PARTNERS } from "../../lib/siteContent.generated.js";
import { cn } from "../../lib/cn.js";

// A continuously scrolling strip of partner logos.
//
// Pure CSS: the track is the logo list rendered twice back-to-back, animated
// with a single `translateX(-50%)` keyframe (index.css). Because the two
// halves are identical, the moment the first copy has scrolled fully out of
// view the second sits exactly where the first started, so the loop has no
// seam and no reset-jump -- and no per-frame JS or canvas work, so there is
// nothing here that can be "laggy". `prefers-reduced-motion` freezes every
// animation globally (index.css), so that visitor gets a still strip instead.
//
// Sized to actually be read: these are the manufacturers whose names carry
// the credibility of the whole page, so the plate is large enough for the
// mark to resolve and the company name is set beside it rather than being
// hidden in a tooltip nobody hovers on a phone.
export function PartnerLogoSlider({ className, speedSeconds = 42 }) {
  const track = [...PARTNERS, ...PARTNERS];

  return (
    <div
      className={cn(
        "group overflow-hidden",
        "[mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]",
        className
      )}
    >
      <div
        className="flex w-max items-stretch gap-4 group-hover:[animation-play-state:paused]"
        style={{ animation: `marquee ${speedSeconds}s linear infinite` }}
        aria-hidden
      >
        {track.map((p, i) => (
          <div
            key={`${p.slug}-${i}`}
            className="flex shrink-0 items-center gap-3.5 rounded-2xl border border-surface/10 bg-surface/[0.04] p-3 pe-5 transition-colors hover:border-brand-green/30"
          >
            {/* White plate: most of these marks are dark, supplied for a
                light background, and would vanish in dark mode. */}
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-sm">
              <img
                src={p.logo}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <p className="whitespace-nowrap text-[15px] font-extrabold leading-tight text-fg">{p.name}</p>
              <p className="whitespace-nowrap text-[12.5px] font-semibold text-brand-green">{p.country}</p>
            </div>
          </div>
        ))}
      </div>
      {/* The accessible list: screen readers get the real partner names once,
          not a decorative doubled strip with no semantic meaning. */}
      <span className="sr-only">{PARTNERS.map((p) => p.name).join(", ")}</span>
    </div>
  );
}
