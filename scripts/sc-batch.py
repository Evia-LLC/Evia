"""Run a batch of SpriteCook edits off one base frame, and fetch the results.

Every frame in the character rig is an *edit* of the same base portrait, so that
hair, coat, lighting and pose stay identical and only the thing being animated
moves. Doing that one tool call at a time is a lot of round trips; this drives
the bridge, downloads each result, and reports the credit spend as it goes.

Usage:
    python scripts/sc-batch.py <batch.json>

where batch.json is:
    {
      "base_asset_id": "...",
      "model": "gemini-3-pro-image",
      "out_dir": ".sc/frames",
      "frames": [ { "name": "mouth-ee", "prompt": "..." }, ... ]
    }
"""
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Prepended to every prompt. The edit endpoint preserves geometry only on a
# best-effort basis, and saying this plainly measurably improves how much of the
# frame survives untouched.
PREAMBLE = (
    "Identical portrait, identical pose, identical framing, identical hair, "
    "identical clothing, identical jewellery, identical lighting and colour. "
)
POSTAMBLE = " Every other part of the image must remain pixel-identical to the source."


def call(tool: str, payload: dict) -> dict:
    args_path = ROOT / ".sc" / "_batch_arg.json"
    args_path.parent.mkdir(parents=True, exist_ok=True)
    args_path.write_text(json.dumps(payload), encoding="utf-8")
    result = subprocess.run(
        ["node", str(ROOT / "scripts" / "spritecook.mjs"), tool, f"@.sc/{args_path.name}"],
        capture_output=True,
        text=True,
        cwd=ROOT,
        shell=sys.platform == "win32",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    envelope = json.loads(result.stdout)
    if envelope.get("isError"):
        raise RuntimeError(envelope["content"][0]["text"])
    return envelope.get("structuredContent") or json.loads(envelope["content"][0]["text"])


def main() -> int:
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_dir = ROOT / spec.get("out_dir", ".sc/frames")
    out_dir.mkdir(parents=True, exist_ok=True)

    spent = 0
    for frame in spec["frames"]:
        name = frame["name"]
        target = out_dir / f"{name}.png"
        if target.exists():
            print(f"{name}: already have it, skipping")
            continue

        payload = {
            "prompt": (frame["prompt"] if frame.get("reframe")
                       else PREAMBLE + frame["prompt"] + POSTAMBLE),
            "pixel": False,
            "bg_mode": "transparent",
            "aspect_ratio": "1:1",
            "smart_crop": False,
            "model": spec.get("model", "gemini-3-pro-image"),
            "resolution": spec.get("resolution", "2K"),
            "variations": 1,
            # `edit` holds framing and changes one detail; `reference` keeps the
            # character but is free to reframe her. Poses need the second.
            **(
                {"reference_asset_id": frame.get("base_asset_id", spec["base_asset_id"])}
                if frame.get("reframe")
                else {"edit_asset_id": frame.get("base_asset_id", spec["base_asset_id"])}
            ),
            "wait_seconds": 85,
        }
        try:
            result = call("generate_game_art", payload)
        except Exception as exc:  # noqa: BLE001 — report and carry on
            print(f"{name}: FAILED — {exc}")
            continue

        used = result.get("credits_used", 0)
        spent += used
        assets = result.get("assets") or []
        if not assets:
            print(f"{name}: no asset returned (status {result.get('status')})")
            continue
        url = assets[0].get("raw_url") or assets[0].get("url")
        urllib.request.urlretrieve(url, target)
        print(
            f"{name}: {used} credits, {result.get('credits_remaining')} left "
            f"-> {target.relative_to(ROOT)}  [{assets[0]['asset_id']}]"
        )

    print(f"\nbatch spent {spent} credits")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
