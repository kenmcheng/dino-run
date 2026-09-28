"""Static (unrigged) assets: items, course props and scenery.

Each asset is a set of high-poly parts. Every part names the game mesh it
belongs to (`mesh`), e.g. a palm's 'trunk' and 'fronds', so the game can give
them different materials (only the fronds sway in the wind). All meshes of an
asset share one texture atlas:

  <name>_color.webp   sRGB base colour
  <name>_orm.webp     R ambient occlusion, G roughness, B metalness
  <name>_normal.webp  tangent-space normal
  <name>_emit.webp    glow mask (only for assets with emissive parts)

Part attributes (point colours on the high-poly):
  col = linear base colour, mat = (roughness, metalness, emission 0..1)
"""
import os

import bpy
import numpy as np

from . import bake as B
from . import common as C


class Part:
    def __init__(self, hi, mesh='main', tris=500, uvw=1.0, lo=None):
        self.hi, self.mesh, self.tris, self.uvw, self.lo = hi, mesh, tris, uvw, lo
        self.name = hi.name if hi is not None else mesh


def paint(obj, color, rough=0.6, metal=0.0, emit=0.0):
    C.set_attr(obj, 'col', C.hex_lin(color))
    C.set_attr(obj, 'mat', (rough, metal, emit, 1.0))
    return obj


def paint_fn(obj, fn):
    """fn(game_pos, game_normal) -> (hex or linear rgb, rough, metal, emit)"""
    me = obj.data
    me.update()
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co)
    nr = np.empty(n * 3); me.vertices.foreach_get('normal', nr)
    gp = C.to_game(co.reshape(n, 3)); gn = C.to_game(nr.reshape(n, 3))
    cols, mats = [], []
    for p, q in zip(gp, gn):
        c, r, m, e = fn(p, q)
        cols.append(C.hex_lin(c) if isinstance(c, str) else (*c, 1.0))
        mats.append((r, m, e, 1.0))
    for name, arr in (('col', cols), ('mat', mats)):
        a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', np.asarray(arr, dtype=np.float32).ravel())
    return obj


def lowify(part):
    lo = C.copy_obj(part.hi, part.name + '_lo')
    for a in list(lo.data.color_attributes):
        lo.data.color_attributes.remove(a)
    C.decimate(lo, part.tris)
    B.unwrap(lo, angle=66, margin=0.02)
    part.lo = lo
    return lo


def build(name, group, parts, size=512, emissive=False, extrusion=0.03, ray=0.08, ao_distance=0.5, preview=None):
    """Bake and export one static asset. Returns its manifest entry."""
    his = [p.hi for p in parts if p.hi is not None]
    # game meshes made up front would shadow the sculpt they wrap: hide them for the AO
    for p in parts:
        if p.lo is not None:
            p.lo.hide_render = True
    B.bake_vertex_ao(his, distance=ao_distance)
    for p in parts:
        if p.lo is not None:
            p.lo.hide_render = False
    for h in his:
        B.assign(h, B.hi_material('hi_' + h.name))
    meshes = []
    for p in parts:
        if p.mesh not in meshes:
            meshes.append(p.mesh)
        if p.lo is None:
            lowify(p)
        else:
            if not p.lo.data.uv_layers:
                B.unwrap(p.lo, angle=66, margin=0.02)
        p.lo.data.materials.clear()
        for m in meshes:
            p.lo.data.materials.append(B.plain_material(m))
        idx = meshes.index(p.mesh)
        for poly in p.lo.data.polygons:
            poly.material_index = idx
    # every part's slot list must match the final list
    for p in parts:
        while len(p.lo.data.materials) < len(meshes):
            p.lo.data.materials.append(B.plain_material(meshes[len(p.lo.data.materials)]))
    los = [p.lo for p in parts]
    B.uv_edit(los)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in parts:
        B.weight_uvs(p.lo, p.uvw)
    lo = C.join(los, name + '_lo')
    B.pack(lo, margin=0.006)
    names = [m.name for m in lo.data.materials]
    passes = [('col', 'col'), ('mat', 'mat'), ('ao', 'ao'), ('normal', None)]
    res = {}
    for tag, attr in passes:
        img = B.new_image(f'{name}_{tag}', size)
        if attr:
            B.set_pass([h.data.materials[0] for h in his], attr, False)
        res[tag] = B.bake_pass(lo, his, img, 'EMIT' if attr else 'NORMAL', extrusion=extrusion, ray=ray)
    B.set_slots(lo, [B.plain_material(n) for n in names])

    out_dir = os.path.join(C.OUT, group)
    c, m, ao, nm = res['col'], res['mat'], res['ao'], res['normal']
    cov = c[..., 3] > 0.5
    one = np.ones_like(ao[..., 0])
    col = np.dstack([B.lin_to_srgb(c[..., 0]), B.lin_to_srgb(c[..., 1]), B.lin_to_srgb(c[..., 2]), one])
    B.save_webp(B.dilate_alpha(col, cov), os.path.join(out_dir, f'{name}_color.webp'))
    B.save_webp(B.dilate_alpha(np.dstack([ao[..., 0], m[..., 0], m[..., 1], one]), cov), os.path.join(out_dir, f'{name}_orm.webp'))
    B.save_webp(B.dilate_alpha(np.dstack([nm[..., 0], nm[..., 1], nm[..., 2], one]), cov), os.path.join(out_dir, f'{name}_normal.webp'))
    files = {'color': f'{name}_color.webp', 'orm': f'{name}_orm.webp', 'normal': f'{name}_normal.webp'}
    if emissive:
        e = m[..., 2]
        B.save_webp(B.dilate_alpha(np.dstack([e, e, e, one]), cov), os.path.join(out_dir, f'{name}_emit.webp'))
        files['emit'] = f'{name}_emit.webp'

    # one object per game mesh, named after it
    C.select_only([lo])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    objs = [o for o in bpy.context.selected_objects]
    tris = {}
    for o in objs:
        used = {p.material_index for p in o.data.polygons}
        mname = o.data.materials[next(iter(used))].name if used else o.data.materials[0].name
        B.assign(o, B.plain_material(mname))
        o.name = mname
        o.data.name = mname
        tris[mname] = C.tri_count(o)
    for h in his:
        h.hide_render = True
    if preview:
        preview(objs, out_dir, files)
    B.export_glb(objs, os.path.join(out_dir, f'{name}.glb'))
    C.log(f'  {name}: {sum(tris.values())} triangles {tris}')
    return {'file': f'{group}/{name}.glb', 'textures': {'pbr': files}, 'tris': sum(tris.values()), 'meshes': tris}
