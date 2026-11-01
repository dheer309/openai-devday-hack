import copy
import json
from pathlib import Path
import uuid

import numpy as np
from pypdf import PdfReader
from reportlab.pdfbase.pdfmetrics import getAscentDescent, stringWidth
import pytest
import trimesh
from fastapi.testclient import TestClient
from shapely.geometry import LineString, Polygon

from foldable import service
from foldable.app import app
from foldable.artwork import projected_art, texture
from foldable.engine import adapt, validate
from foldable.export import draw_net
from foldable.geometry import make_solid
from foldable.models import DESIGN_ADAPTER, PrintError, REQUIRED_CHECKS

EXAMPLES = Path(__file__).resolve().parents[1] / 'examples'


def pdf_spans(page):
    """Inspect actual PDF text operators using its declared standard fonts."""
    spans = []
    current = {'font': 'Helvetica', 'size': 7}
    fonts = page['/Resources']['/Font']

    def visitor(operator, args, cm, tm):
        if operator == b'Tf':
            current['font'] = str(fonts[args[0]]['/BaseFont']).lstrip('/')
            current['size'] = float(args[1])
        elif operator == b'Tj':
            text = args[0] if isinstance(args[0], str) else bytes(args[0]).decode('cp1252')
            size = current['size']
            width = stringWidth(text, current['font'], size)
            ascent, descent = getAscentDescent(current['font'], size)
            coords = []
            for x, y in ((0, descent), (width, descent), (width, ascent), (0, ascent)):
                tx, ty = x * tm[0] + y * tm[2] + tm[4], x * tm[1] + y * tm[3] + tm[5]
                coords.append((tx * cm[0] + ty * cm[2] + cm[4], tx * cm[1] + ty * cm[3] + cm[5]))
            points = np.asarray(coords)
            spans.append({'text': text, 'size': size,
                          'bbox': [*points.min(axis=0), *points.max(axis=0)]})

    page.extract_text(visitor_operand_before=visitor)
    return spans


@pytest.fixture(scope='module')
def rendered():
    # Exercise real unfolding, validation, export, cache and HTTP asset routes.
    root = service.STORAGE / ('test-' + uuid.uuid4().hex)
    root.mkdir(parents=True)
    old_storage = service.STORAGE
    import foldable.app as api
    old_api_storage = api.STORAGE
    service.STORAGE = api.STORAGE = root
    client = TestClient(app)
    results = {}
    for name in ('robot', 'cat', 'blob', 'crystal', 'diamond'):
        payload = (json.loads((EXAMPLES / f'{name}.design.json').read_text()) if name != 'diamond'
                   else {'version': 2, 'name': 'Diamond', 'shape': 'diamond', 'size_mm': 55})
        response = client.post('/render', json=payload)
        assert response.status_code == 200, response.text
        result = response.json()
        folder = root / result['pdf_url'].split('/')[-2]
        design = DESIGN_ADAPTER.validate_python(payload)
        solid = make_solid(design, result['stats'].get('scale_applied', 1))
        from foldable.engine import solve
        net = solve(design, folder / 'verification')
        results[name] = (design, result, folder, net)
    yield client, results
    service.STORAGE = old_storage
    api.STORAGE = old_api_storage


def _passes(net):
    try:
        validate(net)
        return True
    except PrintError:
        return False


@pytest.mark.parametrize('name', ['robot', 'cat', 'blob', 'crystal', 'diamond'])
def test_real_export_geometry_artwork_and_page(rendered, name):
    client, results = rendered
    design, result, folder, net = results[name]
    assert set(REQUIRED_CHECKS) <= set(result['validation']['checks'])
    mesh = trimesh.Trimesh(net.solid.vertices, net.solid.triangles(), process=False)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0
    assert net.island_count == 1
    assert all(s.depth_mm >= 4.5 for s in net.seams)
    assert all(len(fs) == 2 for fs in net.solid.edges.values())
    for face, world, paper in projected_art(design, net):
        assert Polygon(net.placed[face].points).buffer(0.002).covers(LineString(paper))
        panel = net.solid.panels[face]
        local = (paper-net.placed[face].offset) @ net.placed[face].rotation
        reconstructed = panel.origin + local[:, :1]*panel.u + local[:, 1:]*panel.v
        np.testing.assert_allclose(reconstructed, world, atol=0.002)
    pdf = PdfReader(folder / 'net.pdf')
    assert len(pdf.pages) == 1
    page = pdf.pages[0]
    np.testing.assert_allclose([float(page.mediabox.width), float(page.mediabox.height)],
                              np.array([210, 297])*72/25.4, atol=0.01)
    assert design.name in page.extract_text()
    spans = pdf_spans(page)
    numbers = [span['text'] for span in spans
               if span['text'].isdigit() and abs(span['size']-6.5) < .01]
    for seam in net.seams:
        assert numbers.count(str(seam.number)) == 2
    for span in spans:
        x0, y0, x1, y1 = span['bbox']
        assert 0 <= x0 <= x1 <= float(page.mediabox.width) + .01
        assert 0 <= y0 <= y1 <= float(page.mediabox.height) + .01
    glb = trimesh.load(folder / 'model.glb', force='scene')
    loaded = next(iter(glb.geometry.values()))
    np.testing.assert_allclose(glb.extents, np.ptp(net.solid.vertices, axis=0)/1000, atol=1e-7)
    assert len(loaded.faces) == len(net.solid.triangles())
    expected_texture, uv_mapper = texture(design, net.solid)
    np.testing.assert_array_equal(np.asarray(loaded.visual.material.baseColorTexture), np.asarray(expected_texture))
    # Reopened GLB coordinates must sample the same image orientation as the PDF.
    offset = 0
    for panel in net.solid.panels:
        count = len(panel.vertices)
        expected = uv_mapper(net.solid.vertices[list(panel.vertices), :2]) if panel.normal[2] > 1e-6 else np.full((count, 2), .02)
        np.testing.assert_allclose(loaded.visual.uv[offset:offset+count], expected, atol=1e-6)
        offset += count
    for key, media in [('pdf_url', 'application/pdf'), ('model_url', 'model/gltf-binary'), ('preview_url', 'image/svg+xml')]:
        response = client.get(result[key])
        assert response.status_code == 200
        assert media in response.headers['content-type']
    assert client.post('/render', json=design.model_dump()).json() == result


def test_v1_compatibility_and_v2_shape_variation(rendered):
    client, results = rendered
    robot = results['robot'][1]
    assert set(robot) == {'design', 'mode', 'model_url', 'pdf_url', 'preview_url', 'validation', 'stats'}
    assert robot['stats'] == {'panel_count': 6, 'triangle_count': 12, 'page_count': 1, 'paper': 'A4', 'edge_mm': 40}
    cat = results['cat'][1]
    assert cat['stats']['panel_count'] == 20
    assert cat['interpretation'] == 'procedural_low_poly'
    assert client.get('/health').json()['supported_versions'] == [1, 2]
    assert len(client.get('/examples').json()) == 4
    assert 'shape' in client.get('/design-schema').json()['properties']


def test_long_printable_name_stays_inside_the_safe_page_margin(rendered, tmp_path):
    design, _, _, net = rendered[1]['robot']
    design = design.model_copy(update={'name': 'W' * 48})
    path = tmp_path / 'long-name.pdf'
    draw_net(design, net).pdf(path, design.name)
    page = PdfReader(path).pages[0]
    unit = 72 / 25.4
    for span in pdf_spans(page):
        x0, y0, x1, y1 = span['bbox']
        assert x0 >= 10 * unit - .05 and x1 <= 200 * unit + .05, span
        assert y0 >= 10 * unit - .05 and y1 <= 287 * unit + .05, span


@pytest.mark.parametrize('mutation,failed_check', [
    ('translate', 'page_bounds'), ('overlap', 'no_overlaps'),
    ('remove_tab', 'one_tab_per_seam'), ('duplicate_label', 'seam_labels'),
    ('shrink_tab', 'usable_tabs'), ('distort', 'seam_lengths'),
])
def test_rejects_corrupted_layout(rendered, mutation, failed_check):
    net = copy.deepcopy(rendered[1]['robot'][3])
    if mutation == 'translate':
        for p in net.placed.values():
            p.points += 300
            p.offset += 300
        for s in net.seams:
            s.tab += 300
    elif mutation == 'overlap':
        a, b = list(net.placed.values())[:2]
        b.points = a.points.copy()
    elif mutation == 'remove_tab':
        net.seams.pop()
    elif mutation == 'duplicate_label':
        net.seams[0].number = net.seams[1].number
    elif mutation == 'shrink_tab':
        net.seams[0].depth_mm = 1
    elif mutation == 'distort':
        net.placed[0].points[0] += [3, 4]
    with pytest.raises(PrintError) as caught:
        validate(net)
    assert failed_check in caught.value.details


@pytest.mark.parametrize('change', [
    {'shape': 'dragon'}, {'unexpected': True}, {'name': '\n'},
    {'name': '🐈'}, {'size_mm': 200}, {'proportions': {'width': .1}},
    {'version': 9}, {'face': {'eyes': 'laser'}},
])
def test_invalid_design_is_actionable(change):
    payload = json.loads((EXAMPLES / 'cat.design.json').read_text())
    payload.update(change)
    response = TestClient(app).post('/render', json=payload)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_DESIGN'


def test_asset_restrictions_and_body_limit():
    client = TestClient(app)
    assert client.get('/assets/'+'a'*24+'/design.json').status_code == 404
    assert client.get('/assets/invalid/net.pdf').status_code == 404
    assert client.post('/render', content='x'*33000).status_code == 413


def test_runtime_failure_is_503(monkeypatch):
    import foldable.app as api
    def unavailable(design):
        raise PrintError('Install Blender.', ['engine_unavailable'])
    monkeypatch.setattr(api, 'render_design', unavailable)
    response = TestClient(app).post('/render', json=json.loads((EXAMPLES/'robot.design.json').read_text()))
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'ENGINE_UNAVAILABLE'


def test_concurrent_render_is_busy():
    design = DESIGN_ADAPTER.validate_python({'version': 2, 'name': uuid.uuid4().hex})
    with service.LOCK:
        with pytest.raises(PrintError) as caught:
            service.render_design(design)
    assert caught.value.details == ['render_busy']


@pytest.mark.parametrize('shape', ['box', 'rounded', 'diamond', 'crystal'])
def test_supported_shapes_are_closed_at_extreme_proportions(shape):
    design = DESIGN_ADAPTER.validate_python({'version': 2, 'name': 'Boundary', 'shape': shape,
        'ears': 'pointed', 'size_mm': 65, 'proportions': {'width': .75, 'height': 1.3, 'depth': .75}})
    solid = make_solid(design)
    mesh = trimesh.Trimesh(solid.vertices, solid.triangles(), process=False)
    assert mesh.is_watertight and mesh.volume > 0
    assert np.isclose(mesh.extents.max(), 65)
