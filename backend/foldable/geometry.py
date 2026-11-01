"""Convex low-poly shapes. Coordinates: +X right, +Y up, +Z toward viewer.

Panels retain coplanar polygon faces; triangulation is for GLB rendering only.
Pointed ears are vertices of the same closed convex shell, not loose parts.
"""
from dataclasses import dataclass
from collections import defaultdict
import itertools

import numpy as np
from scipy.spatial import ConvexHull

from .models import DesignV1, DesignV2, PrintError


@dataclass
class Panel:
    vertices: tuple[int, ...]
    origin: np.ndarray
    u: np.ndarray
    v: np.ndarray
    normal: np.ndarray
    xy: np.ndarray


@dataclass
class Solid:
    vertices: np.ndarray
    panels: list[Panel]
    edges: dict[tuple[int, int], list[int]]
    front_panel: int

    def triangles(self):
        return np.array([(p.vertices[0], p.vertices[i], p.vertices[i + 1])
                         for p in self.panels for i in range(1, len(p.vertices) - 1)])


def panels_from_points(points: np.ndarray) -> Solid:
    hull = ConvexHull(points)
    # Merge only coplanar triangles, preserving their true convex boundary.
    groups = defaultdict(set)
    equations = {}
    for tri, eq in zip(hull.simplices, hull.equations):
        key = tuple(np.round(eq, 7))
        groups[key].update(int(i) for i in tri)
        equations[key] = eq[:3]
    panels = []
    for key, indices in sorted(groups.items()):
        normal = equations[key]
        ids = sorted(indices)
        center = points[ids].mean(axis=0)
        u = points[ids[0]] - center
        u /= np.linalg.norm(u)
        v = np.cross(normal, u)
        ids.sort(key=lambda i: np.arctan2(np.dot(points[i] - center, v),
                                        np.dot(points[i] - center, u)))
        origin = points[ids[0]].copy()
        u = points[ids[1]] - origin
        u /= np.linalg.norm(u)
        v = np.cross(normal, u)
        xy = np.array([[np.dot(points[i] - origin, u), np.dot(points[i] - origin, v)] for i in ids])
        panels.append(Panel(tuple(ids), origin, u, v, normal, xy))
    edges = defaultdict(list)
    for fi, p in enumerate(panels):
        for a, b in zip(p.vertices, p.vertices[1:] + p.vertices[:1]):
            edges[tuple(sorted((a, b)))].append(fi)
    if any(len(faces) != 2 for faces in edges.values()):
        raise PrintError("The shape is not a closed surface.", ["closed_mesh"])
    used = set(itertools.chain.from_iterable(p.vertices for p in panels))
    if len(used) - len(edges) + len(panels) != 2:
        raise PrintError("The shape has unsupported topology.", ["closed_mesh"])
    front = max(range(len(panels)), key=lambda i: panels[i].normal[2])
    return Solid(points, panels, dict(edges), front)


def make_solid(design: DesignV1 | DesignV2, scale: float = 1) -> Solid:
    if design.shape == "box":
        points = np.array(list(itertools.product((-0.5, 0.5), repeat=3)))
    elif design.shape == "rounded":
        # A rotated icosahedron: twenty equilateral panels before proportions.
        phi = (1 + np.sqrt(5)) / 2
        points = np.array([(0, a, b * phi) for a in (-1, 1) for b in (-1, 1)]
                          + [(a, b * phi, 0) for a in (-1, 1) for b in (-1, 1)]
                          + [(a * phi, 0, b) for a in (-1, 1) for b in (-1, 1)], dtype=float)
    elif design.shape == "diamond":
        points = np.concatenate((np.eye(3), -np.eye(3)))
    elif design.shape == "crystal":
        points = np.array([(np.cos(a), y, np.sin(a)) for y in (-0.55, 0.55)
                           for a in np.arange(6) * np.pi / 3] + [(0, 1.15, 0), (0, -1.15, 0)])
    else:
        raise PrintError("Unsupported shape.", ["shape"])
    points = points.astype(float)
    points /= np.ptp(points, axis=0).max()
    if isinstance(design, DesignV2):
        if design.ears == "pointed":
            # Two silhouette peaks, part of the watertight convex hull.
            points = np.vstack((points, [[-0.38, 0.8, 0.06], [0.38, 0.8, 0.06]]))
        points *= [design.proportions.width, design.proportions.height, design.proportions.depth]
        points *= design.size_mm / np.ptp(points, axis=0).max()
    else:
        points *= design.edge_mm
    points *= scale
    points -= (points.max(axis=0) + points.min(axis=0)) / 2
    return panels_from_points(points)
