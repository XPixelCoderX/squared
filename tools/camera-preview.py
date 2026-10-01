#!/usr/bin/env python3
"""Camera preview renderer for CUBIC (development helper).

Mirrors the exact camera framing used by src/three/geometry.ts so the composed
views can be eyeballed without a browser or GPU: the nine layer views that the
"game lock" animates to, plus the overview.

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pillow
    /tmp/venv/bin/python tools/camera-preview.py

Keep the numbers here in sync with src/three/geometry.ts (ALONG, LATERAL,
DEFAULT_CAMERA_RADIUS) when tuning the camera.
"""
import math
from PIL import Image, ImageDraw, ImageFont

W, H = 640, 360
FOV = 45.0
RADIUS = 6.2

LATERAL = [
    (0.0, 0.38, 0.92),
    (0.16, 0.0, 0.99),
    (0.52, 0.38, 0.0),
]
AXIS = [(1, 0, 0), (0, 1, 0), (0, 0, 1)]


def norm(v):
    l = math.sqrt(sum(c * c for c in v))
    return tuple(c / l for c in v)


LATERAL = [norm(v) for v in LATERAL]


def cell_pos(i):
    x, y, z = i % 3, (i // 3) % 3, (i // 9) % 3
    return (x - 1, y - 1, z - 1)


def idx(x, y, z):
    return x + 3 * y + 9 * z


def layer_dir(family, offset):
    axis = AXIS[family]
    sign = -1 if offset == 0 else 1
    along = 0.80
    lat = LATERAL[family]
    return norm(tuple(axis[k] * sign * along + lat[k] * math.sqrt(max(0.0, 1 - along * along)) for k in range(3)))


def layer_up(family, offset):
    """screen-up: the far side of the layer, orthogonalised against the view dir"""
    lat = LATERAL[family]
    d = layer_dir(family, offset)
    dot = sum(-lat[k] * d[k] for k in range(3))
    u = tuple(-lat[k] - d[k] * dot for k in range(3))
    return norm(u)


def layer_target(family, offset):
    """look straight at the centre of the layer's 3x3 grid"""
    return tuple(AXIS[family][k] * (offset - 1) for k in range(3))


def overview_dir():
    return norm((0.72, 0.5, 0.92))


def look_matrix(eye, target, up=(0, 1, 0)):
    z = norm(tuple(eye[i] - target[i] for i in range(3)))
    x = norm((
        up[1] * z[2] - up[2] * z[1],
        up[2] * z[0] - up[0] * z[2],
        up[0] * z[1] - up[1] * z[0],
    ))
    y = (
        z[1] * x[2] - z[2] * x[1],
        z[2] * x[0] - z[0] * x[2],
        z[0] * x[1] - z[1] * x[0],
    )
    return x, y, z, eye


def project(p, cam, w=W, h=H):
    x, y, z, eye = cam
    d = (p[0] - eye[0], p[1] - eye[1], p[2] - eye[2])
    vx = x[0] * d[0] + x[1] * d[1] + x[2] * d[2]
    vy = y[0] * d[0] + y[1] * d[1] + y[2] * d[2]
    vz = z[0] * d[0] + z[1] * d[1] + z[2] * d[2]
    if vz > -0.05:
        return None
    f = 1.0 / math.tan(math.radians(FOV) / 2)
    aspect = w / h
    nx = (f / aspect) * vx / (-vz)
    ny = f * vy / (-vz)
    return ((nx * 0.5 + 0.5) * w, (1 - (ny * 0.5 + 0.5)) * h, -vz)


def layer_cells(family, offset):
    return [i for i in range(27) if ((i % 3, (i // 3) % 3, (i // 9) % 3)[family]) == offset]


def draw_scene(draw, cam, family, offset, board, w=W, h=H, title="", plate=True, background=True):
    # backdrop
    if background:
        draw.rectangle([0, 0, w, h], fill=(6, 8, 16))
    else:
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # active layer plate
    corners = []
    if plate:
        for a, b in [(0, 0), (2, 0), (2, 2), (0, 2)]:
            p = [0, 0, 0]
            p[family] = offset - 1
            others = [k for k in range(3) if k != family]
            p[others[0]] = a - 1
            p[others[1]] = b - 1
            pr = project(tuple(p), cam, w, h)
            if pr:
                corners.append(pr[:2])
    if len(corners) == 4:
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.polygon(corners, fill=(121, 242, 168, 40))
        od.line(corners + [corners[0]], fill=(121, 242, 168, 200), width=3)

    # cube wireframe
    c = 1.5
    for ax in range(3):
        for a in (-c, c):
            for b in (-c, c):
                p0 = [0, 0, 0]
                p1 = [0, 0, 0]
                others = [k for k in range(3) if k != ax]
                p0[ax] = -c
                p1[ax] = c
                p0[others[0]] = p1[others[0]] = a
                p0[others[1]] = p1[others[1]] = b
                pr0 = project(tuple(p0), cam, w, h)
                pr1 = project(tuple(p1), cam, w, h)
                if pr0 and pr1:
                    draw.line([pr0[:2], pr1[:2]], fill=(70, 84, 120), width=1)

    # markers
    far = []
    near = []
    active = set(layer_cells(family, offset))
    for i in range(27):
        pr = project(cell_pos(i), cam, w, h)
        if not pr:
            continue
        (far if i not in active else near).append((i, pr))

    for i, (sx, sy, depth) in far:
        value = board[i]
        scale = 12.5 / depth
        if value:
            col = (255, 77, 109, 110) if value == 1 else (56, 213, 255, 110)
            r = scale
            if value == 1:
                draw.polygon([(sx, sy - r), (sx + r, sy), (sx, sy + r), (sx - r, sy)],
                             outline=col, fill=(col[0] // 3, col[1] // 3, col[2] // 3))
            else:
                draw.ellipse([sx - r, sy - r, sx + r, sy + r], outline=col,
                             fill=(col[0] // 3, col[1] // 3, col[2] // 3))

    for i, (sx, sy, depth) in near:
        value = board[i]
        scale = 12.5 / depth
        if value == 0:
            r = scale * 1.05
            draw.ellipse([sx - r, sy - r, sx + r, sy + r], outline=(200, 214, 255), width=2)
        else:
            r = scale
            if value == 1:
                draw.polygon([(sx, sy - r), (sx + r, sy), (sx, sy + r), (sx - r, sy)],
                             fill=(255, 77, 109), outline=(255, 150, 170))
            else:
                draw.ellipse([sx - r, sy - r, sx + r, sy + r], fill=(56, 213, 255),
                             outline=(160, 235, 255))

    if title:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
        except Exception:
            font = ImageFont.load_default()
        draw.text((12, h - 24), title, fill=(220, 228, 250), font=font)

    return overlay if len(corners) == 4 else None


def render(family, offset, board, title, radius=RADIUS, w=W, h=H):
    base = Image.new("RGBA", (w, h), (6, 8, 16, 255))
    d = layer_dir(family, offset)
    t = layer_target(family, offset)
    eye = tuple(t[k] + d[k] * radius for k in range(3))
    cam = look_matrix(eye, t, layer_up(family, offset))

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    corners = []
    for a, b in [(0, 0), (2, 0), (2, 2), (0, 2)]:
        p = [0, 0, 0]
        p[family] = offset - 1
        others = [k for k in range(3) if k != family]
        p[others[0]] = a - 1
        p[others[1]] = b - 1
        pr = project(tuple(p), cam, w, h)
        if pr:
            corners.append(pr[:2])
    if len(corners) == 4:
        od.polygon(corners, fill=(121, 242, 168, 42))
        od.line(corners + [corners[0]], fill=(121, 242, 168, 205), width=3)
    img = Image.alpha_composite(base, overlay).convert("RGB")
    draw = ImageDraw.Draw(img)
    # model behind the plate, then the plate's cells, then the plate again on top
    draw_scene(draw, cam, family, offset, board, title=title, w=w, h=h, plate=False)
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    return img


def main():
    # a plausible mid game: a few marks in each family of layers
    board = [0] * 27
    board[idx(1, 1, 1)] = 1
    board[idx(0, 0, 0)] = 2
    board[idx(2, 2, 2)] = 1
    board[idx(2, 0, 1)] = 2
    board[idx(0, 2, 1)] = 1
    board[idx(1, 0, 2)] = 2
    board[idx(0, 1, 2)] = 1

    families = {0: "x", 1: "y", 2: "z"}
    panels = []
    for family in range(3):
        for offset in range(3):
            panels.append(render(family, offset, board, f"{families[family].upper()}{offset}  view"))

    sheet = Image.new("RGB", (W * 3, H * 3), (3, 4, 9))
    for i, panel in enumerate(panels):
        sheet.paste(panel, ((i % 3) * W, (i // 3) * H))
    sheet.save("camera-preview-layers.png")

    # overview
    img = render(1, 1, board, "overview", radius=6.4, w=W * 2, h=H * 2)
    img.save("camera-preview-overview.png")


if __name__ == "__main__":
    main()
