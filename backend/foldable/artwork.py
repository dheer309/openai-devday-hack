"""One procedural line drawing, shared by 3D texture and paper projection."""
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Polygon


def face_paths(design, solid):
    lo, hi = solid.vertices.min(axis=0), solid.vertices.max(axis=0)
    w, h = (hi - lo)[:2]
    cy = -0.10 * h if getattr(design, "ears", "none") == "pointed" else 0
    paths = []

    def path(points):
        paths.append(np.array([[x*w, cy+y*h] for x, y in points], dtype=float))

    def ellipse(x, y, rx, ry, start=0, end=2*np.pi):
        a = np.linspace(start, end, 49)
        path(list(zip(x + rx*np.cos(a), y + ry*np.sin(a))))

    for eye_x in (-0.16, 0.16):
        if design.face.eyes == "round":
            ellipse(eye_x, 0.07, 0.035, 0.045)
        elif design.face.eyes == "happy":
            ellipse(eye_x, 0.04, 0.055, 0.045, 0, np.pi)
        else:
            path([(eye_x-0.055, 0.085), (eye_x+0.055, 0.055)])
            path([(eye_x+0.03, 0.06), (eye_x+0.025, 0.03)])
    if design.face.mouth == "open":
        ellipse(0, -0.12, 0.045, 0.055)
    elif design.face.mouth == "neutral":
        path([(-0.065, -0.12), (0.065, -0.12)])
    else:
        ellipse(0, -0.075, 0.075, 0.055, np.pi, 2*np.pi)
    if design.face.whiskers:
        path([(-0.025, -0.015), (0.025, -0.015), (0, -0.04), (-0.025, -0.015)])
        for sign in (-1, 1):
            for slope in (-0.035, 0, 0.035):
                path([(sign*0.22, -0.05), (sign*0.34, -0.05+slope)])
    if design.face.markings == "freckles":
        for x in (-0.24, -0.19, 0.19, 0.24):
            ellipse(x, -0.06, 0.008, 0.008)
    elif design.face.markings == "forehead_patch":
        path([(-0.08, 0.27), (-0.04, 0.20), (0, 0.25), (0.04, 0.20), (0.08, 0.27)])
    return paths


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [np.array(geometry.coords)]
    if hasattr(geometry, "geoms"):
        return [p for g in geometry.geoms for p in line_parts(g)]
    return []


def projected_art(design, net):
    """Yield (face id, 3D path, paper path); clip across visible front panels."""
    for f, panel in enumerate(net.solid.panels):
        if panel.normal[2] <= 1e-6:
            continue
        front_polygon = Polygon(net.solid.vertices[list(panel.vertices), :2])
        if front_polygon.area < 1e-6:
            continue
        for source in face_paths(design, net.solid):
            for xy in line_parts(LineString(source).intersection(front_polygon)):
                n = panel.normal
                z = (np.dot(n, panel.origin) - xy @ n[:2]) / n[2]
                world = np.column_stack((xy, z))
                relative = world - panel.origin
                local = np.column_stack((relative @ panel.u, relative @ panel.v))
                placed = net.placed[f]
                paper = local @ placed.rotation.T + placed.offset
                yield f, world, paper


def texture(design, solid):
    image = Image.new("RGB", (1024, 1024), "white")
    draw = ImageDraw.Draw(image)
    lo, hi = solid.vertices.min(axis=0), solid.vertices.max(axis=0)

    def uv(xy):
        return 0.1 + 0.8 * (np.asarray(xy)-lo[:2]) / (hi-lo)[:2]

    for line in face_paths(design, solid):
        pts = uv(line)
        pixels = [(float(u*1023), float((1-v)*1023)) for u, v in pts]
        width = max(2, round(0.4/(hi[0]-lo[0])*0.8*1024))
        draw.line(pixels, fill="black", width=width, joint="curve")
    return image, uv
