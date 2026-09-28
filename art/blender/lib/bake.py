"""High-poly -> low-poly texture baking (Cycles, GPU) and texture/GLB output.

Every high-poly part carries point colour attributes describing what it is:

  fabric parts  mask = (dark, belly, accent, pattern-allowed)   see PATTERNS
  trim parts    col  = linear base colour
                mat  = (roughness, metalness, runtime tint mask)
  all parts     ao   = baked ambient occlusion (filled in by bake_vertex_ao)

Emission bakes carry RGB only, so each output channel group is its own pass.

The bakes turn those into textures on the low-poly UV atlas:

  <name>_fabric_mask.webp    R dark markings, G belly, B accent, A ambient occlusion (0.2..1)
  <name>_fabric_normal.webp  tangent-space normal (MikkTSpace, +Y green)
  <name>_trim_color.webp     sRGB colour
  <name>_trim_orm.webp       R ambient occlusion, G roughness, B tint mask (runner's sneaker colour)
  <name>_trim_normal.webp    tangent-space normal

No texture stores data in a zero alpha: browsers may premultiply on decode.
"""
import math
import os

import bpy
import numpy as np

from . import common as C

# Species markings, printed onto fabric where mask.a > 0 (object/model space).
PATTERNS = ('none', 'stripes', 'tiger', 'spots', 'scales', 'patches')
DEBUG_PNG = False  # also write PNG copies of textures to art/.cache/previews/tex (set by --preview)


def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt


def _pattern_node(nt, kind, coord):
    """Return a node socket with a 0..1 marking value for `kind`."""
    if kind in ('stripes', 'tiger'):
        w = nt.nodes.new('ShaderNodeTexWave')
        w.wave_type = 'BANDS'
        w.bands_direction = 'Y'  # Blender Y == game -Z: bands across the body
        w.inputs['Scale'].default_value = 1.6 if kind == 'stripes' else 2.4
        w.inputs['Distortion'].default_value = 5.0 if kind == 'stripes' else 9.0
        w.inputs['Detail'].default_value = 2.0
        w.inputs['Detail Scale'].default_value = 1.5
        nt.links.new(coord, w.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.62 if kind == 'stripes' else 0.7
        ramp.color_ramp.elements[1].position = 0.68 if kind == 'stripes' else 0.74
        nt.links.new(w.outputs['Fac'], ramp.inputs['Fac'])
        return ramp.outputs['Color']
    if kind in ('spots', 'scales'):
        v = nt.nodes.new('ShaderNodeTexVoronoi')
        v.feature = 'F1' if kind == 'spots' else 'DISTANCE_TO_EDGE'
        v.inputs['Scale'].default_value = 4.2 if kind == 'spots' else 11.0
        v.inputs['Randomness'].default_value = 0.9
        nt.links.new(coord, v.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        if kind == 'spots':
            # small distance = inside a spot
            ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
            ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
            ramp.color_ramp.elements[0].position = 0.26
            ramp.color_ramp.elements[1].position = 0.3
        else:
            ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.55, 1)
            ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
            ramp.color_ramp.elements[0].position = 0.02
            ramp.color_ramp.elements[1].position = 0.07
        nt.links.new(v.outputs['Distance'], ramp.inputs['Fac'])
        return ramp.outputs['Color']
    if kind == 'patches':
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 1.4
        n.inputs['Detail'].default_value = 3.0
        n.inputs['Roughness'].default_value = 0.55
        nt.links.new(coord, n.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.54
        ramp.color_ramp.elements[1].position = 0.58
        nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
        return ramp.outputs['Color']
    return None


def hi_material(name, pattern='none'):
    """Emission-only material that outputs one attribute (switchable per pass)."""
    mat = bpy.data.materials.new(name)
    nt = _nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.name = 'attr'
    attr.attribute_name = 'mask'
    color = attr.outputs['Color']
    pat = _pattern_node(nt, pattern, nt.nodes.new('ShaderNodeTexCoord').outputs['Object'])
    if pat is not None:
        # mask.r = max(mask.r, pattern * mask.a); swapped out for other passes
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(attr.outputs['Color'], sep.inputs['Color'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        nt.links.new(pat, mul.inputs[0])
        nt.links.new(attr.outputs['Alpha'], mul.inputs[1])
        mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
        nt.links.new(sep.outputs['Red'], mx.inputs[0])
        nt.links.new(mul.outputs['Value'], mx.inputs[1])
        comb = nt.nodes.new('ShaderNodeCombineColor')
        nt.links.new(mx.outputs['Value'], comb.inputs['Red'])
        nt.links.new(sep.outputs['Green'], comb.inputs['Green'])
        nt.links.new(sep.outputs['Blue'], comb.inputs['Blue'])
        sw = nt.nodes.new('ShaderNodeMix'); sw.data_type = 'RGBA'; sw.name = 'patswitch'
        sw.inputs['Factor'].default_value = 1.0
        nt.links.new(attr.outputs['Color'], sw.inputs['A'])
        nt.links.new(comb.outputs['Color'], sw.inputs['B'])
        color = sw.outputs['Result']
    nt.links.new(color, em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def set_pass(mats, attribute, pattern_on=True):
    for m in mats:
        nt = m.node_tree
        nt.nodes['attr'].attribute_name = attribute
        sw = nt.nodes.get('patswitch')
        if sw:
            sw.inputs['Factor'].default_value = 1.0 if pattern_on else 0.0


def assign(obj, mat):
    """Give the whole object one material (every face on slot 0)."""
    polys = obj.data.polygons
    polys.foreach_set('material_index', np.zeros(len(polys), dtype=np.int32))
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def set_slots(obj, mats):
    """Replace the material in each slot without touching the faces' slot
    indices (clearing the slots would reset them all to 0)."""
    for i, m in enumerate(mats):
        if i < len(obj.data.materials):
            obj.data.materials[i] = m
        else:
            obj.data.materials.append(m)
    return obj


# ------------------------------------------------------------------ AO
def bake_vertex_ao(objs, samples=192, distance=0.35):
    """Bake ambient occlusion from the whole high-poly scene into each object's
    'ao' point attribute (so seams, the mouth and joints darken)."""
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.world = sc.world or bpy.data.worlds.new('World')
    sc.world.light_settings.distance = distance
    for o in objs:
        me = o.data
        a = me.color_attributes.get('ao') or me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = a
    C.select_only(objs)
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_selected_to_active=False)


# ------------------------------------------------------------------ UVs
def unwrap(obj, angle=60, margin=0.02):
    C.select_only([obj])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def weight_uvs(obj, factor):
    """Scale an object's UV islands so it gets `factor`x the texel area."""
    uv = obj.data.uv_layers.active.data
    a = np.empty(len(uv) * 2, dtype=np.float32)
    uv.foreach_get('uv', a)
    uv.foreach_set('uv', a * math.sqrt(factor))


def uv_edit(objs):
    """Edit mode on objs with every face and UV selected (sync selection, so UV
    operators see all islands even without a UV editor)."""
    C.select_only(objs, objs[0])
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action='SELECT')


def pack(obj, margin=0.006):
    uv_edit([obj])
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    uv = obj.data.uv_layers.active.data
    a = np.empty(len(uv) * 2, dtype=np.float32)
    uv.foreach_get('uv', a)
    C.log(f'  uv pack {obj.name}: range {a.min():.3f}..{a.max():.3f}')


# ------------------------------------------------------------------ images
def new_image(name, size, data=True):
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color' if data else 'Linear Rec.709'
    img.generated_color = (0.5, 0.5, 1, 1) if 'normal' in name else (0, 0, 0, 1)
    return img


def bake_target(low, img):
    """Give `low` a material whose active node is `img` (bake destination)."""
    mat = low.data.materials[0] if low.data.materials else None
    if mat is None or not mat.name.startswith('bake_'):
        mat = bpy.data.materials.new('bake_' + low.name)
        # swap the material in every slot: clearing the slots would reset the
        # faces' material indices, which say which game mesh each face is on
        if not low.data.materials:
            low.data.materials.append(mat)
        for i in range(len(low.data.materials)):
            low.data.materials[i] = mat
    nt = _nodes(mat)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    nt.nodes.new('ShaderNodeOutputMaterial')
    return mat


def bake_pass(low, highs, img, kind, extrusion=0.03, ray=0.08):
    bake_target(low, img)
    C.select_only(highs + [low], low)
    kw = dict(type=kind, use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=ray, margin=8, use_clear=True, target='IMAGE_TEXTURES')
    if kind == 'NORMAL':
        kw.update(normal_space='TANGENT')
    if kind == 'EMIT':
        bpy.context.scene.cycles.samples = 1
    else:
        bpy.context.scene.cycles.samples = 16
    bpy.ops.object.bake(**kw)
    return pixels(img)


def pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save_webp(arr, path, quality=90):
    """arr: HxWx4 float array already in the file's encoding (0..1)."""
    h, w = arr.shape[:2]
    name = os.path.basename(path)
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.file_format = 'WEBP'
    img.filepath_raw = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()
    if DEBUG_PNG:
        dbg = os.path.join(C.CACHE, 'previews', 'tex', os.path.splitext(name)[0] + '.png')
        os.makedirs(os.path.dirname(dbg), exist_ok=True)
        img.file_format = 'PNG'
        img.filepath_raw = dbg
        img.save()
    bpy.data.images.remove(img)
    C.log('  wrote', os.path.relpath(path, C.REPO), f'{os.path.getsize(path) // 1024} KB')


def dilate_alpha(arr, coverage, iters=16):
    """Bleed colour into texels the bake did not cover so mips don't pick up black."""
    out = arr.copy()
    cov = coverage.copy()
    for _ in range(iters):
        if cov.all():
            break
        acc = np.zeros_like(out); cnt = np.zeros(cov.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(out, dy, 0), dx, 1)
            sc = np.roll(np.roll(cov, dy, 0), dx, 1)
            acc += sh * sc[..., None]; cnt += sc
        grow = (~cov) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        cov = cov | grow
    return out


# ------------------------------------------------------------------ export
def export_glb(objs, path, compress=True):
    C.select_only(objs, objs[0])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=True,
        export_materials='EXPORT', export_image_format='NONE', export_vertex_color='NONE',
        export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False,
        export_animations=False, export_morph=False, export_yup=True, export_extras=True,
        export_cameras=False, export_lights=False, export_rest_position_armature=True,
    )
    if compress:
        kw.update(export_meshopt_compression_enable=True)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except (RuntimeError, TypeError) as e:
        if not compress:
            raise
        C.log('  meshopt export failed, writing uncompressed:', e)
        kw.pop('export_meshopt_compression_enable')
        bpy.ops.export_scene.gltf(**kw)
    C.log('  wrote', os.path.relpath(path, C.REPO), f'{os.path.getsize(path) // 1024} KB')


def plain_material(name):
    """Untextured placeholder: the runtime maps glTF material names to game materials."""
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)
