#!/usr/bin/env python3
"""Strip the white studio background out of the imported product photos.

The source shots (content/ashkan-medical/images/*.jpg) are all devices on a
solid white seamless. That reads fine on a white card but looks like a
pasted-on rectangle over the app's dark theme and over the 3D stages, so
each one is keyed to transparency here and written alongside as a PNG.

Uses a flood fill from the border rather than a global "white -> alpha"
threshold: these devices are themselves largely white, and a global
threshold punches holes straight through their casings. Flood fill only
removes white that is actually connected to the outside of the frame.

Run with the venv that has Pillow:
    /tmp/imgvenv/bin/python scripts/make-transparent-images.py
"""
import os
import sys
from collections import deque

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required. Create a venv and `pip install Pillow`.")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "content", "ashkan-medical", "images")
OUT_DIR = os.path.join(ROOT, "content", "ashkan-medical", "images-transparent")

# How far from pure white still counts as background. Deliberately TIGHT:
# several of these devices (Exciplex especially) are white-cased products
# shot on white, and a generous threshold lets the flood fill leak straight
# through the casing -- at tol=26 Exciplex lost 96% of itself. The seamless
# is a true 255,255,255 so a tight value still keys it cleanly, and the
# feather pass below cleans up the JPEG ringing a tight threshold leaves.
TOLERANCE = 6

# Per-image overrides. One global threshold cannot fit this set: most shots
# are a true white seamless, but 4plus ships on a pale-mint *designed*
# backdrop (a stylised "4" and a circle) that needs a looser threshold to
# lift, while Exciplex is a white-cased handheld on white that needs a
# tight one or the fill eats the product. Verified by compositing each
# result over the app's dark background.
TOLERANCE_OVERRIDES = {
    "4plus": 30,
}
# Pixels within this distance of a kept pixel get partial alpha, which stops
# the cut-out from having a hard aliased edge on a dark background.
FEATHER = 2.0


def is_background(px, tol):
    r, g, b = px[0], px[1], px[2]
    return r >= 255 - tol and g >= 255 - tol and b >= 255 - tol


def key_out_background(img, tol=TOLERANCE):
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    # Flood fill inward from every border pixel that is white-ish.
    transparent = bytearray(w * h)
    q = deque()

    def push(x, y):
        if 0 <= x < w and 0 <= y < h and not transparent[y * w + x] and is_background(px[x, y], tol):
            transparent[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    # Apply alpha, feathering the boundary so edges don't alias on dark.
    for y in range(h):
        row = y * w
        for x in range(w):
            if transparent[row + x]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)

    if FEATHER:
        # Cheap 1px soften: any kept pixel touching a removed one gets
        # its alpha pulled down toward the background.
        for y in range(1, h - 1):
            row = y * w
            for x in range(1, w - 1):
                if transparent[row + x]:
                    continue
                neighbours = (
                    transparent[row + x - 1]
                    + transparent[row + x + 1]
                    + transparent[row - w + x]
                    + transparent[row + w + x]
                )
                if neighbours:
                    r, g, b, a = px[x, y]
                    px[x, y] = (r, g, b, int(a * (1 - 0.22 * neighbours)))

    return img


def crop_to_content(img, pad=8):
    """Trim the empty margin so the device fills its box."""
    bbox = img.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(img.width, r + pad), min(img.height, b + pad)
    return img.crop((l, t, r, b))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    names = sorted(n for n in os.listdir(SRC_DIR) if n.lower().endswith((".jpg", ".jpeg", ".webp", ".png")))
    if not names:
        sys.exit(f"No source images in {SRC_DIR}")

    for name in names:
        src = os.path.join(SRC_DIR, name)
        stem = os.path.splitext(name)[0]
        out = os.path.join(OUT_DIR, stem + ".png")
        img = Image.open(src)
        tol = TOLERANCE_OVERRIDES.get(stem, TOLERANCE)
        keyed = crop_to_content(key_out_background(img, tol))
        keyed.save(out, "PNG", optimize=True)
        kept = sum(1 for p in keyed.getdata() if p[3] > 0)
        total = keyed.width * keyed.height
        note = f"  (tol={tol})" if stem in TOLERANCE_OVERRIDES else ""
        print(f"{name:34s} -> {stem}.png  {keyed.width}x{keyed.height}  subject {kept * 100 // total}%{note}")

    print(f"\nWrote {len(names)} transparent PNGs to {OUT_DIR}")


if __name__ == "__main__":
    main()
