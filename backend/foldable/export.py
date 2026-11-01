"""Vector print outputs and a matching GLB from the validated engine layout."""
from html import escape
import math
from pathlib import Path

import numpy as np
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from shapely.geometry import Polygon
import trimesh

from .artwork import projected_art, texture


class Drawing:
    def __init__(self):
        self.items = []

    def line(self, points, width=0.22, dashed=False):
        self.items.append({"kind": "line", "points": np.asarray(points), "width": width, "dashed": dashed})

    def text(self, x, y, text, size=7, angle=0, anchor="start", bold=False):
        self.items.append({"kind": "text", "x": x, "y": y, "text": text, "size": size,
                           "angle": angle, "anchor": anchor, "bold": bold})

    def pdf(self, path: Path, title):
        c = Canvas(str(path), pagesize=(210*mm, 297*mm), pageCompression=1)
        c.setTitle(title)
        c.setAuthor("Foldable AI")
        for item in self.items:
            c.saveState()
            if item["kind"] == "line":
                c.setLineWidth(item["width"]*mm)
                c.setLineJoin(1)
                if item["dashed"]:
                    c.setDash(1.5*mm, 0.9*mm)
                p = c.beginPath()
                for i, (x, y) in enumerate(item["points"]):
                    (p.moveTo if i == 0 else p.lineTo)(float(x)*mm, float(y)*mm)
                c.drawPath(p)
            else:
                c.setFont("Helvetica-Bold" if item["bold"] else "Helvetica", item["size"])
                c.translate(item["x"]*mm, item["y"]*mm)
                c.rotate(item["angle"])
                method = c.drawCentredString if item["anchor"] == "middle" else c.drawString
                method(0, 0, item["text"])
            c.restoreState()
        c.showPage()
        c.save()

    def svg(self, path: Path):
        out = ['<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">',
               '<rect width="210" height="297" fill="white"/>']
        for item in self.items:
            if item["kind"] == "line":
                pts = ' '.join(f'{x:.4f},{297-y:.4f}' for x, y in item["points"])
                dash = ' stroke-dasharray="1.5 .9"' if item["dashed"] else ''
                out.append(f'<polyline points="{pts}" fill="none" stroke="black" stroke-width="{item["width"]}" stroke-linejoin="round"{dash}/>')
            else:
                x, y = item["x"], 297-item["y"]
                weight = ' font-weight="bold"' if item["bold"] else ''
                out.append(f'<text x="{x:.4f}" y="{y:.4f}" font-family="Arial, Helvetica, sans-serif" font-size="{item["size"]*25.4/72:.4f}" text-anchor="{item["anchor"]}" transform="rotate({-item["angle"]:.4f} {x:.4f} {y:.4f})"{weight}>{escape(item["text"])}</text>')
        out.append('</svg>')
        path.write_text('\n'.join(out), encoding="utf-8")


def edge_angle(points):
    d = points[1]-points[0]
    angle = math.degrees(math.atan2(d[1], d[0]))
    return angle-180 if angle > 90 else angle+180 if angle < -90 else angle


def draw_net(design, net):
    d = Drawing()
    title_size = min(17, 17 * 190 * mm / max(stringWidth(design.name, "Helvetica-Bold", 17), 1))
    d.text(10, 280, design.name, size=title_size, bold=True)
    extent = np.ptp(net.solid.vertices, axis=0)
    d.text(10, 274, f'{len(net.solid.panels)} panels  /  {len(net.seams)} glue joins  /  {net.island_count} paper piece(s)', size=8)
    d.line([(10, 269), (21, 269)])
    d.text(24, 268, 'CUT', size=7)
    d.line([(43, 269), (54, 269)], dashed=True)
    d.text(57, 268, 'FOLD', size=7)
    d.text(85, 268, 'Match numbers. Glue tabs inside.', size=7)
    d.text(10, 262, 'Printed side faces out. Pre-fold all dashed lines away from the printed side.', size=7)
    for edge in sorted(net.hinges):
        face = net.solid.edges[edge][0]
        d.line(net.edge_points(face, edge), width=0.16, dashed=True)
    for seam in net.seams:
        for face in seam.faces:
            pts = net.edge_points(face, seam.edge)
            if face == seam.tab_face:
                d.line(seam.tab, width=0.24)
                d.line([seam.tab[0], seam.tab[-1]], width=0.16, dashed=True)
                center = np.array(Polygon(seam.tab).centroid.coords[0])
            else:
                d.line(pts, width=0.24)
                midpoint = pts.mean(axis=0)
                inward = net.placed[face].points.mean(axis=0)-midpoint
                inward /= np.linalg.norm(inward)
                center = midpoint + inward*2.3
            angle = edge_angle(pts)
            # Offset along the rotated text's vertical axis to center its baseline.
            radians = math.radians(angle)
            center += np.array([math.sin(radians), -math.cos(radians)]) * 0.7
            d.text(*center, str(seam.number), size=6.5, angle=angle, anchor="middle")
    for _, _, paper in projected_art(design, net):
        d.line(paper, width=0.4)
    d.line([(10, 51), (200, 51)], width=0.15)
    d.text(10, 45, 'BUILD YOUR COMPANION', size=9, bold=True)
    steps = [
        '1. Cut the solid outline; keep every numbered tab.',
        '2. Score gently with a ruler, then pre-fold the dashed lines.',
        '3. Start at the face. Glue matching numbers inside, a few at a time.',
        '4. Keep a rear opening for access. Close the last rear seam last.',
    ]
    for i, text in enumerate(steps):
        d.text(10, 39-i*4.5, text, size=7)
    d.text(10, 17, 'A4 - single-sided - Actual size / 100% - no page headers', size=7, bold=True)
    d.text(10, 12, 'Digital geometry checked. Physical assembly still requires care.', size=6.5)
    d.line([(176, 18), (196, 18)], width=0.3)
    d.line([(176, 16.5), (176, 19.5)], width=0.3)
    d.line([(196, 16.5), (196, 19.5)], width=0.3)
    d.text(186, 12, '20 mm check', size=6.5, anchor="middle")
    # Small true-geometry assembled silhouette, front view with the same artwork.
    lo, hi = net.solid.vertices.min(axis=0), net.solid.vertices.max(axis=0)
    scale = min(28/(hi[0]-lo[0]), 28/(hi[1]-lo[1]))
    center = np.array([184, 35])
    seen = set()
    for panel in net.solid.panels:
        if panel.normal[2] < -1e-6:
            continue
        for a, b in zip(panel.vertices, panel.vertices[1:]+panel.vertices[:1]):
            key = tuple(sorted((a, b)))
            if key not in seen:
                d.line(net.solid.vertices[[a, b], :2]*scale+center, width=0.12)
                seen.add(key)
    for _, world, _ in projected_art(design, net):
        d.line(world[:, :2]*scale+center, width=0.25)
    return d


def export_glb(design, net, path):
    image, uv_mapper = texture(design, net.solid)
    vertices, faces, uv = [], [], []
    for panel in net.solid.panels:
        start = len(vertices)
        points = net.solid.vertices[list(panel.vertices)]
        vertices.extend(points / 1000.0)  # glTF metres, source geometry millimetres.
        uv.extend(uv_mapper(points[:, :2]) if panel.normal[2] > 1e-6 else np.full((len(points), 2), 0.02))
        faces.extend((start, start+i, start+i+1) for i in range(1, len(points)-1))
    visual = trimesh.visual.texture.TextureVisuals(uv=np.array(uv), image=image)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, visual=visual, process=False)
    path.write_bytes(trimesh.Scene(mesh).export(file_type="glb"))


def export_all(design, net, folder):
    drawing = draw_net(design, net)
    drawing.pdf(folder / "net.pdf", design.name)
    drawing.svg(folder / "net.svg")
    export_glb(design, net, folder / "model.glb")
