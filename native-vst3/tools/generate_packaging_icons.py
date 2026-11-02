#!/usr/bin/env python3
"""Generate deterministic TripleSide installer icons using only the Python stdlib."""
from __future__ import annotations

import binascii
import struct
import zlib
from pathlib import Path

SIZE = 256


def blend(pixel, color, alpha=1.0):
    return tuple(round(pixel[index] * (1 - alpha) + color[index] * alpha) for index in range(4))


def inside_polygon(x, y, points):
    result = False
    previous = points[-1]
    for current in points:
        if (current[1] > y) != (previous[1] > y):
            edge = (previous[0] - current[0]) * (y - current[1]) / (previous[1] - current[1]) + current[0]
            if x < edge:
                result = not result
        previous = current
    return result


def png_bytes(rows):
    raw = b"".join(b"\0" + bytes(channel for pixel in row for channel in pixel) for row in rows)
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def render(action):
    # Website theme: a circular rose-red badge with a high-contrast white TS
    # monogram. Keep the silhouette transparent so Explorer/Finder never shows
    # the old dark rounded square around the icon.
    theme_red = (225, 29, 72, 255)  # #E11D48
    deep_red = (190, 18, 60, 255)
    white = (255, 255, 255, 255)
    rows = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            distance = ((x + .5 - SIZE / 2) ** 2 + (y + .5 - SIZE / 2) ** 2) ** .5
            edge = max(0.0, min(1.0, 123.5 - distance))
            if edge <= 0:
                row.append((0, 0, 0, 0))
                continue
            shade = max(0.0, min(1.0, (x + y) / (2 * (SIZE - 1))))
            red = tuple(round(theme_red[index] * (1 - .22 * shade) + deep_red[index] * (.22 * shade)) for index in range(3))
            row.append((*red, round(255 * edge)))
        rows.append(row)

    def paint_polygon(points, color, alpha=1.0):
        left, right = int(min(p[0] for p in points)), int(max(p[0] for p in points))
        top, bottom = int(min(p[1] for p in points)), int(max(p[1] for p in points))
        for y in range(max(0, top), min(SIZE, bottom + 1)):
            for x in range(max(0, left), min(SIZE, right + 1)):
                if inside_polygon(x + .5, y + .5, points): rows[y][x] = blend(rows[y][x], color, alpha)

    # Fine white inner ring makes the round silhouette legible on dark and
    # light desktops without changing the solid brand-red appearance.
    for y in range(SIZE):
        for x in range(SIZE):
            distance = ((x + .5 - SIZE / 2) ** 2 + (y + .5 - SIZE / 2) ** 2) ** .5
            if 114.5 <= distance <= 116.5:
                rows[y][x] = blend(rows[y][x], white, .28)

    # Bold geometric "TS" monogram, intentionally font-independent so Windows
    # ICO and macOS ICNS are generated identically on every machine.
    paint_polygon([(49, 58), (124, 58), (124, 78), (97, 78), (97, 145), (76, 145), (76, 78), (49, 78)], white)
    paint_polygon([(129, 58), (202, 58), (202, 78), (129, 78)], white)
    paint_polygon([(129, 58), (149, 58), (149, 117), (129, 117)], white)
    paint_polygon([(129, 98), (202, 98), (202, 118), (129, 118)], white)
    paint_polygon([(182, 98), (202, 98), (202, 158), (182, 158)], white)
    paint_polygon([(129, 138), (202, 138), (202, 158), (129, 158)], white)

    # Compact white action mark: down-to-device for install, X for uninstall.
    if action == "install":
        paint_polygon([(117, 169), (139, 169), (139, 195), (153, 195), (128, 220), (103, 195), (117, 195)], white)
        paint_polygon([(92, 221), (164, 221), (164, 229), (92, 229)], white)
    else:
        paint_polygon([(101, 176), (110, 167), (128, 185), (146, 167), (155, 176), (137, 194), (155, 212), (146, 221), (128, 203), (110, 221), (101, 212), (119, 194)], white)
    return png_bytes(rows)


def main():
    output = Path(__file__).resolve().parents[1] / "packaging" / "icons"
    output.mkdir(parents=True, exist_ok=True)
    for action in ("install", "uninstall"):
        png = render(action)
        (output / f"tripleside-{action}.png").write_bytes(png)
        ico_header = struct.pack("<HHH", 0, 1, 1)
        ico_entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
        (output / f"tripleside-{action}.ico").write_bytes(ico_header + ico_entry + png)
        icns_element = b"ic08" + struct.pack(">I", len(png) + 8) + png
        (output / f"tripleside-{action}.icns").write_bytes(b"icns" + struct.pack(">I", len(icns_element) + 8) + icns_element)


if __name__ == "__main__":
    main()
