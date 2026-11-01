"""Deterministic box assemblies and matching long-edge duplex paper nets."""
from html import escape
import math
import numpy as np
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
import trimesh
from shapely.geometry import Polygon
from .geometry import make_solid
from .engine import validate, bounds, Net, Placed, Seam, PAGE_AREA
from .local_engine import solve_local
from .export import edge_angle
from .models import PrintError


def _contacts(parts):
    """Find face-to-face joins and reject intersecting or disconnected boxes."""
    def foot(part, side):
        name = part.id.lower()
        return side in name and any(word in name for word in ('foot', 'feet', 'leg'))
    left = next((p for p in parts if foot(p, 'left')), None)
    right = next((p for p in parts if foot(p, 'right')), None)
    if left and right:
        gap = right.position.x - right.width_mm / 2 - (left.position.x + left.width_mm / 2)
        if gap < 3.95:
            raise PrintError('Separate the left and right feet by at least 4 mm while keeping both attached to the body.', ['feet_gap'])
    solids = [make_solid(part) for part in parts]
    contacts = [[] for _ in parts]
    adjacency = [set() for _ in parts]
    for i, a in enumerate(parts):
        ca=np.array([a.position.x,a.position.y,a.position.z])
        da=np.array([a.width_mm,a.height_mm,a.depth_mm])
        for j in range(i+1,len(parts)):
            b=parts[j]
            cb=np.array([b.position.x,b.position.y,b.position.z])
            db=np.array([b.width_mm,b.height_mm,b.depth_mm])
            lo=np.maximum(ca-da/2,cb-db/2)
            hi=np.minimum(ca+da/2,cb+db/2)
            overlap=hi-lo
            if np.all(overlap > .05):
                raise PrintError('Parts overlap; adjust their positions so their faces meet.', ['assembly_overlap'])
            for axis in range(3):
                other=[k for k in range(3) if k != axis]
                if abs(overlap[axis]) <= .05 and all(overlap[k] > 2 for k in other):
                    sign=1 if cb[axis]>ca[axis] else -1
                    normal=np.zeros(3); normal[axis]=sign
                    pa=next((p for p in solids[i].panels if np.dot(p.normal,normal) > .99999), None)
                    pb=next((p for p in solids[j].panels if np.dot(p.normal,normal) < -.99999), None)
                    if pa is None or pb is None:
                        continue
                    va=solids[i].vertices[list(pa.vertices)]+ca
                    vb=solids[j].vertices[list(pb.vertices)]+cb
                    contact=Polygon(va[:,other]).intersection(Polygon(vb[:,other]))
                    if contact.is_empty or contact.area <= 4:
                        continue
                    xmin,ymin,xmax,ymax=contact.bounds
                    if min(xmax-xmin,ymax-ymin) <= 2:
                        continue
                    # Axis-extreme faces of the supported prisms are rectangular.
                    lo=lo.copy(); hi=hi.copy()
                    lo[other]=[xmin,ymin]; hi[other]=[xmax,ymax]
                    contacts[i].append((j,axis,sign,lo,hi))
                    contacts[j].append((i,axis,-sign,lo,hi))
                    adjacency[i].add(j); adjacency[j].add(i)
                    break
    seen={0}; pending=[0]
    while pending:
        current=pending.pop()
        for neighbor in adjacency[current]-seen:
            seen.add(neighbor); pending.append(neighbor)
    if len(seen) != len(parts):
        raise PrintError('Parts must touch face-to-face so they can be glued together.', ['assembly_disconnected'])
    return contacts


def _contact_outline(part, net, contact):
    _,axis,sign,lo,hi=contact
    other=[k for k in range(3) if k != axis]
    center=np.array([part.position.x,part.position.y,part.position.z])
    dimensions=np.array([part.width_mm,part.height_mm,part.depth_mm])
    normal=np.zeros(3); normal[axis]=sign
    face=max(range(len(net.solid.panels)),key=lambda k: np.dot(net.solid.panels[k].normal,normal))
    panel=net.solid.panels[face]; placed=net.placed[face]
    points=[]
    for a,b in [(lo[other[0]],lo[other[1]]),(hi[other[0]],lo[other[1]]),
                (hi[other[0]],hi[other[1]]),(lo[other[0]],hi[other[1]])]:
        world=center.copy(); world[axis]+=sign*dimensions[axis]/2
        world[other[0]]=a; world[other[1]]=b
        local=world-center-panel.origin
        points.append(np.array([local @ panel.u, local @ panel.v]) @ placed.rotation.T + placed.offset)
    return np.array(points)


def _art_outline(part, solid, item):
    if item.shape == 'rect':
        coords = [(-1,-1),(1,-1),(1,1),(-1,1)]
    else:
        coords = [(math.cos(a), math.sin(a)) for a in np.linspace(0, 2*math.pi, 49)[:-1]]
    art=Polygon([((item.x+dx*item.width/2-.5)*part.width_mm,
                  (.5-item.y-dy*item.height/2)*part.height_mm) for dx,dy in coords])
    panel=solid.panels[solid.front_panel]
    face=Polygon(solid.vertices[list(panel.vertices),:2])
    clipped=art.intersection(face)
    if clipped.is_empty or clipped.geom_type != 'Polygon' or clipped.area < 1e-8:
        return np.empty((0,2))
    return np.asarray(clipped.exterior.coords[:-1])


def _front_art(part, net, item):
    p = net.solid.panels[net.solid.front_panel]
    placement = net.placed[net.solid.front_panel]
    outline = _art_outline(part, net.solid, item)
    if not len(outline):
        return np.empty((0,2))
    world=np.column_stack((outline, np.full(len(outline), part.depth_mm/2)))
    local = np.column_stack(((world - p.origin) @ p.u, (world - p.origin) @ p.v))
    return local @ placement.rotation.T + placement.offset


def _commands(part, net, reverse=False, contacts=None, parts=None):
    commands = []
    def poly(points, fill=None, stroke='#000000', width=.2, dash=False):
        points = np.asarray(points, dtype=float).copy()
        if reverse: points[:,0] = 210 - points[:,0]
        commands.append(('poly', points, fill, stroke, width, dash))
    def text(x, y, label, size=7):
        commands.append(('text', 210-x if reverse else x, y, str(label), size))
    if not reverse:
        for p in net.placed.values(): poly(p.points, fill=part.color, stroke=None)
        for art in part.artwork:
            points = _front_art(part, net, art)
            if len(points): poly(points, fill=art.color, stroke=None)
    for edge in sorted(net.hinges):
        poly(net.edge_points(net.solid.edges[edge][0], edge), dash=True, width=.16)
    for seam in net.seams:
        for face in seam.faces:
            points = net.edge_points(face, seam.edge)
            if face == seam.tab_face:
                poly(seam.tab)
                poly([seam.tab[0], seam.tab[-1]], dash=True, width=.16)
                center = np.asarray(seam.tab).mean(axis=0)
            else:
                poly(points)
                middle = points.mean(axis=0)
                inward = net.placed[face].points.mean(axis=0) - middle
                inward /= np.linalg.norm(inward)
                center = middle + 2.3 * inward
            if reverse: text(center[0], center[1], seam.number, 6.5)
    if reverse:
        for contact in contacts or []:
            outline=_contact_outline(part,net,contact)
            poly(np.vstack((outline,outline[0])), stroke='#666666', width=.15, dash=True)
            center=outline.mean(axis=0)
            text(center[0],center[1], 'glue ' + parts[contact[0]].id, 6)
    # A consistent bounding box and registration ticks aid physical duplex alignment.
    bb = bounds([p.points for p in net.placed.values()] + [s.tab for s in net.seams])
    x1,y1,x2,y2 = bb + np.array([-3,-3,3,3])
    poly([(x1,y1),(x2,y1),(x2,y2),(x1,y2),(x1,y1)], stroke='#888888', width=.12)
    for x,y in [(8,65),(202,65),(8,250),(202,250)]:
        poly([(x-2,y),(x+2,y)],width=.15); poly([(x,y-2),(x,y+2)],width=.15)
    if reverse:
        text(105, 275, part.id + ' - match numbers; glue tabs inside', 7)
    return commands


def _canvas_draw(c, commands):
    for cmd in commands:
        if cmd[0] == 'text':
            _,x,y,label,size=cmd
            c.setFillColor(HexColor('#333333')); c.setFont('Helvetica',size)
            c.drawCentredString(x*mm,y*mm,label)
            continue
        _,points,fill,stroke,width,dash=cmd
        c.setLineWidth(width*mm); c.setDash(1.5*mm,.9*mm) if dash else c.setDash()
        if fill: c.setFillColor(HexColor(fill))
        if stroke: c.setStrokeColor(HexColor(stroke))
        p=c.beginPath()
        for i,(x,y) in enumerate(points): (p.moveTo if i==0 else p.lineTo)(x*mm,y*mm)
        if fill: p.close()
        c.drawPath(p, fill=int(bool(fill)), stroke=int(bool(stroke)))


def _svg_draw(commands, offset):
    out=[]
    for cmd in commands:
        if cmd[0]=='text':
            _,x,y,label,size=cmd
            out.append(f'<text x="{x:.3f}" y="{offset+297-y:.3f}" font-size="{size*25.4/72:.3f}" text-anchor="middle">{escape(label)}</text>')
            continue
        _,points,fill,stroke,width,dash=cmd
        pts=' '.join(f'{x:.4f},{offset+297-y:.4f}' for x,y in points)
        tag='polygon' if fill else 'polyline'
        out.append(f'<{tag} points="{pts}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width}"'+(' stroke-dasharray="1.5 .9"' if dash else '')+'/>')
    return out


def export_assembly(design, nets, contacts, folder):
    c=Canvas(str(folder/'net.pdf'), pagesize=(210*mm,297*mm), pageCompression=1)
    c.setTitle(design.name)
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="{297*len(nets)}mm" viewBox="0 0 210 {297*len(nets)}">', f'<rect width="210" height="{297*len(nets)}" fill="white"/>']
    for i,(part,net) in enumerate(zip(design.parts,nets)):
        outside=_commands(part,net)
        _canvas_draw(c,outside)
        c.setFillColor(HexColor('#333333')); c.setFont('Helvetica', 8)
        c.drawRightString(200*mm, 286*mm, str(2*i+1)); c.showPage()
        _canvas_draw(c,_commands(part,net,True,contacts[i],design.parts))
        c.setFillColor(HexColor('#333333')); c.setFont('Helvetica', 8)
        c.drawRightString(200*mm, 286*mm, str(2*i+2)); c.showPage()
        out.extend(_svg_draw(outside, i*297))
    c.save(); out.append('</svg>'); (folder/'net.svg').write_text('\n'.join(out),encoding='utf-8')
    scene=trimesh.Scene()
    for part,net in zip(design.parts,nets):
        center=np.array([part.position.x,part.position.y,part.position.z])/1000
        solid=net.solid
        mesh=trimesh.Trimesh(vertices=solid.vertices/1000+center,faces=solid.triangles(),process=False)
        mesh.visual.face_colors = list(bytes.fromhex(part.color[1:])) + [255]
        scene.add_geometry(mesh,node_name=part.id)
        for j,art in enumerate(part.artwork):
            outline=_art_outline(part,solid,art)
            if not len(outline):
                continue
            verts=np.column_stack((outline[:,0]+part.position.x, outline[:,1]+part.position.y,
                                  np.full(len(outline), part.position.z+part.depth_mm/2+.05+j*.05)))/1000
            # Shapely polygons can be clockwise; ensure the decal faces forward.
            area=np.sum(outline[:,0]*np.roll(outline[:,1],-1)-outline[:,1]*np.roll(outline[:,0],-1))
            faces=[(0,k,k+1) if area > 0 else (0,k+1,k) for k in range(1,len(verts)-1)]
            decal=trimesh.Trimesh(vertices=verts,faces=faces,process=False)
            decal.visual.face_colors=list(bytes.fromhex(art.color[1:]))+[255]
            scene.add_geometry(decal,node_name=f'{part.id}_art_{j}')
    (folder/'model.glb').write_bytes(scene.export(file_type='glb'))


def render_assembly(design, folder):
    contacts=_contacts(design.parts)
    nets=[]
    for part in design.parts:
        net=solve_local(part, folder, Net, Placed, Seam, PAGE_AREA, validate)
        if net.scale != 1:
            raise PrintError('This part cannot fit at its requested size.', ['page_bounds'])
        validate(net)
        nets.append(net)
    export_assembly(design,nets,contacts,folder)
    return nets
