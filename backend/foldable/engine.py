"""Adapter and independent print checks around Blender Export Paper Model."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
from shapely.geometry import Polygon

from .geometry import Solid, make_solid
from .models import DesignV1, PrintError, REQUIRED_CHECKS

PAGE_AREA = (10, 58, 200, 257)
TOLERANCE_MM = 0.002  # Blender stores float32 coordinates.


@dataclass
class Placed:
    panel: int
    points: np.ndarray
    rotation: np.ndarray
    offset: np.ndarray
    island: int


@dataclass
class Seam:
    number: int
    edge: tuple[int, int]
    faces: tuple[int, int]
    tab_face: int
    tab: np.ndarray
    depth_mm: float


@dataclass
class Net:
    solid: Solid
    placed: dict[int, Placed]
    hinges: set[tuple[int, int]]
    seams: list[Seam]
    scale: float
    island_count: int

    def edge_points(self, face, edge):
        ids = self.solid.panels[face].vertices
        return np.array([self.placed[face].points[ids.index(i)] for i in edge])


def bounds(polygons):
    points = np.vstack(polygons)
    return np.array([*points.min(axis=0), *points.max(axis=0)])


def adapt(raw, solid, scale):
    placed = {}
    shift = np.array([PAGE_AREA[0], PAGE_AREA[1]], dtype=float)
    for face, entry in raw["placed"].items():
        f = int(face)
        points = np.array(entry["points"]) + shift
        local = solid.panels[f].xy
        # Recover the rigid frame for artwork and independent refold checking.
        matrix = np.column_stack((local, np.ones(len(local))))
        solution, *_ = np.linalg.lstsq(matrix, points, rcond=None)
        placed[f] = Placed(f, points, solution[:2].T, solution[2], entry["island"])
    seams = []
    cuts = sorted(raw["seams"], key=lambda s: (-solid.vertices[s["edge"], 2].mean(), s["edge"]))
    for number, s in enumerate(cuts, 1):
        points = np.array(s["tab"]) + shift
        a, b = points[0], points[-1]
        direction = b - a
        lengths = np.abs(direction[0] * (points[:, 1] - a[1]) - direction[1] * (points[:, 0] - a[0]))
        depth = float(lengths.max() / np.linalg.norm(direction))
        seams.append(Seam(number, tuple(s["edge"]), tuple(s["faces"]), s["tab_face"], points, depth))
    net = Net(solid, placed, {tuple(e) for e in raw["hinges"]}, seams, scale, raw["island_count"])
    bb = bounds([p.points for p in placed.values()] + [s.tab for s in seams])
    center_shift = (np.array(PAGE_AREA[:2]) + np.array(PAGE_AREA[2:]) - bb[:2] - bb[2:]) / 2
    for p in placed.values():
        p.points += center_shift
        p.offset += center_shift
    for s in seams:
        s.tab += center_shift
    return net


def validate(net):
    solid = net.solid
    errors = set()
    if any(len(faces) != 2 for faces in solid.edges.values()) or len(net.placed) != len(solid.panels):
        errors.add("closed_mesh")
    polys = [Polygon(p.points) for p in net.placed.values()] + [Polygon(s.tab) for s in net.seams]
    if any(not p.is_valid or p.area < 1 for p in polys):
        errors.add("no_overlaps")
    for i, p in enumerate(polys):
        for q in polys[i + 1:]:
            # Erode by numerical tolerance to allow intended shared borders.
            if p.buffer(-TOLERANCE_MM).intersection(q.buffer(-TOLERANCE_MM)).area > 1e-5:
                errors.add("no_overlaps")
    bb = bounds([p.points for p in net.placed.values()] + [s.tab for s in net.seams])
    if np.any(bb[:2] < np.array(PAGE_AREA[:2]) - TOLERANCE_MM) or np.any(bb[2:] > np.array(PAGE_AREA[2:]) + TOLERANCE_MM):
        errors.add("page_bounds")
    cuts = set(solid.edges) - net.hinges
    if {s.edge for s in net.seams} != cuts or len(net.seams) != len(cuts):
        errors.add("one_tab_per_seam")
    if sorted(s.number for s in net.seams) != list(range(1, len(cuts) + 1)):
        errors.add("seam_labels")
    for edge, faces in solid.edges.items():
        expected = np.linalg.norm(solid.vertices[edge[1]] - solid.vertices[edge[0]])
        if expected < 10:
            errors.add("minimum_edge_size")
        for f in faces:
            pts = net.edge_points(f, edge)
            if not np.isclose(np.linalg.norm(pts[1] - pts[0]), expected, atol=TOLERANCE_MM):
                errors.add("seam_lengths")
        if edge in net.hinges and not np.allclose(net.edge_points(faces[0], edge), net.edge_points(faces[1], edge), atol=TOLERANCE_MM):
            errors.add("refold_geometry")
    for f, placed in net.placed.items():
        p = solid.panels[f]
        if not np.allclose(placed.rotation.T @ placed.rotation, np.eye(2), atol=0.0001):
            errors.add("refold_geometry")
        local = (placed.points - placed.offset) @ placed.rotation
        world = p.origin + local[:, :1] * p.u + local[:, 1:] * p.v
        if not np.allclose(world, solid.vertices[list(p.vertices)], atol=TOLERANCE_MM):
            errors.add("refold_geometry")
    for s in net.seams:
        poly = Polygon(s.tab)
        if s.depth_mm < 4.5 - TOLERANCE_MM or poly.area < 35:
            errors.add("usable_tabs")
        if poly.boundary.distance(poly.centroid) < 1.5:
            errors.add("label_legibility")
        mate = next(f for f in s.faces if f != s.tab_face)
        # Map the tab into the receiving face and verify it does not protrude.
        src = net.edge_points(s.tab_face, s.edge)
        dst = net.edge_points(mate, s.edge)
        t = (src[1] - src[0]) / np.linalg.norm(src[1] - src[0])
        n = np.array([-t[1], t[0]])
        if np.dot(np.array(poly.centroid.coords[0]) - src[0], n) < 0:
            n = -n
        mt = (dst[1] - dst[0]) / np.linalg.norm(dst[1] - dst[0])
        mn = np.array([-mt[1], mt[0]])
        if np.dot(net.placed[mate].points.mean(axis=0) - dst[0], mn) < 0:
            mn = -mn
        mapped = np.array([dst[0] + np.dot(pt-src[0], t)*mt + np.dot(pt-src[0], n)*mn for pt in s.tab])
        if Polygon(mapped).difference(Polygon(net.placed[mate].points).buffer(TOLERANCE_MM)).area > 0.01:
            errors.add("tab_receiver_fit")
    if net.island_count > 3:
        errors.add("piece_count")
    if len(solid.panels) > 24 or len(net.seams) > 18:
        errors.add("assembly_complexity")
    if errors:
        raise PrintError("This layout is too cramped to assemble comfortably on one A4 sheet. Try a simpler shape or proportions closer to 1.", sorted(errors))
    return REQUIRED_CHECKS + ["usable_tabs", "minimum_edge_size", "tab_receiver_fit", "assembly_complexity"]


def solve_blender(design, workdir: Path):
    worker = Path(__file__).with_name("blender_worker.py")
    workdir.mkdir(parents=True, exist_ok=True)
    last = None
    scales = [1.0] if isinstance(design, DesignV1) else [1.0, 0.92, 0.84]
    for scale in scales:
        solid = make_solid(design, scale)
        input_file, output_file = workdir / "mesh-input.json", workdir / "engine-output.json"
        input_file.write_text(json.dumps({"vertices": solid.vertices.tolist(), "faces": [list(p.vertices) for p in solid.panels]}))
        if output_file.exists():
            output_file.unlink()
        blender_bin = os.environ.get("BLENDER_BIN")
        command = ([blender_bin, "--background", "--factory-startup", "--python", str(worker), "--"]
                   if blender_bin else [os.environ.get("BLENDER_PYTHON", sys.executable), str(worker)])
        command += [str(input_file.resolve()), str(output_file.resolve())]
        try:
            process = subprocess.run(command, capture_output=True, text=True, timeout=35,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PrintError("Blender is unavailable or exceeded the render timeout. Check BLENDER_BIN or the bpy installation.", ["engine_unavailable"]) from exc
        (workdir / "engine.log").write_text(process.stdout + process.stderr, encoding="utf-8")
        if not output_file.exists():
            raise PrintError("The Blender runtime could not start. Check last-engine-error.log in the render storage directory.", ["engine_unavailable"])
        raw = json.loads(output_file.read_text())
        if "error" in raw:
            last = PrintError("The unfolding engine could not fit this model on one A4 sheet.", ["unfold"])
            continue
        for candidate in sorted(raw["candidates"], key=lambda c: (c["island_count"], len(c["seams"]))):
            try:
                net = adapt(candidate, solid, scale)
                validate(net)
                return net
            except PrintError as exc:
                last = exc
    raise last or PrintError("No printable layout was found.", ["unfold"])


def engine_name():
    return "Blender Export Paper Model 1.4.2" if os.environ.get("FOLDABLE_ENGINE") == "blender" else "Foldable local unfold"


def solve(design, workdir: Path):
    if os.environ.get("FOLDABLE_ENGINE") == "blender":
        return solve_blender(design, workdir)
    from .local_engine import solve_local
    return solve_local(design, workdir, Net, Placed, Seam, PAGE_AREA, validate)
