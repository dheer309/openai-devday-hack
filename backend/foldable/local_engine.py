"""Bounded rigid-panel unfolding with independently checked glue-tab placement.

Geometry is supplied by the procedural solid builder. The search only selects a
spanning tree and rigid panel transforms; it never substitutes another solid.
"""
import math
import random
import time

import numpy as np
from shapely.geometry import LineString, Polygon

from .geometry import make_solid
from .models import DesignV1, PrintError


EPS = 0.001


def _overlap(a, b):
    if not a.intersects(b):
        return False
    return a.buffer(-EPS).intersection(b.buffer(-EPS)).area > 1e-5


def _attach(solid, placed, parent, child, edge, Placed):
    parent_ids = solid.panels[parent].vertices
    child_panel = solid.panels[child]
    ids = child_panel.vertices
    dst = placed[parent].points[[parent_ids.index(edge[0]), parent_ids.index(edge[1])]]
    src = child_panel.xy[[ids.index(edge[0]), ids.index(edge[1])]]
    a = (src[1] - src[0]) / np.linalg.norm(src[1] - src[0])
    b = (dst[1] - dst[0]) / np.linalg.norm(dst[1] - dst[0])
    cosine, sine = np.dot(a, b), a[0] * b[1] - a[1] * b[0]
    rotation = np.array([[cosine, -sine], [sine, cosine]])
    offset = dst[0] - rotation @ src[0]
    points = child_panel.xy @ rotation.T + offset
    return Placed(child, points, rotation, offset, 0)


def _tab_options(net, edge, faces, number, Seam):
    options = []
    face_polygons = [Polygon(p.points) for p in net.placed.values()]
    for owner in faces:
        mate = next(f for f in faces if f != owner)
        src = net.edge_points(owner, edge)
        dst = net.edge_points(mate, edge)
        length = np.linalg.norm(src[1] - src[0])
        tangent = (src[1] - src[0]) / length
        outward = np.array([-tangent[1], tangent[0]])
        if np.dot(net.placed[owner].points.mean(axis=0) - src[0], outward) > 0:
            outward = -outward
        mate_tangent = (dst[1] - dst[0]) / length
        inward = np.array([-mate_tangent[1], mate_tangent[0]])
        if np.dot(net.placed[mate].points.mean(axis=0) - dst[0], inward) < 0:
            inward = -inward
        relative = net.placed[mate].points - dst[0]
        receiver = Polygon(np.column_stack((relative @ mate_tangent, relative @ inward)))
        for depth in (6.0, 5.25, 4.5):
            section = receiver.intersection(LineString([(-length * 4, depth), (length * 5, depth)]))
            if section.is_empty or section.geom_type != 'LineString':
                continue
            xs = np.array(section.coords)[:, 0]
            for bevel in (1.0, 2.5, 4.0):
                left, right = max(float(xs.min()) + .03, bevel), min(float(xs.max()) - .03, length - bevel)
                if right - left < .5:
                    continue
                tab = np.array([src[0], src[0] + tangent * left + outward * depth,
                                src[0] + tangent * right + outward * depth, src[1]])
                poly = Polygon(tab)
                if not poly.is_valid or poly.area < 35 or poly.boundary.distance(poly.centroid) < 1.5:
                    continue
                if any(_overlap(poly, face) for face in face_polygons):
                    continue
                options.append((Seam(number, edge, tuple(faces), owner, tab, depth), poly))
    return options


def _add_tabs(net, Seam, deadline):
    cuts = sorted(set(net.solid.edges) - net.hinges,
                  key=lambda e: (-net.solid.vertices[list(e), 2].mean(), e))
    groups = []
    for number, edge in enumerate(cuts, 1):
        options = _tab_options(net, edge, net.solid.edges[edge], number, Seam)
        if not options:
            return False
        groups.append(options)
    groups.sort(key=len)
    chosen, polygons = [], []

    def visit(index):
        if time.monotonic() > deadline:
            return False
        if index == len(groups):
            return True
        for seam, poly in groups[index]:
            if any(_overlap(poly, previous) for previous in polygons):
                continue
            chosen.append(seam)
            polygons.append(poly)
            if visit(index + 1):
                return True
            polygons.pop()
            chosen.pop()
        return False

    if not visit(0):
        return False
    net.seams = sorted(chosen, key=lambda s: s.number)
    return True


def _pack(net, page_area):
    points = np.vstack([p.points for p in net.placed.values()] + [s.tab for s in net.seams])
    available = np.array(page_area[2:]) - page_area[:2]
    best = None
    for angle in np.linspace(0, math.pi, 73)[:-1]:
        cosine, sine = math.cos(angle), math.sin(angle)
        rotation = np.array([[cosine, -sine], [sine, cosine]])
        transformed = points @ rotation.T
        low, high = transformed.min(axis=0), transformed.max(axis=0)
        ratio = float(np.max((high - low) / available))
        if best is None or ratio < best[0]:
            best = (ratio, rotation, low, high)
    ratio, rotation, low, high = best
    if ratio > 1 + 1e-7:
        return False
    offset = np.array(page_area[:2]) + (available - (high - low)) / 2 - low
    for placed in net.placed.values():
        placed.points = placed.points @ rotation.T + offset
        placed.rotation = rotation @ placed.rotation
        placed.offset = rotation @ placed.offset + offset
    for seam in net.seams:
        seam.tab = seam.tab @ rotation.T + offset
    return True


def solve_local(design, workdir, Net, Placed, Seam, page_area, validate):
    rng = random.Random(81463)
    scales = [1.0] if isinstance(design, DesignV1) else [1.0, .92, .84]
    deadline = time.monotonic() + 18
    last = None
    for scale in scales:
        scale_deadline = min(deadline, time.monotonic() + (6 if len(scales) > 1 else 18))
        solid = make_solid(design, scale)
        if any(np.linalg.norm(solid.vertices[e[1]] - solid.vertices[e[0]]) < 10 for e in solid.edges):
            last = PrintError('This shape has edges that are too short to assemble. Increase its size or use proportions closer to 1.', ['minimum_edge_size'])
            continue
        neighbors = {f: [] for f in range(len(solid.panels))}
        for edge, faces in solid.edges.items():
            a, b = faces
            neighbors[a].append((b, edge))
            neighbors[b].append((a, edge))
        for attempt in range(180):
            if time.monotonic() > scale_deadline:
                break
            root = solid.front_panel if attempt < 30 else rng.randrange(len(solid.panels))
            panel = solid.panels[root]
            placed = {root: Placed(root, panel.xy.copy(), np.eye(2), np.zeros(2), 0)}
            polygons = {root: Polygon(panel.xy)}
            hinges = set()
            while len(placed) < len(solid.panels):
                candidates = []
                for parent in placed:
                    for child, edge in neighbors[parent]:
                        if child in placed:
                            continue
                        proposed = _attach(solid, placed, parent, child, edge, Placed)
                        poly = Polygon(proposed.points)
                        if any(_overlap(poly, old) for old in polygons.values()):
                            continue
                        all_points = np.vstack([p.points for p in placed.values()] + [proposed.points])
                        extent = np.ptp(all_points, axis=0)
                        score = float(extent.max() + .01 * extent.prod())
                        score *= rng.uniform(.65, 1.4) if attempt else 1
                        candidates.append((score, child, edge, proposed, poly))
                if not candidates:
                    break
                _, child, edge, proposed, poly = min(candidates, key=lambda c: c[0])
                placed[child], polygons[child] = proposed, poly
                hinges.add(edge)
            if len(placed) != len(solid.panels):
                continue
            net = Net(solid, placed, hinges, [], scale, 1)
            if not _add_tabs(net, Seam, min(scale_deadline, time.monotonic() + .12)):
                continue
            if not _pack(net, page_area):
                continue
            try:
                validate(net)
                return net
            except PrintError as exc:
                last = exc
    raise last or PrintError('A comfortably buildable A4 net could not be found. Try a larger size, simpler shape, or proportions closer to 1.', ['unfold'])
