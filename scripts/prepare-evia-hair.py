#!/usr/bin/env python3
"""Rebuild C6's 2K web hair atlas from its decoded coverage and field arrays.

Requires numpy and Pillow. Inputs are the recovered C6_Hair_S_UpdoBuns_cov.npy
and C6_Hair_S_UpdoBuns_field.npy, not the packed Attribute PNG. The source
arrays and the original MetaHuman are never modified.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def box_axis(values, axis):
    padding = [(0, 0)] * values.ndim
    padding[axis] = (2, 1)
    summed = np.cumsum(np.pad(values, padding, mode="edge"), axis=axis, dtype=np.float64)
    count = values.shape[axis]
    hi = np.take(summed, np.arange(3, 3 + count), axis=axis)
    lo = np.take(summed, np.arange(count), axis=axis)
    return ((hi - lo) / 3).astype(np.float32)


def fill_gap_colors(rgb, alpha):
    """Fill transparent texels from neighboring strands to prevent dark mips."""
    weight = (alpha > 0.02).astype(np.float32)
    pyramid = [(rgb * weight[..., None], weight)]
    for _ in range(8):
        color, weight = pyramid[-1]
        if color.shape[0] < 4:
            break
        height, width = color.shape[0] // 2, color.shape[1] // 2
        color = color[:height * 2, :width * 2].reshape(height, 2, width, 2, 3).sum((1, 3))
        weight = weight[:height * 2, :width * 2].reshape(height, 2, width, 2).sum((1, 3))
        pyramid.append((color, weight))
    filled = None
    for color, weight in reversed(pyramid):
        normalized = color / np.maximum(1e-6, weight[..., None])
        if filled is None:
            filled = normalized
        else:
            up = np.repeat(np.repeat(filled, 2, 0), 2, 1)[:color.shape[0], :color.shape[1]]
            strength = np.clip(weight, 0, 1)[..., None]
            filled = normalized * strength + up * (1 - strength)
    return filled


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("coverage", type=Path)
    parser.add_argument("field", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "metahuman-textures/hair-updo-buns.png")
    args = parser.parse_args()
    if args.output.resolve() in (args.coverage.resolve(), args.field.resolve()):
        parser.error("Output must not replace either source array")
    coverage = np.load(args.coverage, allow_pickle=False).astype(np.float32)
    field = np.load(args.field, allow_pickle=False).astype(np.float32)
    for array in (coverage, field):
        if array.shape != (2048, 2048) or not np.isfinite(array).all() or array.min() < 0 or array.max() > 1:
            parser.error("Expected finite 2048×2048 arrays in [0, 1]")
    alpha = coverage.copy()
    # Three one-pixel box passes soften individual strand edges, preserving the
    # 2K grid. A gentle coverage curve keeps fine strands through mip filtering.
    for _ in range(3):
        alpha = box_axis(box_axis(alpha, 0), 1)
    alpha = np.clip(alpha, 0, 1) ** 0.85
    shade = 0.32 + 0.68 * field
    rgb = fill_gap_colors(np.stack([shade, shade * 0.965, shade * 0.93], -1), alpha)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, 1), 1 / 2.4) - 0.055)
    pixels = np.concatenate([np.clip(srgb * 255 + 0.5, 0, 255), np.clip(alpha[..., None] * 255 + 0.5, 0, 255)], -1).astype(np.uint8)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, "RGBA").save(args.output, optimize=True)
    print(f"Saved {args.output}: 2048×2048, mean coverage {alpha.mean():.6f}")


if __name__ == "__main__":
    main()
