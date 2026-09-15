"""Measure eye corners and mouth landmarks on the character paintings.

Registration of every body and every face patch onto the base rests on a
few points: the outer eye corners (face-mesh landmarks 33 and 263, which do
not move with gaze), the upper lip (13) and the chin (152). Detecting them
with the same model the app uses in the browser, run here offline, is what
made the patches land - the earlier dark-pixel eye finder locked onto the
wrong pair on half the frames, and correlation against the base could not
tell her face from her sweater across two separate generations.

Writes `.sc/landmarks-bodies.json`: pixel coordinates in each source image.

Usage:
    python scripts/measure-landmarks.py
"""
import json
from pathlib import Path

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "public" / "models" / "face-mesh.task"
POINTS = {"lo": 33, "ro": 263, "li": 468, "ri": 473, "lip13": 13, "lip17": 17, "chin": 152}


def flattened(path: Path) -> mp.Image:
    """The model wants an opaque RGB image; the cut-outs are transparent."""
    im = Image.open(path).convert("RGBA")
    flat = Image.new("RGBA", im.size, (40, 40, 48, 255))
    flat.alpha_composite(im)
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=__import__("numpy").asarray(flat.convert("RGB")))


def main() -> int:
    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
    )
    sources = {"base": ROOT / ".sc" / "casual" / "pose-rest-cut.png"}
    for outfit_dir in sorted((ROOT / ".sc").glob("*/")):
        for path in sorted(outfit_dir.glob("pose-*-cut.png")):
            sources[f"{outfit_dir.name}/{path.stem[len('pose-'):-len('-cut')]}"] = path
    out = {}
    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        for name, path in sources.items():
            image = flattened(path)
            result = landmarker.detect(image)
            if not result.face_landmarks:
                print(f"{name}: no face")
                continue
            pts = result.face_landmarks[0]
            w, h = image.width, image.height
            marks = {key: [round(pts[i].x * w, 1), round(pts[i].y * h, 1)] for key, i in POINTS.items()}
            sep = ((marks["ro"][0] - marks["lo"][0]) ** 2 + (marks["ro"][1] - marks["lo"][1]) ** 2) ** 0.5
            out[name] = {"file": str(path.relative_to(ROOT)).replace("\\", "/"), "size": [w, h], **marks}
            print(f"{name}: corners {marks['lo']} {marks['ro']} sep={sep:.1f} lip={marks['lip13']} chin={marks['chin']}")
    (ROOT / ".sc" / "landmarks-bodies.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
