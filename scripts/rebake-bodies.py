"""Re-register the body paintings onto the base and cut them again.

The eye detector that registered the bodies the first time found the wrong
pair on one of them, and the casual "present" body shipped at 1.4x the scale
of the base: her painted head sat behind the head layer as a second, larger
head every time she gestured at a readout. The rest were a few pixels off.

Every body is now placed by its measured outer eye corners (see
`measure-landmarks.py`), its neck is tone-matched to its outfit's resting
body - skin in all of them, and the one place a cut between bodies is judged
- and the head layer is re-cut from the base with a fade that reaches zero,
so its neck hands over to whichever body is underneath with no edge.

Usage:
    python scripts/rebake-bodies.py [--dry-run]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "character" / "evia"
LANDMARKS = ROOT / ".sc" / "landmarks-bodies.json"
# Neck skin under the head layer, where a cut between two bodies is judged.
NECK = (900, 640, 1080, 720)
# The head layer fades out over this many pixels above its bottom edge, so
# that its neck hands over to the body's neck with no edge at all.
HEAD_FADE = 110


def register(src: Image.Image, marks, base_marks):
    """Similarity transform from the source's outer eye corners to the base's.

    Corners, because they stay put whatever the eyes do; a similarity, because
    every body is the same painting of the same woman at some other crop.
    """
    lo, ro = marks["lo"], marks["ro"]
    blo, bro = base_marks["lo"], base_marks["ro"]
    scale = np.hypot(bro[0] - blo[0], bro[1] - blo[1]) / np.hypot(ro[0] - lo[0], ro[1] - lo[1])
    mid = ((lo[0] + ro[0]) / 2 * scale, (lo[1] + ro[1]) / 2 * scale)
    bmid = ((blo[0] + bro[0]) / 2, (blo[1] + bro[1]) / 2)
    return float(scale), int(round(bmid[0] - mid[0])), int(round(bmid[1] - mid[1]))


def place(src: Image.Image, scale: float, dx: int, dy: int, size) -> Image.Image:
    resized = src.resize((int(round(src.width * scale)), int(round(src.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(resized, (dx, dy))
    return out


def match_neck(body: Image.Image, reference: Image.Image) -> Image.Image:
    a = np.asarray(body).astype(np.float32)
    r = np.asarray(reference).astype(np.float32)
    l, t, rr, b = NECK
    x = a[t:b, l:rr, :3]
    y = r[t:b, l:rr, :3]
    solid = (a[t:b, l:rr, 3] > 250) & (r[t:b, l:rr, 3] > 250)
    if solid.sum() < 500:
        return body
    out = a.copy()
    for c in range(3):
        xs, ys = x[..., c][solid], y[..., c][solid]
        gain = float(np.clip(ys.std() / max(xs.std(), 1e-3), 0.9, 1.1))
        offset = float(ys.mean() - gain * xs.mean())
        out[..., c] = np.clip(out[..., c] * gain + offset, 0, 255)
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def cut_head(base: Image.Image, box) -> Image.Image:
    """The head layer, from the base, fading to nothing at the neck."""
    head = np.asarray(base.crop(box)).astype(np.float32)
    h = head.shape[0]
    ramp = np.ones(h, dtype=np.float32)
    y = np.arange(HEAD_FADE, dtype=np.float32) / (HEAD_FADE - 1)
    ramp[h - HEAD_FADE:] = 1 - (y * y * (3 - 2 * y))  # smoothstep down to 0
    head[..., 3] *= ramp[:, None]
    return Image.fromarray(head.astype(np.uint8), "RGBA")


def main() -> int:
    dry = "--dry-run" in sys.argv
    marks = json.loads(LANDMARKS.read_text(encoding="utf-8"))
    base_marks = marks["base"]
    base = Image.open(ROOT / base_marks["file"]).convert("RGBA")
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    outfits = {}
    for name, m in marks.items():
        if name == "base":
            continue
        outfit, pose = name.split("/")
        src = Image.open(ROOT / m["file"]).convert("RGBA")
        scale, dx, dy = register(src, m, base_marks)
        placed = place(src, scale, dx, dy, base.size)
        print(f"{name}: scale={scale:.3f} offset=({dx:+d},{dy:+d})")
        outfits.setdefault(outfit, {})[pose] = placed

    for outfit, placed in outfits.items():
        reference = placed.get("rest")
        bodies = {}
        for pose, canvas in placed.items():
            if reference is not None and pose != "rest":
                canvas = match_neck(canvas, reference)
            bbox = canvas.getbbox()
            file = f"body-{outfit}-{pose}.webp"
            if not dry:
                canvas.crop(bbox).save(OUT / file, quality=90, method=6)
            bodies[pose] = {"box": list(bbox), "file": file}
        outfits[outfit] = bodies

    head = cut_head(base, manifest["head"]["box"])
    if not dry:
        head.save(OUT / manifest["head"]["file"], quality=92, method=6)
        manifest["outfits"] = outfits
        manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        print("manifest updated; head re-cut with a", HEAD_FADE, "px fade")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
