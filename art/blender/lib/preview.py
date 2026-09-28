"""Review renders of the finished game meshes (low-poly + baked textures).

They use the saved WebP files, so they also check the texture output. Renders go
to art/.cache/previews/ and are not shipped.
"""
import colorsys
import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import bake as B
from . import common as C

PREVIEWS = os.path.join(C.CACHE, 'previews')


def palette(hex_):
    """Same derivation as palette() in public/js/three/dino3d.js (sRGB hex out)."""
    h = hex_.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    to = lambda hh, s, l: '#%02x%02x%02x' % tuple(int(round(max(0, min(1, x)) * 255)) for x in colorsys.hls_to_rgb(hh % 1, max(0, min(1, l)), max(0, min(1, s))))
    belly = to(hh, max(0, s - 0.18), min(0.88, l + (-0.06 if l > 0.7 else 0.17)))
    dark = to(hh, s + 0.04, l + (0.14 if l < 0.25 else -0.2))
    accent = '#e5484d' if s < 0.1 else to(hh + 0.08, s + 0.12, l - 0.04)
    return dict(base=hex_, belly=belly, dark=dark, accent=accent)


def _img(path, data):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def _rgb(nt, hex_):
    n = nt.nodes.new('ShaderNodeRGB')
    n.outputs[0].default_value = C.hex_lin(hex_)
    return n.outputs[0]


def _mix(nt, a, b, fac, blend='MIX'):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    nt.links.new(fac, m.inputs['Factor'])
    nt.links.new(a, m.inputs['A'])
    nt.links.new(b, m.inputs['B'])
    return m.outputs['Result']


def fabric_material(files, out_dir, pal, alpha=1.0):
    mat = bpy.data.materials.new('pv_fabric')
    nt = B._nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    mask = nt.nodes.new('ShaderNodeTexImage'); mask.image = _img(os.path.join(out_dir, files['mask']), True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(mask.outputs['Color'], sep.inputs['Color'])
    col = _rgb(nt, pal['base'])
    col = _mix(nt, col, _rgb(nt, pal['belly']), sep.outputs['Green'])
    col = _mix(nt, col, _rgb(nt, pal['dark']), sep.outputs['Red'])
    col = _mix(nt, col, _rgb(nt, pal['accent']), sep.outputs['Blue'])
    ao = nt.nodes.new('ShaderNodeMath'); ao.operation = 'MULTIPLY_ADD'
    nt.links.new(mask.outputs['Alpha'], ao.inputs[0]); ao.inputs[1].default_value = 0.85; ao.inputs[2].default_value = 0.15
    aoc = nt.nodes.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        nt.links.new(ao.outputs[0], aoc.inputs[k])
    col = _mix(nt, col, aoc.outputs['Color'], nt.nodes.new('ShaderNodeValue').outputs[0], 'MULTIPLY')
    nt.nodes['Value'].outputs[0].default_value = 1.0
    nt.links.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.5
    bsdf.inputs['Sheen Weight'].default_value = 0.6
    bsdf.inputs['Coat Weight'].default_value = 0.2
    bsdf.inputs['Alpha'].default_value = alpha
    nrm = nt.nodes.new('ShaderNodeTexImage'); nrm.image = _img(os.path.join(out_dir, files['normal']), True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def trim_material(files, out_dir, tint='#2f80ed'):
    mat = bpy.data.materials.new('pv_trim')
    nt = B._nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    ci = nt.nodes.new('ShaderNodeTexImage'); ci.image = _img(os.path.join(out_dir, files['color']), False)
    oi = nt.nodes.new('ShaderNodeTexImage'); oi.image = _img(os.path.join(out_dir, files['orm']), True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(oi.outputs['Color'], sep.inputs['Color'])
    col = _mix(nt, ci.outputs['Color'], _rgb(nt, tint), sep.outputs['Blue'], 'MULTIPLY')
    aoc = nt.nodes.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        nt.links.new(sep.outputs['Red'], aoc.inputs[k])
    one = nt.nodes.new('ShaderNodeValue'); one.outputs[0].default_value = 1.0
    col = _mix(nt, col, aoc.outputs['Color'], one.outputs[0], 'MULTIPLY')
    nt.links.new(col, bsdf.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    ni = nt.nodes.new('ShaderNodeTexImage'); ni.image = _img(os.path.join(out_dir, files['normal']), True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(ni.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def simple(name, hex_, rough=0.6, transmission=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    nt = B._nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = C.hex_lin(hex_)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Transmission Weight'].default_value = transmission
    bsdf.inputs['Alpha'].default_value = alpha
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def stage(target=(0, 1.3, 0)):
    sc = bpy.context.scene
    sc.world = sc.world or bpy.data.worlds.new('World')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = 0.1
    so = C.link(bpy.data.objects.new('sun', sun))
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    floor = C.uv_sphere('floor', 1, 48, 4, phi=(0, 0.05), pos=(0, -1, 0), scale=(3000, 1, 3000))
    floor.data.materials.append(simple('floor', '#c8b8a0', 0.9))
    cam = bpy.data.cameras.new('cam'); cam.lens_unit = 'FOV'; cam.angle = math.radians(34)
    co = C.link(bpy.data.objects.new('cam', cam))
    sc.camera = co
    sc.render.resolution_x = sc.render.resolution_y = 640
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    return co


def shoot(co, eye, target, path):
    co.location = C.G(*eye)
    d = C.G(*target) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = B.pixels(img).copy()
    bpy.data.images.remove(img)
    return px


def sheet(images, path):
    arr = np.concatenate(images, axis=1)
    h, w = arr.shape[:2]
    img = bpy.data.images.new('sheet', w, h, alpha=True)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    C.log('  preview', os.path.relpath(path, C.REPO))


def pbr_material(files, out_dir, tint=None):
    mat = bpy.data.materials.new('pv_pbr')
    nt = B._nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    ci = nt.nodes.new('ShaderNodeTexImage'); ci.image = _img(os.path.join(out_dir, files['color']), False)
    oi = nt.nodes.new('ShaderNodeTexImage'); oi.image = _img(os.path.join(out_dir, files['orm']), True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(oi.outputs['Color'], sep.inputs['Color'])
    aoc = nt.nodes.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        nt.links.new(sep.outputs['Red'], aoc.inputs[k])
    one = nt.nodes.new('ShaderNodeValue'); one.outputs[0].default_value = 1.0
    col = ci.outputs['Color']
    if tint:
        col = _mix(nt, col, _rgb(nt, tint), one.outputs[0], 'MULTIPLY')
    col = _mix(nt, col, aoc.outputs['Color'], one.outputs[0], 'MULTIPLY')
    nt.links.new(col, bsdf.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    ni = nt.nodes.new('ShaderNodeTexImage'); ni.image = _img(os.path.join(out_dir, files['normal']), True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(ni.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if 'emit' in files:
        ei = nt.nodes.new('ShaderNodeTexImage'); ei.image = _img(os.path.join(out_dir, files['emit']), True)
        nt.links.new(ci.outputs['Color'], bsdf.inputs['Emission Color'])
        nt.links.new(ei.outputs['Color'], bsdf.inputs['Emission Strength'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def render_static(name, objs, out_dir, files, tint=None):
    """One review shot of a static asset, framed on its bounds."""
    os.makedirs(PREVIEWS, exist_ok=True)
    keep = {o.name: [m.name for m in o.data.materials] for o in objs}
    mat = pbr_material(files, out_dir, tint)
    for o in objs:
        B.set_slots(o, [mat] * len(o.data.materials))
    pts =np.concatenate([C.to_game(C.verts_np(o)) for o in objs])
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    c = (lo + hi) / 2
    r = float(np.linalg.norm(hi - lo)) / 2
    co = stage()
    floor = bpy.data.objects['floor']
    floor.location = C.G(0, lo[1] - 0.001, 0)
    d = r / math.tan(math.radians(17)) * 1.05
    eye = (c[0] + d * 0.55, c[1] + d * 0.45, c[2] + d * 0.7)
    px = shoot(co, eye, tuple(c), os.path.join(PREVIEWS, name + '.png'))
    C.log('  preview', os.path.relpath(os.path.join(PREVIEWS, name + '.png'), C.REPO))
    for o in objs:
        B.set_slots(o, [B.plain_material(n) for n in keep[o.name]])
    for ob in ('floor', 'sun', 'cam'):
        if ob in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[ob], do_unlink=True)
    return px


def render_costume(name, sp, fab_lo, trim_lo, extra, out_dir, files):
    os.makedirs(PREVIEWS, exist_ok=True)
    pal = palette(sp['color'])
    fm = fabric_material(files['fabric'], out_dir, pal)
    mm = fabric_material(files['fabric'], out_dir, pal, 0.9)
    names = [m.name for m in fab_lo.data.materials]
    B.set_slots(fab_lo, [mm if n == 'membrane' else fm for n in names])
    tm = trim_material(files['trim'], out_dir)
    B.set_slots(trim_lo, [tm])
    looks = {'face': simple('pv_face', '#f1c9a5', 0.8), 'window': simple('pv_window', '#ffffff', 0.02, 1.0), 'bib': simple('pv_bib', '#fafafa', 0.85)}
    for o in extra:
        B.set_slots(o, [looks[o.name.split('.')[0]]])
    co = stage()
    base = os.path.join(PREVIEWS, name)
    shots = [shoot(co, (3.4, 2.4, 5.6), (0, 1.3, 0), base + '_a.png'),
             shoot(co, (-4.2, 2.8, -4.6), (0, 1.2, -0.3), base + '_b.png'),
             shoot(co, (1.2, 2.1, 2.4), (0, 1.75, 0.3), base + '_c.png')]
    sheet(shots, base + '.png')
    # restore glTF material names for export
    for o, ns in ((fab_lo, names), (trim_lo, ['trim'])):
        B.set_slots(o, [B.plain_material(n) for n in ns])
    for o in extra:
        B.set_slots(o, [B.plain_material(o.name.split('.')[0])])
    for ob in ('floor', 'sun', 'cam'):
        if ob in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[ob], do_unlink=True)
