"""One-sheet standing TV robot: two upstream-unfolded boxes and flat accents.

Offline demo export; deliberately separate from the frozen DesignSpec API.
Run: python -m foldable.standing_pet --output path/to/folder
"""
import argparse
import copy
from dataclasses import dataclass
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.units import mm
from shapely.geometry import Polygon
import trimesh

from .engine import adapt, bounds, validate
from .export import Drawing, edge_angle
from .geometry import panels_from_points


@dataclass
class Part:
    name: str
    prefix: str
    dims: tuple
    center: np.ndarray
    net: object
    paths: list


def loop(points):
    return np.array([*points, points[0]], dtype=float)


def rect(x, y, w, h):
    return loop([(x, y), (x+w, y), (x+w, y+h), (x, y+h)])


def ellipse(x, y, rx, ry):
    a = np.linspace(0, 2*np.pi, 33)
    return np.column_stack((x+rx*np.cos(a), y+ry*np.sin(a)))


def rounded_rect(x, y, w, h, r):
    arcs = []
    for cx, cy, a in [(x+w-r, y+h-r, 0), (x+r, y+h-r, 90),
                       (x+r, y+r, 180), (x+w-r, y+r, 270)]:
        angle = np.radians(np.linspace(a, a+90, 12))
        arcs.extend(zip(cx+r*np.cos(angle), cy+r*np.sin(angle)))
    return loop(arcs)


def artwork(name):
    if name == 'head':
        return [rounded_rect(-13.5, -10.5, 27, 21, 2.7),
                rect(-6.5, -1.5, 1.4, 4), rect(5.1, -1.5, 1.4, 4),
                np.array([[-1, -4.7], [0, -5.2], [1, -4.7]]),
                ellipse(-10, -4.5, 1.5, .85), ellipse(10, -4.5, 1.5, .85),
                loop([(-12, 7), (-10, 10), (-8, 7)]),
                np.array([[-10, 7.8], [-10, 9]])]
    paths = [rounded_rect(-5.5, 0, 11, 8, 1), rect(-2.8, 2, 5.6, 3.5),
            rect(-1.7, 3, .5, 1), rect(1.2, 3, .5, 1),
            np.array([[-1, 2.7], [1, 2.7]]),
            np.array([[0, -4], [0, -11]]),
            rect(-8, -11, 6, 3), rect(2, -11, 6, 3),
            np.array([[-9, 5], [-9, -3], [-7, -4]]),
            np.array([[9, 5], [9, -3], [7, -4]])]
    return [line*np.array([.72, 1]) for line in paths]


def make_part(name, prefix, dims, center, folder):
    solid = panels_from_points(np.array(list(itertools.product((-.5, .5), repeat=3)))*dims)
    source = folder / (name+'-mesh.json')
    result = folder / (name+'-engine.json')
    source.write_text(json.dumps({'vertices': solid.vertices.tolist(),
                                 'faces': [list(p.vertices) for p in solid.panels]}))
    worker = Path(__file__).with_name('blender_worker.py')
    blender = os.environ.get('BLENDER_BIN')
    command = ([blender, '--background', '--factory-startup', '--python', str(worker), '--']
               if blender else [os.environ.get('BLENDER_PYTHON', sys.executable), str(worker)])
    process = subprocess.run(command+[str(source.resolve()), str(result.resolve())],
                             capture_output=True, text=True, timeout=35,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    (folder/(name+'-engine.log')).write_text(process.stdout+process.stderr, encoding='utf-8')
    if process.returncode or not result.exists():
        raise RuntimeError('The Blender worker failed; inspect the engine log.')
    candidates = []
    for raw in json.loads(result.read_text())['candidates']:
        net = adapt(raw, solid, 1)
        validate(net)
        bb = bounds([p.points for p in net.placed.values()]+[s.tab for s in net.seams])
        candidates.append((np.prod(bb[2:]-bb[:2]), net))
    net = min(candidates, key=lambda p: p[0])[1]
    return Part(name, prefix, dims, np.array(center), net, artwork(name))


def place(part, x, y):
    net = part.net
    bb = bounds([p.points for p in net.placed.values()]+[s.tab for s in net.seams])
    shift = np.array([x, y])-bb[:2]
    for p in net.placed.values():
        p.points += shift
        p.offset += shift
    for s in net.seams:
        s.tab += shift
    validate(net)


def on_face(part, normal, points):
    solid = part.net.solid
    face = max(range(len(solid.panels)), key=lambda i: np.dot(solid.panels[i].normal, normal))
    panel = solid.panels[face]
    local = np.column_stack(((points-panel.origin)@panel.u, (points-panel.origin)@panel.v))
    p = part.net.placed[face]
    return local@p.rotation.T+p.offset


def draw_part(d, part, inside=False):
    net = part.net
    for edge in sorted(net.hinges):
        d.line(net.edge_points(net.solid.edges[edge][0], edge), .16, True)
    for s in net.seams:
        for face in s.faces:
            pts = net.edge_points(face, s.edge)
            if face == s.tab_face:
                d.line(s.tab, .24)
                d.line([s.tab[0], s.tab[-1]], .16, True)
                center = np.array(Polygon(s.tab).centroid.coords[0])
            else:
                d.line(pts, .24)
                inward = net.placed[face].points.mean(axis=0)-pts.mean(axis=0)
                center = pts.mean(axis=0)+inward/np.linalg.norm(inward)*2.8
            angle = edge_angle(pts)
            radians = np.radians(angle)
            center += np.array([np.sin(radians), -np.cos(radians)])*.6
            if inside:
                d.text(*center, f'{part.prefix}{s.number}', size=6, angle=angle, anchor='middle')
    if not inside:
        for xy in part.paths:
            world = np.column_stack((xy, np.full(len(xy), part.dims[2]/2)))
            d.line(on_face(part, (0, 0, 1), world), .32)
    if inside:
        return
    # The two large exterior surfaces are the attachment joint, no extra tabs.
    normal = (0, -1, 0) if part.name == 'head' else (0, 1, 0)
    y = -part.dims[1]/2 if part.name == 'head' else part.dims[1]/2
    # Four discrete corner guides cannot be mistaken for a fold rectangle.
    # The head's marks lie strictly inside the smaller body's footprint,
    # so the assembled joint hides all of the outside attachment ink.
    w, depth = (18, 16) if part.name == 'head' else (16, 14)
    for sx, sz in itertools.product((-1, 1), repeat=2):
        pts = np.array([[sx*(w/2-2), y, sz*depth/2],
                        [sx*w/2, y, sz*depth/2], [sx*w/2, y, sz*(depth/2-2)]])
        d.line(on_face(part, normal, pts), .12)
    center = on_face(part, normal, np.array([[0, y, 0]]))[0]
    d.text(*center, 'BODY HERE' if part.name == 'head' else 'GLUE TO HEAD', size=5.5, anchor='middle')


def texture_mesh(part):
    image = Image.new('RGB', (1024, 1024), 'white')
    pen = ImageDraw.Draw(image)
    def uv(xy):
        return .1+.8*(np.asarray(xy)/np.array(part.dims[:2])+.5)
    for line in part.paths:
        pts = uv(line)
        pen.line([(float(u*1023), float((1-v)*1023)) for u, v in pts], fill='black',
                 width=max(2, round(.32/part.dims[0]*.8*1024)), joint='curve')
    vertices, faces, uvs = [], [], []
    for panel in part.net.solid.panels:
        start = len(vertices)
        pts = part.net.solid.vertices[list(panel.vertices)]
        vertices.extend((pts+part.center)/1000)
        faces.extend((start, start+i, start+i+1) for i in range(1, len(pts)-1))
        uvs.extend(uv(pts[:, :2]) if panel.normal[2] > .5 else np.full((len(pts), 2), .02))
    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False,
        visual=trimesh.visual.texture.TextureVisuals(uv=np.array(uvs), image=image))


def view_points(points):
    # Orthographic front-right view with a little top visibility.
    return np.asarray(points) @ np.array([[.88, -.22], [0, .96], [-.48, -.40]])


def preview(d, parts, offset=(173, 74), scale=.82):
    for part in reversed(parts):
        solid = part.net.solid
        for panel in solid.panels:
            if np.dot(panel.normal, (3, 2, 5)) <= 0:
                continue
            d.polygon(view_points(solid.vertices[list(panel.vertices)]+part.center)*scale+offset, .2)
        for line in part.paths:
            world = np.column_stack((line, np.full(len(line), part.dims[2]/2)))+part.center
            d.line(view_points(world)*scale+offset, .23)


def mirror_for_long_edge(drawing):
    """Back page of portrait duplex: horizontal reflection, readable text."""
    mirrored = Drawing()
    for item in drawing.items:
        item = copy.deepcopy(item)
        if item['kind'] in ('line', 'polygon'):
            item['points'][:, 0] = 210 - item['points'][:, 0]
        else:
            item['x'] = 210 - item['x']
            item['angle'] = -item['angle']
            # All in-net text is centred, so labels remain centred after reflection.
            if item['anchor'] != 'middle':
                raise ValueError('Back-side labels must be centre anchored.')
        mirrored.items.append(item)
    return mirrored


def write_duplex(front, back, path):
    canvas = Canvas(str(path), pagesize=(210*mm, 297*mm), pageCompression=1)
    canvas.setTitle('Standing BSOD robot - duplex A4 long edge')
    for drawing in (front, back):
        for item in drawing.items:
            canvas.saveState()
            if item['kind'] in ('line', 'polygon'):
                canvas.setLineWidth(item['width']*mm)
                canvas.setLineJoin(1)
                if item.get('dashed'):
                    canvas.setDash(1.5*mm, .9*mm)
                p = canvas.beginPath()
                for i, (x, y) in enumerate(item['points']):
                    (p.moveTo if i == 0 else p.lineTo)(float(x)*mm, float(y)*mm)
                if item['kind'] == 'polygon':
                    p.close()
                    canvas.setFillColorRGB(1, 1, 1)
                    canvas.drawPath(p, fill=1, stroke=1)
                else:
                    canvas.drawPath(p)
            else:
                canvas.setFont('Helvetica-Bold' if item['bold'] else 'Helvetica', item['size'])
                canvas.translate(item['x']*mm, item['y']*mm)
                canvas.rotate(item['angle'])
                (canvas.drawCentredString if item['anchor'] == 'middle' else canvas.drawString)(0, 0, item['text'])
            canvas.restoreState()
        canvas.showPage()
    canvas.save()


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    head = make_part('head', 'H', (36, 30, 26), (0, 39, 0), output)
    body = make_part('body', 'B', (22, 24, 20), (0, 12, 0), output)
    parts = [head, body]
    place(head, 10, 143)
    place(body, 120, 143)
    polygons = [Polygon(p.points) for part in parts for p in part.net.placed.values()]
    polygons += [Polygon(s.tab) for part in parts for s in part.net.seams]
    for i, p in enumerate(polygons):
        for q in polygons[i+1:]:
            assert p.buffer(-.002).intersection(q.buffer(-.002)).area < 1e-5
    d = Drawing()
    inside = Drawing()
    d.text(10, 283, 'BSOD / STANDING PAPER COMPANION', 15, bold=True)
    d.text(10, 276, 'OUTSIDE / artwork side. Cut solid outlines; score dashed folds.', 8)
    d.text(10, 269, 'Seam numbers inside; head and body attachment marks outside.', 7)
    d.text(10, 258, 'HEAD / 36 x 30 x 26 mm', 8, bold=True)
    d.text(120, 231, 'BODY / 22 x 24 x 20 mm', 8, bold=True)
    for part in parts:
        draw_part(d, part)
        draw_part(inside, part, inside=True)
    d.text(10, 131, 'OPTIONAL FLAT ARMS AND ANTENNA', 8, bold=True)
    for x, name in [(61, 'L'), (76, 'R')]:
        pts = loop([(x, 113), (x+7, 113), (x+7, 101), (x+5, 99), (x+2, 99), (x, 102)])
        d.line(pts, .24)
        inside.line(pts, .24)
        inside.text(x+3.5, 110, 'glue', 5, anchor='middle')
    antenna = loop([(96, 88), (104, 88), (104, 92), (101.5, 92),
                    (101.5, 101), (104, 104), (100, 108), (96, 104), (98.5, 101), (98.5, 92), (96, 92)])
    for side in (d, inside):
        side.line(antenna, .24)
        side.line([(96, 92), (104, 92)], .16, True)
    inside.text(100, 89, 'glue', 5, anchor='middle')
    d.text(10, 77, 'Arms: glue upper ends to body sides, below head.', 6.5)
    d.text(10, 72, 'Antenna: fold foot 90 degrees; glue on head top.', 6.5)
    preview(d, parts)
    d.text(173, 62, 'ASSEMBLED BOXES', 6.5, anchor='middle')
    d.text(173, 58, '54 mm tall before antenna', 6.5, anchor='middle')
    d.line([(10, 51), (200, 51)], .15)
    d.text(10, 44, 'PRINT ON A4 / DOUBLE-SIDED / FLIP LONG EDGE / 100% ACTUAL SIZE', 7, bold=True)
    d.text(10, 38, 'Compare registration crosses on both sides against a light before cutting.', 7)
    d.text(10, 32, 'Cut outlines and score folds from this side. Assemble using inside labels.', 7)
    d.text(10, 26, 'Printed side faces OUT. Tabs fold inside. The face and chest are artwork.', 7)
    d.text(10, 12, 'Digital checks passed; this design has not been physically assembled.', 6.5)
    d.line([(177, 17), (197, 17)], .3)
    d.line([(177, 15.5), (177, 18.5)], .3)
    d.line([(197, 15.5), (197, 18.5)], .3)
    d.text(187, 12, '20 mm check', 6.5, anchor='middle')
    # Crosses are drawn in identical material coordinates on each side.
    for x, y in [(12, 264), (198, 264), (12, 137), (198, 137), (12, 84), (198, 84), (105, 135)]:
        for side in (d, inside):
            side.line([(x-1, y), (x+1, y)], .14)
            side.line([(x, y-1), (x, y+1)], .14)
    back = mirror_for_long_edge(inside)
    back.text(10, 283, 'INSIDE / BACK OF THE SHEET', 15, bold=True)
    back.text(10, 276, 'Flip on LONG EDGE. This side faces inward when assembled.', 8)
    back.text(10, 269, 'Match H to H for the head; B to B for the body. Glue tabs inside.', 7)
    back.text(10, 131, 'INSIDE LABELS / arms and antenna are optional', 8, bold=True)
    back.text(10, 77, 'Glue arm tops to body sides. Fold the antenna foot and glue on head top.', 6.5)
    back.line([(10, 51), (200, 51)], .15)
    for y, text in [(45, '1  Score the dashed folds and fold them away from the outside artwork.'),
                    (39, '2  Glue H4-H7. Keep the face open; then close joins H1-H3.'),
                    (33, '3  Glue B4-B7. Keep the front open; then close joins B1-B3.'),
                    (27, '4  Glue the marked OUTSIDE of body top to the marked OUTSIDE of head bottom.')]:
        back.text(10, y, text, 7)
    back.text(10, 18, 'A4 / DUPLEX / FLIP LONG EDGE / ACTUAL SIZE 100%', 7, bold=True)
    back.text(10, 12, 'Hold against light: crosses must overlap. Check the 20 mm line on front.', 6.5)
    write_duplex(d, back, output/'standing-bsod-duplex-a4.pdf')
    d.svg(output/'standing-bsod-front.svg')
    back.svg(output/'standing-bsod-back.svg')
    scene = trimesh.Scene()
    for part in parts:
        scene.add_geometry(texture_mesh(part), node_name=part.name, geom_name=part.name)
    (output/'standing-bsod.glb').write_bytes(scene.export(file_type='glb'))
    record = {'physically_tested': False, 'paper': 'A4', 'page_count': 2, 'sheets': 1, 'duplex_flip': 'long-edge',
              'height_mm': 54, 'engine': 'Blender Export Paper Model 1.4.2',
              'boxes': {p.name: {'dimensions_mm': p.dims, 'checks': validate(p.net),
                        'tab_count': len(p.net.seams),
                        'minimum_tab_depth_mm': min(s.depth_mm for s in p.net.seams)} for p in parts}}
    (output/'validation.json').write_text(json.dumps(record, indent=2))
    return parts, d


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build(args.output)
    print(args.output.resolve())


if __name__ == '__main__':
    main()
