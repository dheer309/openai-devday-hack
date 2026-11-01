from pathlib import Path
import uuid

import numpy as np
import pymupdf
import pytest
from shapely.geometry import LineString, Polygon
import trimesh

from foldable.engine import validate
from foldable.service import STORAGE
from foldable.standing_pet import build, on_face


@pytest.fixture(scope='module')
def standing():
    folder = STORAGE / ('standing-test-'+uuid.uuid4().hex)
    parts, drawing = build(folder)
    return folder, parts, drawing


def test_two_boxes_fit_share_artwork_and_have_attachment_contact(standing):
    folder, parts, drawing = standing
    head, body = parts
    assert head.center[1]-head.dims[1]/2 == body.center[1]+body.dims[1]/2
    assert body.center[1]-body.dims[1]/2 == 0
    assert head.dims[0] > body.dims[0] and head.dims[2] > body.dims[2]
    for p in parts:
        assert validate(p.net)
        assert len(p.net.seams) == 7
        assert min(s.depth_mm for s in p.net.seams) >= 5.99
        f = p.net.solid.front_panel
        face_polygon = Polygon(p.net.placed[f].points)
        for path in p.paths:
            world = np.column_stack((path, np.full(len(path), p.dims[2]/2)))
            assert face_polygon.buffer(.002).covers(LineString(on_face(p, (0, 0, 1), world)))
    assert sum(len(p.net.seams) for p in parts) == 14
    # A centred stack's centre of mass projects within the unassisted body base.
    volumes = [np.prod(p.dims) for p in parts]
    com = np.average(np.array([p.center for p in parts]), axis=0, weights=volumes)
    assert abs(com[0]) < body.dims[0]/2 and abs(com[2]) < body.dims[2]/2


def test_pdf_labels_margin_scale_and_glb_match(standing):
    folder, parts, drawing = standing
    with pymupdf.open(folder/'standing-bsod-duplex-a4.pdf') as doc:
        assert len(doc) == 2
        for page in doc:
            np.testing.assert_allclose([page.rect.width, page.rect.height], np.array([210, 297])*72/25.4, atol=.01)
        text = doc[1].get_text()
        assert 'BODY HERE' in doc[0].get_text()
        assert 'GLUE TO HEAD' in doc[0].get_text()
        assert 'BODY HERE' not in text and 'GLUE TO HEAD' not in text
        for prefix in ('H', 'B'):
            for number in range(1, 8):
                assert text.split().count(f'{prefix}{number}') == 2
                assert f'{prefix}{number}' not in doc[0].get_text().split()
        assert 'INSIDE / BACK' in text
        for page in doc:
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    for span in line['spans']:
                        assert page.rect.contains(pymupdf.Rect(span['bbox']))
        # Compare all net and optional-piece line segments after long-edge flipping.
        # Artwork is 0.32 mm, so filter for 0.16/0.24 mm fold/cut lines.
        def segments(page, mirror=False):
            found = set()
            for path in page.get_drawings():
                if not any(abs(path['width']-w*72/25.4) < .005 for w in (.16, .24)):
                    continue
                for item in path['items']:
                    if item[0] != 'l':
                        continue
                    a, b = item[1], item[2]
                    if not all(80*72/25.4 < p.y < 215*72/25.4 for p in (a, b)):
                        continue
                    pts = [(page.rect.width-p.x if mirror else p.x, p.y) for p in (a, b)]
                    found.add(tuple(sorted((round(x, 2), round(y, 2)) for x, y in pts)))
            return found
        front_lines = segments(doc[0])
        assert len(front_lines) > 70
        assert front_lines <= segments(doc[1], mirror=True)
    for item in drawing.items:
        if item['kind'] in ('line', 'polygon'):
            assert np.all(item['points'] >= [10, 10])
            assert np.all(item['points'] <= [200, 287])
    scene = trimesh.load(folder/'standing-bsod.glb', force='scene')
    assert len(scene.geometry) == 2
    np.testing.assert_allclose(scene.extents, [.036, .054, .026], atol=1e-7)
    assert all(len(mesh.faces) == 12 for mesh in scene.geometry.values())
