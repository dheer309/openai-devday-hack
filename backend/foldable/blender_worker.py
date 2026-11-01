"""Isolated worker using the established Export Paper Model engine.

Run with a Python containing bpy, or blender -b --python this_file -- in out.
The upstream engine owns cuts, rigid unfolding, tab shapes and page packing.
We serialize its exact geometry for independent validation and presentation.
"""
import json
from pathlib import Path
import sys
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def calculate(data):
    import bpy
    import bmesh
    from mathutils import Vector
    from foldable.vendor.export_paper_model.unfolder import Unfolder, paginate_islands

    last_error = None
    # Alternative upstream heuristics; the algorithm itself is unchanged.
    priorities = [
        {"CONVEX": 0.5, "CONCAVE": 1, "LENGTH": -0.05},
        {"CONVEX": 0, "CONCAVE": 1, "LENGTH": -1},
        {"CONVEX": 1, "CONCAVE": 1, "LENGTH": 0.1},
    ]
    results = []
    for priority in priorities:
        mesh = bpy.data.meshes.new("FoldableModel")
        mesh.from_pydata(data["vertices"], [], data["faces"])
        mesh.update()
        obj = bpy.data.objects.new("FoldableModel", mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bm = bmesh.from_edit_mesh(mesh)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        bm.normal_update()
        unfolder = None
        try:
            unfolder = Unfolder(obj)
            cage = Vector((190, 199))
            unfolder.prepare(cage, priority, scale=1, limit_by_page=True)
            unfolder.mesh.generate_stickers(6, "NONE")
            unfolder.mesh.finalize_islands(cage)
            pages = paginate_islands(unfolder.mesh.islands, cage)
            if len(pages) != 1:
                raise ValueError("The net requires more than one A4 page.")
            placed = {}
            for island_id, island in enumerate(unfolder.mesh.islands):
                for face, uv in island.faces.items():
                    coords = {loop.vert.index: list(vertex.co + island.pos)
                              for loop, vertex in uv.vertices.items()}
                    placed[str(face.index)] = {
                        "points": [coords[i] for i in data["faces"][face.index]],
                        "island": island_id,
                    }
            seams, hinges = [], []
            for edge in unfolder.mesh.edges.values():
                ids = sorted(v.index for v in edge.data.verts)
                if not edge.is_main_cut:
                    hinges.append(ids)
                    continue
                uses = edge.uvedges
                if len(uses) != 2:
                    raise ValueError("A cut edge has no unique mating face.")
                tabs = [use for use in uses if use.sticker is not None]
                if len(tabs) != 1:
                    raise ValueError("A seam does not have exactly one glue tab.")
                use = tabs[0]
                seams.append({"edge": ids, "faces": [u.uvface.face.index for u in uses],
                              "tab_face": use.uvface.face.index,
                              "tab": [list(p + use.uvface.island.pos) for p in use.sticker.points]})
            results.append({"placed": placed, "seams": seams, "hinges": hinges,
                            "island_count": len(unfolder.mesh.islands)})
        except Exception as exc:
            last_error = str(exc)
        finally:
            if unfolder is not None:
                del unfolder
            bpy.ops.object.mode_set(mode="OBJECT")
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
    if not results:
        raise ValueError(last_error or "No valid layout was found.")
    return {"candidates": results, "engine": "Export Paper Model 1.4.2", "blender": bpy.app.version_string}


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    output = Path(args[1])
    try:
        result = calculate(json.loads(Path(args[0]).read_text()))
        output.write_text(json.dumps(result), encoding="utf-8")
    except Exception as error:
        traceback.print_exc()
        output.write_text(json.dumps({"error": str(error)}), encoding="utf-8")
        sys.exit(1)
