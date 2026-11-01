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
    rose = (244, 63, 94, 255) if action == "install" else (251, 113, 133, 255)
    rows = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            radius = 44
            corner_x = min(x, SIZE - 1 - x)
            corner_y = min(y, SIZE - 1 - y)
            outside = corner_x < radius and corner_y < radius and (corner_x - radius) ** 2 + (corner_y - radius) ** 2 > radius ** 2
            if outside:
                row.append((0, 0, 0, 0)); continue
            glow = max(0.0, 1.0 - ((x - 80) ** 2 + (y - 60) ** 2) ** .5 / 260)
            base = (13 + round(18 * glow), 16 + round(8 * glow), 27 + round(15 * glow), 255)
            border = min(x, y, SIZE - 1 - x, SIZE - 1 - y)
            if border < 4: base = blend(base, rose, .7)
            row.append(base)
        rows.append(row)

    def paint_polygon(points, color, alpha=1.0):
        left, right = int(min(p[0] for p in points)), int(max(p[0] for p in points))
        top, bottom = int(min(p[1] for p in points)), int(max(p[1] for p in points))
        for y in range(max(0, top), min(SIZE, bottom + 1)):
            for x in range(max(0, left), min(SIZE, right + 1)):
                if inside_polygon(x + .5, y + .5, points): rows[y][x] = blend(rows[y][x], color, alpha)

    # Triple-sided monogram: three rising facets with a clean negative-space S.
    paint_polygon([(42, 68), (118, 38), (102, 80), (42, 104)], rose)
    paint_polygon([(104, 84), (190, 50), (177, 91), (90, 126)], (255, 255, 255, 255), .96)
    paint_polygon([(61, 130), (155, 93), (141, 137), (48, 174)], rose)
    paint_polygon([(139, 141), (210, 113), (194, 158), (123, 186)], (255, 255, 255, 255), .96)

    # A compact action badge makes installer and uninstaller immediately distinct.
    badge_center = (190, 194)
    for y in range(155, 234):
        for x in range(151, 230):
            distance = ((x - badge_center[0]) ** 2 + (y - badge_center[1]) ** 2) ** .5
            if distance <= 37: rows[y][x] = blend(rows[y][x], rose, 1 if distance < 34 else .55)
    if action == "install":
        paint_polygon([(181, 172), (199, 172), (199, 195), (210, 195), (190, 216), (170, 195), (181, 195)], (255, 255, 255, 255))
    else:
        paint_polygon([(171, 180), (178, 173), (190, 186), (202, 173), (209, 180), (197, 193), (209, 206), (202, 213), (190, 200), (178, 213), (171, 206), (183, 193)], (255, 255, 255, 255))
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
