import math
import os

from PIL import Image, ImageDraw

BG = (11, 16, 32)
TRACK = (26, 35, 56)
ACCENT = (96, 165, 250)
ACCENT2 = (34, 211, 238)
NEEDLE = (238, 242, 255)

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "icons")


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), BG + (255,))
    draw = ImageDraw.Draw(img)

    if not maskable:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        radius = int(size * 0.22)
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG + (255,))

    scale = 0.72 if maskable else 0.86
    cx = cy = size / 2
    radius = size * 0.5 * scale * 0.72
    width = max(2, int(size * 0.07))
    bbox = [cx - radius, cy - radius, cx + radius, cy + radius]

    draw.arc(bbox, start=135, end=405, fill=TRACK, width=width)

    start = 135
    end = 352
    steps = 120
    for i in range(steps):
        a0 = start + (end - start) * i / steps
        a1 = start + (end - start) * (i + 1) / steps + 0.5
        draw.arc(bbox, start=a0, end=a1, fill=lerp(ACCENT, ACCENT2, i / max(1, steps - 1)), width=width)

    angle = math.radians(end)
    inner = width * 0.6
    ex = cx + math.cos(angle) * (radius - inner)
    ey = cy + math.sin(angle) * (radius - inner)
    draw.line([cx, cy, ex, ey], fill=NEEDLE, width=max(2, int(size * 0.038)))

    dot = size * 0.045
    draw.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=ACCENT2)

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    draw_icon(192).save(os.path.join(OUT_DIR, "icon-192.png"))
    draw_icon(512).save(os.path.join(OUT_DIR, "icon-512.png"))
    draw_icon(512, maskable=True).save(os.path.join(OUT_DIR, "icon-maskable-512.png"))
    print("icons written to", OUT_DIR)


if __name__ == "__main__":
    main()
