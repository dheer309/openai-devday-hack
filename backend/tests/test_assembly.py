import numpy as np
import pytest

from foldable.assembly import _commands, _contacts, _front_art, _contact_outline
from foldable.engine import solve, validate
from foldable.models import DESIGN_ADAPTER, PrintError


def assembly(y=-30):
    common = {"width_mm": 35, "height_mm": 30, "depth_mm": 25,
              "color": "#a38769", "artwork": [{"shape": "rect", "x": .5,
              "y": .5, "width": .6, "height": .5, "color": "#eecbaa"}]}
    return DESIGN_ADAPTER.validate_python({"version": 3, "name": "Bot", "parts": [
        {**common, "id": "head", "position": {"x": 0, "y": 0, "z": 0}},
        {**common, "id": "body", "position": {"x": 0, "y": y, "z": 0}}]})


def test_assembly_contact_and_unbuildable_positions():
    design = assembly()
    contacts = _contacts(design.parts)
    assert contacts[0][0][0] == 1 and contacts[1][0][0] == 0
    with pytest.raises(PrintError, match="overlap"):
        _contacts(assembly(-29).parts)
    with pytest.raises(PrintError, match="touch"):
        _contacts(assembly(-31).parts)


def test_separate_feet_remain_attached():
    box = {"height_mm": 20, "depth_mm": 25, "color": "#4775df", "artwork": []}
    design = DESIGN_ADAPTER.validate_python({"version": 3, "name": "Bot", "parts": [
        {**box, "id": "body", "width_mm": 32, "height_mm": 30, "position": {"x": 0, "y": 0, "z": 0}},
        {**box, "id": "leftfoot", "width_mm": 20, "position": {"x": -12, "y": -25, "z": 0}},
        {**box, "id": "rightfoot", "width_mm": 20, "position": {"x": 12, "y": -25, "z": 0}},
    ]})
    contacts = _contacts(design.parts)
    assert {c[0] for c in contacts[0]} == {1, 2}
    assert len(contacts[1]) == len(contacts[2]) == 1
    design.parts[1].position.x = -10
    design.parts[2].position.x = 10
    with pytest.raises(PrintError, match="Separate the left and right feet"):
        _contacts(design.parts)


def test_duplex_mirrors_geometry_and_preserves_artwork(tmp_path):
    design = assembly()
    part = design.parts[0]
    net = solve(part, tmp_path)
    validate(net)
    front = _commands(part, net)
    back = _commands(part, net, True, _contacts(design.parts)[0], design.parts)
    front_lines = [x for x in front if x[0] == "poly" and not x[2]]
    back_lines = [x for x in back if x[0] == "poly"]
    for line in front_lines:
        mirrored = line[1].copy(); mirrored[:, 0] = 210 - mirrored[:, 0]
        assert any(other[1].shape == mirrored.shape and np.allclose(other[1], mirrored)
                   for other in back_lines)
    assert any(x[0] == "text" and "glue body" in x[3] for x in back)
    assert _front_art(part, net, part.artwork[0]).shape == (4, 2)
    assert _contact_outline(part, net, _contacts(design.parts)[0][0]).shape == (4, 2)


def test_shared_scale_fills_page_and_keeps_duplex_aligned(tmp_path):
    from foldable.assembly import assembly_scale
    design = assembly()
    design.parts[1].width_mm = 20
    nets = [solve(part, tmp_path) for part in design.parts]
    factor = assembly_scale(nets)
    sizes = []
    for part, net in zip(design.parts, nets):
        front = _commands(part, net, scale=factor)
        back = _commands(part, net, True, scale=factor)
        border = [cmd for cmd in front if cmd[0] == 'poly' and cmd[3] == '#888888'][0][1]
        sizes.append(np.ptp(border, axis=0))
        assert np.all(border.min(axis=0) >= [13-1e-6, 13-1e-6])
        assert np.all(border.max(axis=0) <= [197+1e-6, 278+1e-6])
        mirrored = border.copy(); mirrored[:, 0] = 210 - mirrored[:, 0]
        assert any(cmd[0] == 'poly' and cmd[1].shape == mirrored.shape and np.allclose(cmd[1], mirrored) for cmd in back)
    assert any(np.isclose(size[0], 184) or np.isclose(size[1], 265) for size in sizes)
    assert np.max(sizes[0]) > np.max(sizes[1])


def test_two_part_output_has_duplex_pages_and_assembled_geometry(tmp_path, monkeypatch):
    import trimesh
    from pypdf import PdfReader
    from foldable import service
    monkeypatch.setattr(service, "STORAGE", tmp_path)
    result = service.render_design(assembly())
    folder = tmp_path / result["model_url"].split("/")[3]
    assert result["stats"]["piece_count"] == 2
    assert result["stats"]["page_count"] == 4
    pages = PdfReader(folder / "net.pdf").pages
    assert len(pages) == 4
    for index, page in enumerate(pages, 1):
        assert str(index) in page.extract_text().splitlines()
    model = trimesh.load(folder / "model.glb", force="scene")
    assert len(model.geometry) == 4  # two boxes plus their printed face marks
    assert result['stats']['scale_applied'] > 1
    assert np.allclose(model.bounds[:, 1], np.array([-.045, .015]) * result['stats']['scale_applied'], atol=.0001)
    assert '#a38769' in (folder / 'net.svg').read_text()
    assert '#eecbaa' in (folder / 'net.svg').read_text()


@pytest.mark.parametrize('shape', ['box', 'rounded', 'diamond', 'crystal'])
def test_shape_art_and_duplex_match_mesh(tmp_path, shape):
    from foldable.assembly import _art_outline, render_assembly
    from shapely.geometry import Polygon
    import trimesh
    from pypdf import PdfReader
    design = DESIGN_ADAPTER.validate_python({'version': 3, 'name': 'Shape', 'parts': [{
        'id': 'head', 'shape': shape, 'width_mm': 40, 'height_mm': 40, 'depth_mm': 25,
        'position': {'x': 0, 'y': 0, 'z': 0}, 'color': '#5588cc',
        'artwork': [{'shape': 'rect', 'x': .5, 'y': .5, 'width': .9, 'height': .9, 'color': '#ffeeaa'}],
    }]})
    nets = render_assembly(design, tmp_path)
    solid = nets[0].solid
    face = solid.panels[solid.front_panel]
    face_polygon = Polygon(solid.vertices[list(face.vertices), :2])
    outline = _art_outline(design.parts[0], solid, design.parts[0].artwork[0])
    assert face_polygon.buffer(.00001).covers(Polygon(outline))
    model = trimesh.load(tmp_path / 'model.glb', force='scene')
    assert len(model.geometry) == 2
    solid_mesh = model.geometry[next(name for name in model.geometry if not name.endswith('_art_0'))]
    assert len(solid_mesh.faces) == len(solid.triangles())
    assert len(PdfReader(tmp_path / 'net.pdf').pages) == 2
    assert '#ffeeaa' in (tmp_path / 'net.svg').read_text()


def test_shaped_contact_uses_real_flat_face():
    design = DESIGN_ADAPTER.validate_python({'version': 3, 'name': 'Shape', 'parts': [
        {'id': 'head', 'shape': 'diamond', 'width_mm': 40, 'height_mm': 40, 'depth_mm': 25,
         'position': {'x': 0, 'y': 35, 'z': 0}, 'color': '#5588cc', 'artwork': []},
        {'id': 'body', 'shape': 'box', 'width_mm': 30, 'height_mm': 30, 'depth_mm': 25,
         'position': {'x': 0, 'y': 0, 'z': 0}, 'color': '#5588cc', 'artwork': []},
    ]})
    contact = _contacts(design.parts)[0][0]
    assert contact[1] == 1
    assert np.isclose(contact[4][0] - contact[3][0], 12.8)
    # Bounding boxes still touch after this move, but actual diamond face does not.
    design.parts[0].position.x = 20
    with pytest.raises(PrintError, match='touch'):
        _contacts(design.parts)
