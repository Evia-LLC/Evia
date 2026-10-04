"""Re-cut the face patches from the generated frames, registered by measured
landmarks and matched to the base.

Why this exists, in order of what went wrong before it:

  1. Tone. Every generated frame differs from the base by a little in colour
     and brightness, and a rectangle of skin that is a little different is a
     rectangle you can see. Each patch is now fitted to the base with a
     per-channel gain and offset solved on the ring under the feather - skin
     that should be identical in both - so the seam disappears.

  2. Registration. The eye detector in `register_frames.py` found the wrong
     feature pair on these frames, and a registration built on the wrong pair
     is confidently wrong. The frames are now registered from eye *corners*
     measured with the face-mesh model (`.sc/landmarks.json`) - corners rather
     than irises, because the gaze frames move the irises on purpose - and the
     base is the one the rig was actually baked from, `pose-rest-cut.png`.

  3. Boxes. The mouth box is sized from the measured lips and chin with room
     for an open jaw, so a wide vowel no longer draws over the closed chin
     beneath it, and the blink patch is cut tight around the eyes with the
     brows and hair left out.

Usage:
    python scripts/rebake-patches.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "character" / "evia"
FEATHER = 26


def ellipse_mask(size, centre, radii, feather):
    """A soft ellipse: the face, not the box.

    A rectangle reaches into whatever is beside the face - the loose strands
    at her temple, the neck, the background past her cheek - and none of that
    lines up between two generations, so all of it ghosted. An ellipse fitted
    to the skin blends only skin.
    """
    w, h = size
    cx, cy = centre
    rx, ry = radii
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(feather * 0.5))


def match_to_base(patch: np.ndarray, base: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """Per-channel mean and contrast from the ring, applied to the whole patch.

    Moments, not a regression: fitting pixel to pixel punishes every edge that
    is a few pixels off and answers with a flattened, bleached patch. Matching
    the mean and the spread asks only that the ring *look* like the base ring,
    which is what the eye checks.
    """
    out = patch.astype(np.float32).copy()
    if ring.sum() < 200:
        return out
    for c in range(3):
        x = patch[..., c][ring].astype(np.float32)
        y = base[..., c][ring].astype(np.float32)
        gain = float(np.clip(y.std() / max(x.std(), 1e-3), 0.85, 1.2))
        offset = float(y.mean() - gain * x.mean())
        out[..., c] = out[..., c] * gain + offset
    return np.clip(out, 0, 255)


def register(frame: Image.Image, lo, ro, base_lo, base_ro, size):
    """Similarity transform from the frame's eye corners to the base's."""
    sep_f = np.hypot(ro[0] - lo[0], ro[1] - lo[1])
    sep_b = np.hypot(base_ro[0] - base_lo[0], base_ro[1] - base_lo[1])
    scale = sep_b / sep_f
    resized = frame.resize(
        (int(round(frame.width * scale)), int(round(frame.height * scale))), Image.LANCZOS
    )
    mid_f = ((lo[0] + ro[0]) / 2 * scale, (lo[1] + ro[1]) / 2 * scale)
    mid_b = ((base_lo[0] + base_ro[0]) / 2, (base_lo[1] + base_ro[1]) / 2)
    dx, dy = mid_b[0] - mid_f[0], mid_b[1] - mid_f[1]
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(resized, (int(round(dx)), int(round(dy))))
    return out, scale


def register_ncc(frame: Image.Image, base: Image.Image, template_box=(860, 400, 1110, 500)):
    """Registers a frame generated *from the base itself* - so nominally already
    in place - by correlating the nose-and-cheeks region, which no eye or
    mouth edit touches, over a small range of scales and offsets."""
    gray = lambda im: np.asarray(im.convert("L"), dtype=np.float32)
    B = gray(base)
    l, t, r, b = template_box
    T = B[t:b, l:r]
    T = (T - T.mean()) / (T.std() + 1e-6)
    th, tw = T.shape

    def score(F, x, y):
        P = F[y:y + th, x:x + tw]
        if P.shape != T.shape:
            return -1.0
        P = (P - P.mean()) / (P.std() + 1e-6)
        return float((P * T).mean())

    best = (-2.0, 1.0, 0, 0)
    for scale in (0.98, 0.99, 1.0, 1.01, 1.02):
        F = gray(frame.resize((int(round(frame.width * scale)), int(round(frame.height * scale))), Image.LANCZOS))
        gx, gy = int(l * scale), int(t * scale)
        coarse = (-2.0, 0, 0)
        for dy in range(-48, 49, 4):
            for dx in range(-48, 49, 4):
                sc = score(F, gx + dx, gy + dy)
                if sc > coarse[0]:
                    coarse = (sc, dx, dy)
        fine = coarse
        for dy in range(coarse[2] - 3, coarse[2] + 4):
            for dx in range(coarse[1] - 3, coarse[1] + 4):
                sc = score(F, gx + dx, gy + dy)
                if sc > fine[0]:
                    fine = (sc, dx, dy)
        if fine[0] > best[0]:
            best = (fine[0], scale, fine[1], fine[2])
    ncc, scale, dx, dy = best
    resized = frame.resize((int(round(frame.width * scale)), int(round(frame.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    # The frame's template sits at (l*scale+dx, t*scale+dy); move it onto (l, t).
    out.paste(resized, (int(round(l - (l * scale + dx))), int(round(t - (t * scale + dy)))))
    return out, (ncc, scale, dx, dy)


def cut(source: Image.Image, base: Image.Image, box, ellipse, feather=FEATHER) -> Image.Image:
    crop = np.asarray(source.crop(box).convert("RGBA"))
    ref = np.asarray(base.crop(box).convert("RGBA"))
    centre = (ellipse[0] - box[0], ellipse[1] - box[1])
    mask = np.asarray(ellipse_mask(crop.shape[1::-1], centre, ellipse[2:], feather), dtype=np.float32) / 255.0
    solid = (crop[..., 3] > 230) & (ref[..., 3] > 230)
    ring = (mask > 0.12) & (mask < 0.88) & solid
    rgb = match_to_base(crop[..., :3], ref[..., :3], ring)
    # Nothing outside the figure: the base silhouette clips the patch, so a
    # frame with a different background cannot put that background beside her.
    alpha = crop[..., 3].astype(np.float32) * mask * (ref[..., 3].astype(np.float32) / 255.0)
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA")


def main() -> int:
    marks = json.loads((ROOT / ".sc" / "landmarks.json").read_text(encoding="utf-8"))
    b = marks["base"]
    base = Image.open(ROOT / b["file"]).convert("RGBA")
    assert list(base.size) == b["size"], base.size

    cx = (b["lo"][0] + b["ro"][0]) / 2          # between the eyes
    eye_y = (b["lo"][1] + b["ro"][1]) / 2
    lip_y = b["lip13"][1]
    chin_y = b["chin"][1]

    # Boxes in base pixels, each with the ellipse it blends through:
    # (centre x, centre y, radius x, radius y). Eyes: brows to under-eye.
    # Closed: the lids alone. Mouth: philtrum to below an open jaw.
    # Each box holds its ellipse *and* the whole of its feather: a box that
    # clips the feather ends the patch on a straight line at part opacity,
    # which is a visible edge across the neck or the brow.
    boxes = {
        "eyes": (int(cx - 236), int(eye_y - 142), int(cx + 236), int(eye_y + 102)),
        "eyesClosed": (int(cx - 180), int(eye_y - 58), int(cx + 180), int(eye_y + 62)),
        "mouth": (int(cx - 184), int(lip_y - 64), int(cx + 184), int(chin_y + 82)),
    }
    # The blink and the gaze patches stop short of the brows: the brows do not
    # move in a blink or a glance, and a patch that reaches them replaces them
    # with a slightly different drawing for a third of a second - a flicker.
    ellipses = {
        "eyes": (cx, eye_y - 24, 196, 96),
        "gaze": (cx, eye_y + 4, 156, 36),
        "eyesClosed": (cx, eye_y + 4, 150, 34),
        # The mouth stops just under the chin - an open jaw drops it ~20px -
        # and no further: a patch that ran on down the neck left a faint band
        # of another painting's neck under her chin whenever she spoke.
        "mouth": (cx, (lip_y + chin_y) / 2 + 8, 152, 80),
    }
    print("boxes:", boxes)

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["regions"] = {k: list(v) for k, v in boxes.items()}
    manifest["mouths"] = {}
    manifest["eyes"] = {}

    # Frames come from two generations. `.sc/frames2` are edits of the base
    # itself and sit where the base sits, give or take a few pixels, so they
    # register by correlation; `.sc/frames` are edits of a different crop and
    # register by their measured eye corners. Where both exist, the edit of
    # the base wins: it is the same painting, not a near relative of it.
    sources = {}
    for name, lm in marks["frames"].items():
        sources[name] = ("corners", ROOT / ".sc" / "frames" / f"{name}.png", lm)
    for path in sorted((ROOT / ".sc" / "frames2").glob("*.png")):
        if path.stem.startswith(("expr-", "mouth-")):
            sources[path.stem] = ("ncc", path, None)

    for name, (how, path, lm) in sources.items():
        frame = Image.open(path).convert("RGBA")
        if how == "corners":
            aligned, scale = register(frame, lm["lo"], lm["ro"], b["lo"], b["ro"], base.size)
        else:
            aligned, info = register_ncc(frame, base)
            scale = info[1]
            print(f"  {name}: ncc={info[0]:.2f} shift=({info[2]:+d},{info[3]:+d})")
        kind, _, label = name.partition("-")
        region = "mouth" if kind == "mouth" else "eyes"
        blend = "gaze" if label.startswith("look-") else region
        feather = {"gaze": 12, "mouth": 20}.get(blend, FEATHER)
        patch = cut(aligned, base, boxes[region], ellipses[blend], feather=feather)
        file = f"{region}-{label}.webp"
        patch.save(OUT / file, quality=92, method=6)
        manifest["mouths" if region == "mouth" else "eyes"][label] = file
        print(f"{name}: scale={scale:.4f} -> {file}")

    closed2 = ROOT / ".sc" / "frames2" / "eyes-closed.png"
    if closed2.exists():
        aligned, info = register_ncc(Image.open(closed2).convert("RGBA"), base)
        scale = info[1]
        print(f"  eyes-closed: ncc={info[0]:.2f} shift=({info[2]:+d},{info[3]:+d})")
    else:
        c = marks["closed"]
        closed = Image.open(ROOT / c["file"]).convert("RGBA")
        aligned, scale = register(closed, c["lo"], c["ro"], b["lo"], b["ro"], base.size)
    patch = cut(aligned, base, boxes["eyesClosed"], ellipses["eyesClosed"], feather=12)
    patch.save(OUT / "eyes-closed.webp", quality=92, method=6)
    manifest["eyes"]["closed"] = "eyes-closed.webp"
    print(f"eyes-closed: scale={scale:.4f} -> eyes-closed.webp")

    manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print("eyes:", sorted(manifest["eyes"]), "mouths:", sorted(manifest["mouths"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
