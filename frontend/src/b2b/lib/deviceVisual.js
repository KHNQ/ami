import { useSiteConfig } from "../../context/SiteConfigContext.jsx";
import { deviceShotStyle } from "../data/devices.js";

// Whether a device is shown as a 3D model or as a photograph.
//
// The default is the photograph. A procedural 3D model is an approximation
// of the machine -- convincing as a piece of motion on the home page, but on
// a product page, next to a specification a buyer is about to spend €40,000
// against, an approximation is the wrong thing to show. The real photograph
// is what the manufacturer published and what arrives in the crate.
//
// `product_3d_enabled` turns it back on. It is read directly rather than
// through useFeature because that helper treats an absent key as ON
// (`x !== false`), and an unset flag here has to mean OFF -- otherwise
// every environment that has not added the setting gets the 3D viewer back.
export function useProduct3dEnabled() {
  const config = useSiteConfig();
  return config?.product_3d_enabled === true;
}

/**
 * The best available still image for a device, in preference order.
 *
 * 1. The product photograph from the API, which an admin can replace.
 * 2. The machine as printed in the 2024 catalogue -- always available, and
 *    provably the same device.
 * 3. Nothing, and the caller falls back to the category icon.
 *
 * Returns a descriptor rather than a URL because the two sources render
 * differently: one is an <img>, the other a framed region of a page.
 */
export function deviceImage(device) {
  if (device?.productImageUrl) {
    return { kind: "photo", src: device.productImageUrl, alt: device.name };
  }
  const style = deviceShotStyle(device);
  if (style) {
    return {
      kind: "crop",
      style,
      alt: `${device.name} — from the Ashkan 2024 catalogue`,
    };
  }
  return { kind: "icon", icon: device?.icon || "•", alt: device?.name || "" };
}
