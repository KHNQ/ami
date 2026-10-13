import { cn } from "../../lib/cn.js";
import { deviceImage } from "../lib/deviceVisual.js";

// One device, shown as a still.
//
// Three sources behind one component (see deviceImage): the API photograph,
// a framed crop of the printed catalogue page, or the category icon. Call
// sites should not have to care which one they got.
//
// The photo is sized with max-height/max-width rather than height/width:
// `h-full` on an image inside a centring container resolves against a row
// whose height the image itself defines, so it does not constrain anything
// and a tall product shot pushes the panel to its natural size. The
// containing box owns the height; the image fits inside it.
export function DeviceVisual({ device, className, imgClassName, sizes }) {
  const visual = deviceImage(device);

  if (visual.kind === "photo") {
    return (
      <div className={cn("flex h-full w-full items-center justify-center overflow-hidden", className)}>
        <img
          src={visual.src}
          alt={visual.alt}
          loading="lazy"
          sizes={sizes}
          className={cn("max-h-full max-w-full object-contain", imgClassName)}
        />
      </div>
    );
  }

  if (visual.kind === "crop") {
    return (
      <div
        role="img"
        aria-label={visual.alt}
        style={visual.style}
        className={cn("h-full w-full", className)}
      />
    );
  }

  return (
    <div className={cn("grid h-full w-full place-items-center", className)}>
      <span aria-hidden className="text-6xl">
        {visual.icon}
      </span>
      <span className="sr-only">{visual.alt}</span>
    </div>
  );
}
