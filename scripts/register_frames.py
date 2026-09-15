"""Align generated character frames back onto a base frame.

`edit_asset_id` preserves the *content* of a portrait well — change the mouth
and the hair, coat and lighting all survive — but it does not preserve framing
exactly. Measured on the first mouth edit, the face came back 1.8% smaller.
Small, but a mouth composited from an unregistered frame still lands a few
pixels off, and a mouth that jumps as it changes shape is worse than no lip sync
at all.

Nothing at runtime can fix that and nothing needs to: these frames are baked
once. This registers each frame onto the base from eye landmarks — the eyes are
high-contrast, symmetric, and the one feature a mouth edit is told not to touch,
which makes them both easy to find and trustworthy as a reference.

A brute-force search over scale and offset was tried first and was worse: it
agreed the frames were close but resolved scale only to the nearest 1%, which is
the same order as the error being corrected. Two landmarks give it directly.

Usage:
    python scripts/register-frames.py <base.png> <frame.png> [more.png ...]

Writes `<frame>-aligned.png` beside each input.
"""
import sys
from PIL import Image
import numpy as np

# Horizontal extent to hunt across, as fractions of the frame. The *vertical*
# position is found rather than fixed: the waist-up and mid-thigh framings put
# the eyes at completely different heights, and a hardcoded band that worked for
# one silently found hair, or nothing, in the other.
EYE_SPAN = (0.22, 0.82)
# Vertical range to search, and how tall each candidate band is.
EYE_SEARCH = (0.06, 0.46)
EYE_BAND_H = 0.05
# A gap this wide (in px, at full res) separates the two eyes' dark pixels.
EYE_GAP = 40


def eye_landmarks(image: Image.Image, hint_sep: float | None = None):
    """Returns (left_x, right_x, y) of the eyes, or None if they aren't found.

    `hint_sep` is a known eye separation in pixels from a reference frame. Every
    frame here is the same character, so a candidate whose separation is wildly
    off that is wrong by construction — and rejecting those is far more reliable
    than trying to out-tune the heuristics. Without it, a reframed gesture pose
    matched something 435px wide against a true separation of ~200 and the whole
    body registered at 0.34 scale.

    Scans candidate horizontal bands down the upper half of the frame and keeps
    the one whose dark pixels fall most cleanly into two separated clusters —
    which is what a pair of eyes looks like from above and below, and what hair,
    a mouth or a collar does not.
    """
    # Flatten onto mid-grey first. A cut-out frame has transparent padding, and
    # `convert("L")` turns that into black — which is then the darkest thing in
    # the band and gets mistaken for an eye.
    if image.mode == "RGBA":
        flat = Image.new("RGBA", image.size, (128, 128, 128, 255))
        flat.alpha_composite(image)
        image = flat
    arr = np.asarray(image.convert("L"), dtype=float)
    h, w = arr.shape

    bx0, bx1 = int(EYE_SPAN[0] * w), int(EYE_SPAN[1] * w)
    band_h = max(4, int(EYE_BAND_H * h))
    gap = max(8, int(0.02 * w))

    best = None
    y = int(EYE_SEARCH[0] * h)
    stop = int(EYE_SEARCH[1] * h) - band_h
    while y < stop:
        y0 = y
        band = arr[y:y + band_h, bx0:bx1]
        column_min = band.min(axis=0)
        floor = column_min.min()
        dark = np.where(column_min < floor + 28)[0]
        y += max(2, band_h // 3)
        if dark.size < 6:
            continue
        splits = np.where(np.diff(dark) > gap)[0]
        if splits.size != 1:
            continue
        left, right = dark[: splits[0] + 1], dark[splits[0] + 1 :]
        if left.size < 3 or right.size < 3:
            continue

        separation = right.mean() - left.mean()
        balance = min(left.size, right.size) / max(left.size, right.size)
        contrast = float(band.mean() - floor)

        # Eyes are narrow marks. A dark shape wider than about half the gap
        # between the pair is a garment or a shadow, not an eye.
        if max(left.size, right.size) > separation * 0.6:
            continue

        # Same subject, so the scale cannot have changed by much.
        if hint_sep is not None and not (0.55 * hint_sep <= separation <= 1.8 * hint_sep):
            continue

        # Height is the decisive term, and it has to be.
        #
        # On the mid-thigh framing her black V-neck against the white coat forms
        # two dark clusters with a clean gap between them — balanced, high
        # contrast, and a *better* match on every other measure than her actual
        # eyes. It scored 57 against the eyes' 49 and the whole rig baked onto
        # her chest. Nothing eye-shaped ever sits above the eyes, so preferring
        # the higher candidate is safe in a way that preferring the darker is not.
        height_weight = (1 - (y0 / h)) ** 2
        score = contrast * balance * min(1.0, separation / (0.18 * w)) * height_weight
        if best is None or score > best[0]:
            row = int(band.min(axis=1).argmin())
            best = (score, left.mean() + bx0, right.mean() + bx0, row + y0)

    if best is None:
        return None
    return (best[1], best[2], best[3])


def align(base: Image.Image, frame: Image.Image):
    """Scales and shifts `frame` so its eyes sit on the base's eyes."""
    a = eye_landmarks(base)
    if a is None:
        return None, None
    b = eye_landmarks(frame, hint_sep=a[1] - a[0])
    if b is None:
        return None, None

    scale = (a[1] - a[0]) / (b[1] - b[0])
    w, h = base.size
    side_w, side_h = int(round(frame.width * scale)), int(round(frame.height * scale))
    resized = frame.resize((side_w, side_h), Image.LANCZOS)

    # Put the scaled frame's eye midpoint on the base's eye midpoint.
    dx = (a[0] + a[1]) / 2 - ((b[0] + b[1]) / 2) * scale
    dy = a[2] - b[2] * scale

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(resized, (int(round(dx)), int(round(dy))))
    return out, (scale, dx, dy)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base = Image.open(sys.argv[1]).convert("RGBA")
    if eye_landmarks(base) is None:
        print("Could not find eyes in the base frame — check EYE_BAND.")
        return 1

    failures = 0
    for path in sys.argv[2:]:
        frame = Image.open(path).convert("RGBA")
        if frame.size != base.size:
            frame = frame.resize(base.size, Image.LANCZOS)
        aligned, info = align(base, frame)
        if aligned is None:
            print(f"{path}: FAILED — eyes not found")
            failures += 1
            continue
        out_path = path.rsplit(".", 1)[0] + "-aligned.png"
        aligned.save(out_path)
        scale, dx, dy = info
        print(f"{path}: scale={scale:.4f} dx={dx:+.1f} dy={dy:+.1f} -> {out_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
