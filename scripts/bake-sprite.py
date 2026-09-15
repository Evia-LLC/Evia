"""Turn generated frames into the runtime sprite rig.

The generator produces whole 2048x2048 portraits — one per mouth shape, one per
expression. Shipping ten of those would be ~40MB of texture for a character who
only ever changes two small areas of her face, so this reduces them to what
actually differs:

  body.webp        the base portrait, everything below the head
  head.webp        the head, drawn over the body so it can move independently
  mouth-<v>.webp   just the mouth, one per viseme
  eyes-<e>.webp    just the eyes and brows, one per expression
  manifest.json    where each piece sits, in fractions of the body image

Every frame is registered onto the base first (see register-frames.py), because
the edit endpoint does not preserve framing exactly and an unregistered mouth
lands a few pixels off — which reads as a twitch, not as speech.

Regions are cut with a feathered mask. A hard-edged rectangle of face pasted on
another face shows its own border the moment the two differ even slightly in
tone, and these are separate generations, so they always differ slightly.

Usage:
    python scripts/bake-sprite.py .sc/h1-cut.png .sc/frames public/character/elohim
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from register_frames import align, eye_landmarks  # noqa: E402

"""Region geometry, expressed in eye-separations rather than frame fractions.

The first version used fractions of the frame, which was fine while every frame
was the same waist-up crop. It broke the moment the base was reframed to
mid-thigh to bring her arms in: the face dropped to 64% of its previous size and
sat lower, so a mouth box fixed at 30-46% of frame height cut her collar.

Eye separation is the natural unit — it scales with the face and moves with it —
so all of this is measured in multiples of it, offset from the eye midpoint.
"""
# (half-width, half-height, vertical offset from the eye line) in eye-separations
REGIONS_BY_EYE = {
    "mouth": (1.30, 0.72, 1.15),
    "eyes": (2.10, 0.62, -0.23),
}
# The head, which moves as one piece for gaze and nods.
HEAD_BY_EYE = (2.75, 2.30, 0.01)
FEATHER = 26


def feathered(image: Image.Image, box_px, feather: int = FEATHER) -> Image.Image:
    """Crops `box_px` with an alpha that fades to nothing at the edges."""
    crop = image.crop(box_px).convert("RGBA")
    w, h = crop.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (feather, feather, w - feather, h - feather),
        radius=feather,
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.55))
    existing = crop.split()[-1]
    crop.putalpha(Image.fromarray(
        (np.asarray(existing, float) * np.asarray(mask, float) / 255).astype("uint8")
    ))
    return crop


def box_from_eyes(spec, eyes):
    """(half_w, half_h, dy) in eye-separations -> a pixel box on this frame."""
    left, right, y = eyes
    sep = right - left
    cx = (left + right) / 2
    cy = y + spec[2] * sep
    return (
        int(cx - spec[0] * sep),
        int(cy - spec[1] * sep),
        int(cx + spec[0] * sep),
        int(cy + spec[1] * sep),
    )


def trimmed(image: Image.Image):
    """Content bounds, so nothing ships a border of empty pixels."""
    bbox = image.getbbox()
    return image.crop(bbox), bbox


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    base_path, frames_dir, out_dir = (Path(p) for p in sys.argv[1:4])
    poses_dir = Path(sys.argv[4]) if len(sys.argv) > 4 else None
    out_dir.mkdir(parents=True, exist_ok=True)

    base = Image.open(base_path).convert("RGBA")
    if eye_landmarks(base) is None:
        print("no eyes found in the base frame")
        return 1

    manifest = {"frame": list(base.size), "regions": {}, "mouths": {}, "eyes": {}}

    # --- body and head -----------------------------------------------------
    # No standalone `body`: it is just the clinical resting pose, and shipping
    # the same picture twice under two names is how the two drift apart.

    base_eyes = eye_landmarks(base)
    head_px = box_from_eyes(HEAD_BY_EYE, base_eyes)
    head = feathered(base, head_px, FEATHER)
    head.save(out_dir / "head.webp", quality=92, method=6)
    manifest["head"] = {"box": head_px, "file": "head.webp"}

    for key, spec in REGIONS_BY_EYE.items():
        manifest["regions"][key] = box_from_eyes(spec, base_eyes)

    # --- overlays ----------------------------------------------------------
    for frame_path in sorted(Path(frames_dir).glob("*.png")):
        if frame_path.stem.endswith("-aligned"):
            continue
        kind, _, label = frame_path.stem.partition("-")
        if kind not in ("mouth", "expr"):
            continue

        frame = Image.open(frame_path).convert("RGBA")
        if frame.size != base.size:
            frame = frame.resize(base.size, Image.LANCZOS)
        aligned, info = align(base, frame)
        if aligned is None:
            print(f"{frame_path.name}: SKIPPED — eyes not found, cannot register")
            continue

        region = "mouth" if kind == "mouth" else "eyes"
        # Cut from the *base's* box: the frame has been registered onto the base,
        # so after alignment the feature is where the base says it is.
        box_px = box_from_eyes(REGIONS_BY_EYE[region], base_eyes)
        patch = feathered(aligned, box_px, FEATHER)
        name = f"{region}-{label}.webp"
        patch.save(out_dir / name, quality=92, method=6)

        bucket = "mouths" if region == "mouth" else "eyes"
        manifest[bucket][label] = name
        print(f"{frame_path.name}: scale={info[0]:.4f} -> {name}")

    # --- outfits and their poses -------------------------------------------
    #
    # Every body is registered onto the base by its eye landmarks, so her head
    # lands in the same place in all of them and the mouth and eye patches keep
    # working across an outfit change as well as a gesture. The face does not
    # change with clothes, which is why there is exactly one head, one set of
    # mouths and one set of expressions no matter how many outfits exist.
    manifest["outfits"] = {}
    for outfit_dir in sorted(d for d in Path(poses_dir or ".").iterdir() if d.is_dir()) if poses_dir else []:
        outfit = outfit_dir.name
        bodies = {}
        for pose_path in sorted(outfit_dir.glob("pose-*-cut.png")):
            label = pose_path.stem.replace("pose-", "").replace("-cut", "")
            pose = Image.open(pose_path).convert("RGBA")
            if pose.size != base.size:
                pose = pose.resize(base.size, Image.LANCZOS)
            aligned, info = align(base, pose)
            if aligned is None:
                print(f"{outfit}/{pose_path.name}: SKIPPED — eyes not found")
                continue
            trimmed_pose, pose_box = trimmed(aligned)
            name = f"body-{outfit}-{label}.webp"
            trimmed_pose.save(out_dir / name, quality=90, method=6)
            bodies[label] = {"box": pose_box, "file": name}
            print(f"{outfit}/{label}: scale={info[0]:.4f} -> {name}")
        if bodies:
            manifest["outfits"][outfit] = bodies

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(p.stat().st_size for p in out_dir.iterdir())
    print(f"\n{len(list(out_dir.iterdir()))} files, {total/1024:.0f} KB total")
    print(f"mouths: {sorted(manifest['mouths'])}")
    print(f"eyes:   {sorted(manifest['eyes'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
