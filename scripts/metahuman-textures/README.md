# Recovered Evia texture inputs

These PNGs are inputs to `prepare-evia-metahuman.py`. They repair texture information missing or misinterpreted in the supplied `C6.glb`; the converter embeds them without changing geometry or UVs.

## Eyelashes

`eyelashes.png` is a pixel-identical copy of the recovered 2,048 × 2,048 RGBA `C5_Eyelashes_Color.png`. Its RGB is the original dark brown `(26, 18, 15)`, with strand coverage in alpha.

The saved `C5_Eyelashes_Color.png.png` and `C6_Eyelashes_Color.png.png` thumbnails are pixel-identical. Box-downsampling the recovered full C5 atlas reproduces the C6 thumbnail alpha within one 8-bit level. C6 and C1 lash UV arrays are also byte-identical. This supports using the recovered C5/C6 atlas family; the available C2/C4 atlas has different strand artwork and was not used. The original full-resolution C6 lash texture was not present in the GLB, so its exact full-resolution identity cannot be verified.

SHA-256:

```text
4f9a3c427794b55f3c2787ab4a832acbb274f1cc5ebec78e191bf664276adebd
```

## Hair

`hair-updo-buns.png` is a 1,024 × 1,024 RGBA texture derived from `C6_Hair_S_UpdoBuns_cov.npy` and `C6_Hair_S_UpdoBuns_field.npy`. Those 2,048 × 2,048 arrays contain finite coverage and depth-like field values in `[0, 1]`. Their source, `C6_Hair_S_UpdoBuns_CardsAtlas_Attribute.png`, has pixel-identical RGBA data to the 4,096-pixel hair image embedded in the supplied `C6.glb`.

The earlier `atlas_decode.py` tool estimated a smooth background field `F` from the packed alpha `A`, then reconstructed strand coverage as `C = clamp((A - F) / 76.5, 0, 1)`. It normalized the field on covered strands for shading. The earlier `hair_tex.py` method lightly smooths coverage, box-averages it to 1,024 pixels, shades strands with `0.62 + 0.38 × field`, averages RGB by coverage, and fills gap colors from neighboring strands before sRGB encoding. Alpha stores coverage; the GLB material supplies the original hair tint.

This is a reconstruction from the exported Attribute atlas, not a recovered original opacity map or original hair-color map. Dense strand ribbons can have underestimated coverage because their background field is obscured. Alpha masking and mip filtering may also reduce very fine strands at a distance.

SHA-256:

```text
e457448201caf83d243ea9939ed2a9be855d535372c9fd33b8b5083389fdc5b8
```
