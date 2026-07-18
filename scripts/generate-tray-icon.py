#!/usr/bin/env python3
"""Generate the macOS menu-bar template icon (cat head, black + alpha) as PNG.

Usage: python3 scripts/generate-tray-icon.py
Writes assets/tray/trayIconTemplate.png (18x18) and @2x (36x36).
"""

import struct
import zlib
from pathlib import Path


def render(size):
    scale = size / 36.0
    head_cx, head_cy, head_r = 18 * scale, 21 * scale, 11 * scale
    eye_r = 2.2 * scale
    eyes = [(13.5 * scale, 20 * scale), (22.5 * scale, 20 * scale)]
    # Ear triangles: (tip, base-left, base-right)
    ears = [
        ((9 * scale, 4 * scale), (7 * scale, 14 * scale), (16 * scale, 10 * scale)),
        ((27 * scale, 4 * scale), (29 * scale, 14 * scale), (20 * scale, 10 * scale)),
    ]

    def in_triangle(px, py, tri):
        (ax, ay), (bx, by), (cx, cy) = tri
        d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
        d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
        d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
        has_neg = d1 < 0 or d2 < 0 or d3 < 0
        has_pos = d1 > 0 or d2 > 0 or d3 > 0
        return not (has_neg and has_pos)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            inside = (px - head_cx) ** 2 + (py - head_cy) ** 2 <= head_r ** 2
            inside = inside or any(in_triangle(px, py, tri) for tri in ears)
            if inside and any(
                (px - ex) ** 2 + (py - ey) ** 2 <= eye_r ** 2 for ex, ey in eyes
            ):
                inside = False
            row += b"\x00\x00\x00\xff" if inside else b"\x00\x00\x00\x00"
        rows.append(row)
    return rows


def write_png(target, size):
    rows = render(size)
    raw = b"".join(b"\x00" + bytes(row) for row in rows)

    def chunk(tag, data):
        block = tag + data
        return struct.pack(">I", len(data)) + block + struct.pack(">I", zlib.crc32(block))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    target.write_bytes(png)
    print(f"wrote {target} ({size}x{size})")


def main():
    out_dir = Path(__file__).resolve().parent.parent / "assets" / "tray"
    out_dir.mkdir(parents=True, exist_ok=True)
    write_png(out_dir / "trayIconTemplate.png", 18)
    write_png(out_dir / "trayIconTemplate@2x.png", 36)


if __name__ == "__main__":
    main()
