#!/usr/bin/env python3
"""Generate PNG app icons for PWA from SVG source."""
import struct, zlib, math, os

def write_png(filename, size):
    """Write a simple PNG icon: indigo rounded square + white sprout."""
    w = h = size
    pixels = []

    # Colors
    BG    = (79, 70, 229)   # indigo-600
    WHITE = (255, 255, 255)
    TRANSP = (0, 0, 0, 0)

    radius = int(size * 0.215)  # corner radius ~22% of size

    def in_rounded_rect(x, y, r):
        cx, cy = w/2, h/2
        half = w/2
        dx = max(abs(x - cx) - (half - r), 0)
        dy = max(abs(y - cy) - (half - r), 0)
        return (dx*dx + dy*dy) <= r*r

    # Sprout path: scale lucide sprout icon (24x24 viewBox) to our size
    scale = size / 24.0

    def dist_to_line(px, py, ax, ay, bx, by):
        dx, dy = bx-ax, by-ay
        if dx==0 and dy==0: return math.hypot(px-ax, py-ay)
        t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx+dy*dy)))
        return math.hypot(px - (ax+t*dx), py - (ay+t*dy))

    def dist_to_quadratic(px, py, ax, ay, cx2, cy2, bx, by, steps=20):
        mn = 1e9
        for i in range(steps+1):
            t = i/steps
            qx = (1-t)**2*ax + 2*(1-t)*t*cx2 + t**2*bx
            qy = (1-t)**2*ay + 2*(1-t)*t*cy2 + t**2*by
            mn = min(mn, math.hypot(px-qx, py-qy))
        return mn

    # Stroke width proportional to size
    sw = size * 2.0 / 24.0  # 2px at 24-unit scale

    def on_sprout(x, y):
        """Returns True if pixel (x,y) is on the sprout stroke (scaled from 24x24 to size x size)."""
        # Convert pixel coords to 24-unit space
        u = x / scale
        v = y / scale

        half = sw / 2

        # Line: M7 20 H17  (bottom stem base)
        if dist_to_line(u, v, 7, 20, 17, 20) < half: return True

        # Leaf curve: M10 20 C15.5 17.5 18.5 14 18 8 H5.5 C5 14 8 17.5 10 20
        # Approximate as two quadratic beziers
        if dist_to_quadratic(u, v, 10,20, 15,17, 18,8, steps=30) < half: return True
        if dist_to_quadratic(u, v, 10,20, 7,17, 5.5,8, steps=30) < half: return True
        # Bottom of leaf (straight-ish)
        if dist_to_line(u, v, 5.5, 8, 18, 8) < half: return True

        # Left stem curve: M5.5 8 C5 5.5 6 3 7.5 1.5
        if dist_to_quadratic(u, v, 5.5,8, 5.5,4.5, 7.5,1.5, steps=20) < half: return True

        # Right stem curve: M15 8 C15.5 5.5 14.5 3 12.5 1.5
        if dist_to_quadratic(u, v, 15,8, 15.5,4.5, 12.5,1.5, steps=20) < half: return True

        # Vertical stem: from ~12,20 up to ~12,8
        if dist_to_line(u, v, 12, 20, 12, 8) < half*0.8: return True

        return False

    # Build RGBA pixel rows
    rows = []
    for y in range(h):
        row = []
        for x in range(w):
            if in_rounded_rect(x, y, radius):
                if on_sprout(x, y):
                    row += [WHITE[0], WHITE[1], WHITE[2], 255]
                else:
                    row += [BG[0], BG[1], BG[2], 255]
            else:
                row += [0, 0, 0, 0]
        rows.append(bytes(row))

    # Encode PNG
    def png_chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    raw = b''
    for row in rows:
        raw += b'\x00' + row  # filter type 0 (None) per row

    compressed = zlib.compress(raw, 9)

    png = b'\x89PNG\r\n\x1a\n'
    png += png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))  # 8-bit RGBA
    png += png_chunk(b'IDAT', compressed)
    png += png_chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(png)
    print(f"  [OK] {filename} ({size}x{size})")

out_dir = 'C:/GUYAPP/farm-flow/farm-flow-49ecc86e/public/icons'
os.makedirs(out_dir, exist_ok=True)

print("Generating PWA icons...")
write_png(f'{out_dir}/icon-192.png', 192)
write_png(f'{out_dir}/icon-512.png', 512)
write_png(f'{out_dir}/apple-touch-icon.png', 180)
write_png(f'{out_dir}/favicon-32.png', 32)
print("Done!")
