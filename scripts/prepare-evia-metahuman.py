#!/usr/bin/env python3
"""Make a texture-optimized GLB while preserving geometry and rig data exactly.

Requires Pillow. Usage:
    python3 scripts/prepare-evia-metahuman.py /path/to/C6.glb

The source file is never modified. No Blender installation is required.
"""

import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import struct

from PIL import Image


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError("Truncated GLB")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Expected a valid glTF 2.0 binary file")
    chunks = {}
    offset = 12
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        if size % 4 or offset + 8 + size > len(data) or kind in chunks:
            raise ValueError("Invalid GLB chunk layout")
        chunks[kind] = data[offset + 8 : offset + 8 + size]
        offset += 8 + size
    if offset != len(data) or set(chunks) != {JSON_CHUNK, BIN_CHUNK}:
        raise ValueError("Expected exactly one JSON and one BIN chunk")
    document = json.loads(chunks[JSON_CHUNK])
    if len(document.get("buffers", [])) != 1 or "uri" in document["buffers"][0]:
        raise ValueError("Only a single embedded buffer is supported")
    if document["buffers"][0]["byteLength"] > len(chunks[BIN_CHUNK]):
        raise ValueError("Declared buffer is larger than its BIN chunk")
    return document, chunks[BIN_CHUNK]


def view_bytes(document, binary, index):
    view = document["bufferViews"][index]
    start = view.get("byteOffset", 0)
    length = view["byteLength"]
    if view.get("buffer", 0) != 0 or start < 0 or start + length > len(binary):
        raise ValueError(f"Invalid buffer view {index}")
    return binary[start : start + length]


def encode_image(data, max_size, quality):
    with Image.open(io.BytesIO(data)) as image:
        original_size = image.size
        image.load()
        has_alpha = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
        image = image.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        if has_alpha:
            image.save(out, format="PNG", optimize=True)
            mime = "image/png"
        else:
            # No chroma subsampling: normal-map channels retain independent detail.
            image.save(out, format="JPEG", quality=quality, subsampling=0, optimize=True)
            mime = "image/jpeg"
        return out.getvalue(), mime, original_size, image.size, has_alpha


def write_glb(path, document, binary):
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary += b"\0" * (-len(binary) % 4)
    length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as target:
        target.write(struct.pack("<4sII", b"glTF", 2, length))
        target.write(struct.pack("<II", len(json_bytes), JSON_CHUNK))
        target.write(json_bytes)
        target.write(struct.pack("<II", len(binary), BIN_CHUNK))
        target.write(binary)


def validate_preservation(source_document, source_binary, target_document, target_binary, image_views, repaired_materials):
    # Every non-image payload is byte-for-byte identical, including mesh attributes,
    # indices, inverse bind matrices, and any animation/accessor data.
    for index, view in enumerate(target_document["bufferViews"]):
        if view.get("byteOffset", 0) % 4:
            raise ValueError(f"Unaligned buffer view {index}")
        actual = view_bytes(target_document, target_binary, index)
        if index not in image_views and actual != view_bytes(source_document, source_binary, index):
            raise ValueError(f"Non-image buffer view {index} changed")
    for key in set(source_document) - {"images", "bufferViews", "buffers", "materials", "textures"}:
        if source_document[key] != target_document.get(key):
            raise ValueError(f"Source metadata changed: {key}")
    if len(source_document["materials"]) != len(target_document["materials"]):
        raise ValueError("Material count changed")
    for index, material in enumerate(source_document["materials"]):
        expected = repaired_materials.get(index, material)
        if target_document["materials"][index] != expected:
            raise ValueError(f"Unexpected material change: {index}")
    if target_document["textures"][:-1] != source_document["textures"]:
        raise ValueError("Source texture references changed")
    for index, source_view in enumerate(source_document["bufferViews"]):
        target_view = target_document["bufferViews"][index]
        for key in set(source_view) - {"byteOffset", "byteLength"}:
            if source_view[key] != target_view.get(key):
                raise ValueError(f"Buffer view metadata changed: {index}.{key}")
    for image in target_document["images"]:
        with Image.open(io.BytesIO(view_bytes(target_document, target_binary, image["bufferView"]))) as decoded:
            decoded.verify()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/character/evia/evia-metahuman.glb")
    parser.add_argument("--max-texture-size", type=int, default=2048)
    parser.add_argument("--normal-texture-size", type=int, default=1024, help="Maximum size for non-face normal maps; the head keeps --max-texture-size detail")
    parser.add_argument("--jpeg-quality", type=int, default=92)
    inputs = Path(__file__).resolve().parent / "metahuman-textures"
    parser.add_argument("--hair-texture", type=Path, default=inputs / "hair-updo-buns.png", help="Decoded C6 RGBA coverage atlas, not the packed Attribute atlas")
    parser.add_argument("--eyelash-texture", type=Path, default=inputs / "eyelashes.png", help="Recovered MetaHuman RGBA eyelash atlas")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error("Source and output must be different files")
    if args.max_texture_size < 1 or args.normal_texture_size < 1 or not 1 <= args.jpeg_quality <= 100:
        parser.error("Texture size must be positive and JPEG quality must be 1–100")

    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    original, original_binary = read_glb(args.source)
    optimized = copy.deepcopy(original)
    replacements = {}
    image_report = []
    for source_image, target_image in zip(original.get("images", []), optimized.get("images", [])):
        if "bufferView" not in source_image:
            raise ValueError("All images must be embedded")
        index = source_image["bufferView"]
        if index in replacements:
            raise ValueError("Shared image buffer views need explicit handling")
        data = view_bytes(original, original_binary, index)
        source_bytes = len(data)
        with Image.open(io.BytesIO(data)) as original_image:
            source_dimensions = original_image.size
        name = source_image.get("name", "").lower()
        if name == "hair_s_updobuns_cardsatlas_attribute":
            data = args.hair_texture.read_bytes()
            target_image["name"] = "C6_Hair_UpdoBuns_ColorCoverage"
        texture_size = args.max_texture_size
        if "normal" in name and "head" not in name:
            texture_size = min(texture_size, args.normal_texture_size)
        encoded, mime, before, after, alpha = encode_image(data, texture_size, args.jpeg_quality)
        if name == "hair_s_updobuns_cardsatlas_attribute" and not alpha:
            raise ValueError("Hair atlas must contain transparent coverage")
        replacements[index] = encoded
        target_image["mimeType"] = mime
        image_report.append({"name": source_image.get("name", str(index)), "source_dimensions": source_dimensions, "dimensions": after, "source_bytes": source_bytes, "bytes": len(encoded), "mime_type": mime, "has_alpha": alpha, "reconstructed": name == "hair_s_updobuns_cardsatlas_attribute"})

    # The Blender export omitted the eyelash map and exported a packed hair
    # Attribute atlas as color/opacity. Restore the recovered atlas inputs without
    # altering mesh UVs, skin weights, geometry or the authored hair tint.
    lash_view = len(optimized["bufferViews"])
    encoded, mime, before, after, alpha = encode_image(args.eyelash_texture.read_bytes(), args.max_texture_size, args.jpeg_quality)
    if not alpha:
        raise ValueError("Eyelash atlas must contain transparent coverage")
    replacements[lash_view] = encoded
    optimized["bufferViews"].append({"buffer": 0, "byteLength": len(encoded)})
    lash_image = len(optimized["images"])
    optimized["images"].append({"name": "Evia_Eyelashes_ColorCoverage", "bufferView": lash_view, "mimeType": mime})
    lash_texture = len(optimized["textures"])
    optimized["textures"].append({"sampler": 0, "source": lash_image})
    image_report.append({"name": "Evia_Eyelashes_ColorCoverage", "source_dimensions": before, "dimensions": after, "source_bytes": args.eyelash_texture.stat().st_size, "bytes": len(encoded), "mime_type": mime, "has_alpha": alpha, "recovered": True})
    repaired_materials = {}
    for index, material in enumerate(optimized["materials"]):
        if material.get("name") == "C6_eyelashes_shader":
            material.update(alphaMode="MASK", alphaCutoff=0.25, doubleSided=True)
            pbr = material["pbrMetallicRoughness"]
            pbr["baseColorTexture"] = {"index": lash_texture}
            pbr["baseColorFactor"] = [1, 1, 1, 1]
            repaired_materials[index] = copy.deepcopy(material)
        elif material.get("name") == "WorldGridMaterial":
            material.update(alphaMode="MASK", alphaCutoff=0.12)
            repaired_materials[index] = copy.deepcopy(material)
    if len(repaired_materials) != 2:
        raise ValueError("Expected the C6 eyelash and hair materials")

    # Rebuild views in their original index order. All references stay valid because
    # only view offsets and encoded image lengths change; each start is 4-byte aligned.
    binary = bytearray()
    for index, view in enumerate(optimized["bufferViews"]):
        binary.extend(b"\0" * (-len(binary) % 4))
        payload = replacements.get(index)
        if payload is None:
            payload = view_bytes(original, original_binary, index)
        view["byteOffset"] = len(binary)
        view["byteLength"] = len(payload)
        binary.extend(payload)
    optimized["buffers"][0]["byteLength"] = len(binary)
    write_glb(args.output, optimized, bytes(binary))
    actual_document, actual_binary = read_glb(args.output)
    validate_preservation(original, original_binary, actual_document, actual_binary, set(replacements), repaired_materials)
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != source_hash:
        raise ValueError("Source file unexpectedly changed")

    triangles = sum(original["accessors"][primitive["indices"]]["count"] // 3 for mesh in original.get("meshes", []) for primitive in mesh["primitives"] if primitive.get("mode", 4) == 4 and "indices" in primitive)
    print(json.dumps({"source_sha256": source_hash, "output_sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(), "source_bytes": args.source.stat().st_size, "output_bytes": args.output.stat().st_size, "meshes": len(original.get("meshes", [])), "materials": len(original.get("materials", [])), "skins": len(original.get("skins", [])), "triangles": triangles, "accessors": len(original.get("accessors", [])), "non_image_buffer_views_unchanged": len(original["bufferViews"]) - len(original["images"]), "repaired_materials": [m["name"] for m in repaired_materials.values()], "images": image_report}, indent=2))


if __name__ == "__main__":
    main()
