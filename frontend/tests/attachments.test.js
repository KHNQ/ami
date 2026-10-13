import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ACCEPTED,
  ACCEPT_ATTR,
  MAX_ATTACHMENT_BYTES,
  prepareAttachment,
  downscaleImage,
} from "../src/lib/attachments.js";

// The browser half of file upload.
//
// This runs before anything is sent, so its job is to refuse the obvious
// cases immediately -- a refusal that costs a round trip feels like a bug --
// and to shrink a phone photograph so the visitor is not uploading eight
// megabytes over a clinic's connection.

const t = (key, vars) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

/** A File-alike; jsdom has FileReader but a real File is easier to build here. */
function fileOf(name, type, bytes) {
  return new File([new Uint8Array(bytes)], name, { type });
}

afterEach(() => vi.restoreAllMocks());

describe("what may be sent", () => {
  it("accepts the formats the model can actually read", async () => {
    const res = await prepareAttachment(fileOf("photo.jpg", "image/jpeg", [0xff, 0xd8, 0xff]), t);
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("image");
    expect(res.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("classifies a PDF as a document, not an image", async () => {
    const res = await prepareAttachment(fileOf("quote.pdf", "application/pdf", [0x25, 0x50, 0x44, 0x46]), t);
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("document");
    // No thumbnail: there is nothing to show until the server reads it.
    expect(res.previewUrl).toBe(null);
  });

  it("refuses a type the assistant cannot use, by name", async () => {
    const res = await prepareAttachment(fileOf("app.exe", "application/x-msdownload", [0x4d, 0x5a]), t);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ai.attachUnsupported");
  });

  it("refuses a file over the cap and says what the cap is", async () => {
    const big = fileOf("huge.pdf", "application/pdf", new Array(64).fill(0));
    // The check is on decoded bytes, so the size is asserted through a stub
    // rather than by allocating five megabytes in a unit test.
    Object.defineProperty(big, "size", { value: MAX_ATTACHMENT_BYTES * 2 });
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function () {
      this.onload?.call(this, {});
    });
    const original = Object.getOwnPropertyDescriptor(FileReader.prototype, "result");
    Object.defineProperty(FileReader.prototype, "result", {
      configurable: true,
      get: () => `data:application/pdf;base64,${"A".repeat(MAX_ATTACHMENT_BYTES * 2)}`,
    });

    try {
      const res = await prepareAttachment(big, t);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("ai.attachTooLarge:5");
    } finally {
      // restoreAllMocks does not undo a defineProperty, and a FileReader that
      // returns a two-megabyte PDF for the rest of the run fails the next
      // test for reasons that have nothing to do with it.
      Object.defineProperty(FileReader.prototype, "result", original);
    }
  });

  it("offers the picker exactly the types the server accepts", () => {
    // The two lists drifting apart is how a visitor ends up picking a file
    // that is refused after it uploads.
    for (const mime of ACCEPTED) expect(ACCEPT_ATTR).toContain(mime);
  });
});

describe("shrinking images", () => {
  it("leaves documents alone", async () => {
    expect(await downscaleImage(fileOf("a.pdf", "application/pdf", [1]))).toBe(null);
  });

  it("leaves an animated GIF alone rather than flattening it to one frame", async () => {
    expect(await downscaleImage(fileOf("a.gif", "image/gif", [1]))).toBe(null);
  });

  it("falls back to the original bytes when the canvas is unavailable", async () => {
    // jsdom has no real canvas, which is exactly the shape of a browser that
    // refuses one: the file must still be sendable.
    const res = await prepareAttachment(fileOf("photo.png", "image/png", [0x89, 0x50, 0x4e, 0x47]), t);
    expect(res.ok).toBe(true);
    expect(res.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
