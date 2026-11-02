#!/usr/bin/env python3
"""Generate polished, deterministic TripleSide installer icons."""
from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DESIGN_SIZE = 1024
OUTPUT_SIZE = 256
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_TYPES = {16: b"icp4", 32: b"icp5", 64: b"icp6", 128: b"ic07", 256: b"ic08"}
THEME_RED = (225, 29, 72)  # Website #E11D48.


def png_bytes(image: Image.Image, size: int) -> bytes:
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    resized.save(output, format="PNG", optimize=True, compress_level=9)
    return output.getvalue()


def brand_font(size: int) -> ImageFont.FreeTypeFont:
    path = Path(__file__).resolve().parents[1] / "Assets/fonts/Outfit-wght.ttf"
    font = ImageFont.truetype(str(path), size)
    try:
        font.set_variation_by_name("Black")
    except OSError:
        pass
    return font


def render(action: str) -> Image.Image:
    image = Image.new("RGBA", (DESIGN_SIZE, DESIGN_SIZE), (0, 0, 0, 0))
    circle = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = circle.load()
    center = DESIGN_SIZE / 2
    radius = 482
    for y in range(DESIGN_SIZE):
        vertical = y / (DESIGN_SIZE - 1)
        for x in range(DESIGN_SIZE):
            distance = ((x + .5 - center) ** 2 + (y + .5 - center) ** 2) ** .5
            coverage = max(0.0, min(1.0, radius + 1 - distance))
            if not coverage:
                continue
            highlight = max(0.0, 1.0 - (((x - 330) / 760) ** 2 + ((y - 230) / 680) ** 2) ** .5)
            shade = .13 * vertical
            red = round(THEME_RED[0] * (1 - shade) + 190 * shade + 16 * highlight)
            green = round(THEME_RED[1] * (1 - shade) + 18 * shade + 8 * highlight)
            blue = round(THEME_RED[2] * (1 - shade) + 60 * shade + 9 * highlight)
            pixels[x, y] = (min(255, red), min(255, green), min(255, blue), round(255 * coverage))
    image.alpha_composite(circle)

    decoration = Image.new("RGBA", image.size, (0, 0, 0, 0))
    decoration_draw = ImageDraw.Draw(decoration, "RGBA")
    decoration_draw.ellipse((48, 48, 976, 976), outline=(255, 255, 255, 70), width=9)
    decoration_draw.ellipse((63, 63, 961, 961), outline=(120, 0, 35, 80), width=5)
    image.alpha_composite(decoration)
    draw = ImageDraw.Draw(image, "RGBA")

    # Match the website favicon with a genuine Outfit Black "3S" wordmark.
    font = brand_font(365)
    text = "3S"
    bounds = draw.textbbox((0, 0), text, font=font, stroke_width=0)
    text_width = bounds[2] - bounds[0]
    draw.text(((DESIGN_SIZE - text_width) / 2 - bounds[0], 155 - bounds[1]), text, font=font, fill=(255, 255, 255, 255))

    # A restrained action mark keeps install and uninstall easy to distinguish.
    if action == "install":
        draw.rounded_rectangle((479, 620, 545, 790), radius=28, fill=(255, 255, 255, 255))
        draw.polygon(((404, 755), (620, 755), (512, 872)), fill=(255, 255, 255, 255))
        draw.rounded_rectangle((365, 882, 659, 913), radius=15, fill=(255, 255, 255, 255))
    else:
        draw.line((420, 690, 604, 874), fill=(255, 255, 255, 255), width=66)
        draw.line((604, 690, 420, 874), fill=(255, 255, 255, 255), width=66)
    return image


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "packaging/icons"
    output.mkdir(parents=True, exist_ok=True)
    for action in ("install", "uninstall"):
        image = render(action)
        pngs = {size: png_bytes(image, size) for size in ICO_SIZES}
        (output / f"tripleside-{action}.png").write_bytes(pngs[OUTPUT_SIZE])

        offset = 6 + 16 * len(ICO_SIZES)
        entries = []
        for size in ICO_SIZES:
            png = pngs[size]
            entries.append(struct.pack(
                "<BBBBHHII",
                0 if size == 256 else size,
                0 if size == 256 else size,
                0, 0, 1, 32, len(png), offset,
            ))
            offset += len(png)
        ico = struct.pack("<HHH", 0, 1, len(ICO_SIZES)) + b"".join(entries) + b"".join(pngs[size] for size in ICO_SIZES)
        (output / f"tripleside-{action}.ico").write_bytes(ico)

        elements = [kind + struct.pack(">I", len(pngs[size]) + 8) + pngs[size] for size, kind in ICNS_TYPES.items()]
        (output / f"tripleside-{action}.icns").write_bytes(
            b"icns" + struct.pack(">I", sum(map(len, elements)) + 8) + b"".join(elements)
        )


if __name__ == "__main__":
    main()
