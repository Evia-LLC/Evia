# Evia MetaHuman asset

`evia-metahuman.glb` is a web copy of the supplied `C6.glb` nurse character. The original file is unchanged. This copy reduces embedded texture size and repairs the exported eyelash and hair materials while preserving all geometry, skin weights, rigs, UVs, and node transforms.

| Property | Value |
| --- | --- |
| Original size | 109,197,784 bytes |
| Web copy size | 17,901,520 bytes (83.6% smaller) |
| Meshes / materials | 12 / 12 |
| Triangles | 214,716 |
| Skins | 3 (342, 876, and 435 joints) |
| Accessors | 95 |
| Embedded images | 12 |
| Animation clips / morph targets | None in the supplied export |

Color maps and the head normal map retain up to 2,048-pixel detail. Body, eye, teeth, and outfit normal maps use 1,024 pixels. Opaque maps use JPEG quality 92 without chroma subsampling. The repaired hair atlas is a 1,024-pixel RGBA PNG, and the recovered eyelash atlas is a 2,048-pixel RGBA PNG. Texture compression is lossy; all 95 non-image buffer views remain byte-for-byte identical to the original.

The export omitted the eyelash texture and treated a packed hair Attribute atlas as color and opacity. The eyelash repair uses the recovered C5 atlas from the matching C5/C6 family: their saved thumbnails are pixel-identical, and C6 shares the standard lash UV layout. The hair repair uses coverage reconstructed from C6's own Attribute atlas. This is an estimate of strand opacity, not the original authored opacity; the decoder can undercount coverage in dense ribbons. Both materials use alpha masking, and the original hair tint is retained. See [texture provenance](../../../scripts/metahuman-textures/README.md) for the inputs and method.

The conversion preserves source transforms, including the hair transform. Runtime model adaptation is separate from this asset. The export contains skeletal face controls but no authored animation clips or blend shapes.

## Recreate

Install Pillow in the Python environment, then run from the repository root:

```sh
python3 scripts/prepare-evia-metahuman.py /path/to/C6.glb
```

The script uses the bundled PNG inputs in `scripts/metahuman-textures/` and defaults to this output path. It rejects an output path equal to the source, rebuilds each buffer view with four-byte alignment, and verifies all 95 non-image buffer views and the scene metadata against the original. The two expected material repairs are checked separately. It also reopens every output image and checks that the source hash is unchanged. Optional `--output`, `--max-texture-size`, `--normal-texture-size`, `--jpeg-quality`, `--hair-texture`, and `--eyelash-texture` arguments allow alternate copies.

SHA-256 of the source:

```text
885d11188cdeee64a5b1c118a9704f6ff8e14b8a9d1269f52aab795025c1c92f
```

SHA-256 of this web copy:

```text
20659f9f9f64ba8edef35dabb134baa130a0681d4c3b0a8ccda0e8f540781502
```

The exact compressed bytes can vary with Pillow/libjpeg versions even when settings and visual output match.
