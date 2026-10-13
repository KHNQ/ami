// Turning a file the visitor picked into something worth sending.
//
// Two jobs: check it here so the refusal is immediate rather than a round
// trip, and shrink images before they leave the machine. The server checks
// everything again -- this is the courtesy, not the guarantee.

export const MAX_ATTACHMENT_BYTES = 5_000_000;
export const MAX_ATTACHMENTS = 4;

export const ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/** What the file picker offers, so the visitor is not shown files we refuse. */
export const ACCEPT_ATTR = `${ACCEPTED.join(",")},.xlsx,.csv`;

// What vision models downscale to internally anyway. Sending a 4000px phone
// photograph costs the visitor's upload bandwidth and our token budget and
// then gets resized to about this before anyone looks at it.
const LONG_EDGE = 1568;
const JPEG_QUALITY = 0.85;

const isImage = (type) => type.startsWith("image/");

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * A smaller JPEG, or the original if shrinking would not help.
 *
 * Everything here can be absent -- a canvas that refuses to decode the image,
 * an environment with no `createImageBitmap`, a GIF whose animation would be
 * destroyed by this. Every one of those falls back to the original bytes,
 * because the point is to save transfer, not to be the reason a file cannot
 * be sent at all.
 */
export async function downscaleImage(file) {
  if (!isImage(file.type) || file.type === "image/gif") return null;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough and already a reasonable format: leave it alone.
    if (scale === 1 && file.size <= 1_000_000) {
      bitmap.close?.();
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // A photographed invoice is usually shot on white; without this a PNG
    // with transparency comes out on a black background and is unreadable.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) return null;
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Validates and prepares one file.
 *
 * Returns `{ ok: true, dataUrl, filename, kind, previewUrl }` or
 * `{ ok: false, error }` -- never throws, because this runs in a loop over a
 * drop of several files and one bad one must not lose the others.
 */
export async function prepareAttachment(file, t) {
  const type = file.type || "";
  if (!ACCEPTED.includes(type)) {
    return { ok: false, error: t("ai.attachUnsupported") };
  }

  const shrunk = await downscaleImage(file);
  const dataUrl = shrunk || (await readAsDataUrl(file).catch(() => null));
  if (!dataUrl) return { ok: false, error: t("ai.attachUnreadable") };

  // Measured AFTER shrinking, which is the whole reason a 9MB phone photo is
  // usually still sendable.
  const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: t("ai.attachTooLarge", { mb: Math.round(MAX_ATTACHMENT_BYTES / 1e6) }) };
  }

  return {
    ok: true,
    dataUrl,
    filename: file.name || "file",
    kind: isImage(type) ? "image" : "document",
    // The local copy, so the thumbnail renders instantly instead of waiting
    // for the upload it is a preview of.
    previewUrl: isImage(type) ? dataUrl : null,
    bytes,
  };
}
