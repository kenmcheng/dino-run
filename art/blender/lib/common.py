"""Shared helpers for the Dino Run asset build (runs inside Blender's Python).

Coordinates: the game (three.js / glTF) is Y-up with runners facing +Z.
Blender is Z-up; the glTF exporter maps Blender (x, y, z) -> glTF (x, z, -y).
So a game-space point (x, y, z) lives at Blender (x, -z, y). Use `G()` to
convert, and write every builder in game space.
"""
import math
import os
import sys
import time
import traceback

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # art/blender
REPO = os.path.dirname(os.path.dirname(ART))
OUT = os.path.join(REPO, 'public', 'assets')
CACHE = os.path.join(REPO, 'art', '.cache')

_log = None


def log(*a):
    msg = ' '.join(str(x) for x in a)
    line = f'[{time.strftime("%H:%M:%S")}] {msg}\n'
    if _log:
        _log.write(line)
        _log.flush()
    sys.__stdout__.write(line)


def args():
    """Arguments after `--` on the Blender command line, as a dict."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'only': [], 'preview': False, 'log': os.path.join(CACHE, 'build.log'), 'size': 1}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == '--only':
            out['only'] = argv[i + 1].split(','); i += 1
        elif k == '--preview':
            out['preview'] = True
        elif k == '--log':
            out['log'] = argv[i + 1]; i += 1
        elif k == '--size':
            out['size'] = float(argv[i + 1]); i += 1
        i += 1
    return out


def run(main):
    """Run `main(opts)` with logging to a file; exit non-zero on failure."""
    global _log
    opts = args()
    os.makedirs(os.path.dirname(opts['log']), exist_ok=True)
    _log = open(opts['log'], 'w', encoding='utf-8')
    code = 0
    try:
        main(opts)
    except Exception:
        log(traceback.format_exc())
        code = 1
    log('exit', code)
    _log.close()
    sys.exit(code)


# ------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.metaballs, bpy.data.armatures):
        for x in list(coll):
            coll.remove(x)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
        try:
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = 'GPU'
                break
        except TypeError:
            continue
    sc.cycles.samples = 64
    sc.render.bake.margin = 8
    return sc


def G(x, y, z):
    """game-space (Y-up, +Z forward) -> Blender-space vector"""
    return Vector((x, -z, y))


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select_only(objs, active=None):
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:  # a just-removed object can leave a stale slot
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def mesh_obj(name, verts, faces, uvs=None, smooth=True, recalc=True):
    """Object from game-space verts (list/array of xyz) and faces (index lists).
    recalc: make normals point outward (closed or dome-like meshes only)."""
    me = bpy.data.meshes.new(name)
    vb = [tuple(G(*v)) for v in verts]
    me.from_pydata(vb, [], [list(f) for f in faces])
    if uvs is not None:
        uv = me.uv_layers.new(name='UVMap')
        loops = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get('vertex_index', loops)
        arr = np.asarray(uvs, dtype=np.float32)[loops]
        uv.data.foreach_set('uv', arr.ravel())
    me.update()
    if recalc:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
    if smooth:
        me.shade_smooth()
    return link(bpy.data.objects.new(name, me))


def verts_np(obj):
    n = len(obj.data.vertices)
    a = np.empty(n * 3, dtype=np.float64)
    obj.data.vertices.foreach_get('co', a)
    return a.reshape(n, 3)


def set_verts_np(obj, arr):
    obj.data.vertices.foreach_set('co', np.asarray(arr, dtype=np.float32).ravel())
    obj.data.update()


def to_game(a):
    """Blender-space Nx3 -> game-space Nx3"""
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def to_blender(a):
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], axis=1)


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def bake_transform(obj):
    """Apply the object's transform to its mesh data."""
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    return obj


def mod(obj, kind, **kw):
    m = obj.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def subdivide(obj, levels=1):
    mod(obj, 'SUBSURF', levels=levels, render_levels=levels)
    return apply_modifiers(obj)


def remesh(obj, voxel, smooth=0, adapt=0.0):
    mod(obj, 'REMESH', mode='VOXEL', voxel_size=voxel, adaptivity=adapt, use_smooth_shade=True)
    apply_modifiers(obj)
    if smooth:
        mod(obj, 'SMOOTH', factor=0.5, iterations=smooth)
        apply_modifiers(obj)
    return obj


def decimate(obj, target_tris):
    """Collapse-decimate to about target_tris. One pass often stops well short
    (quads, thin parts), so repeat until within 10%."""
    for _ in range(6):
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris <= target_tris * 1.1:
            break
        mod(obj, 'DECIMATE', decimate_type='COLLAPSE', ratio=max(0.01, target_tris / tris), use_collapse_triangulate=True)
        apply_modifiers(obj)
    return obj


def triangulate(obj):
    mod(obj, 'TRIANGULATE', quad_method='BEAUTY', ngon_method='BEAUTY')
    return apply_modifiers(obj)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def copy_obj(obj, name):
    o = obj.copy()
    o.data = obj.data.copy()
    o.name = name
    o.modifiers.clear()
    return link(o)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    select_only(objs, objs[0])
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def delete(objs):
    for o in objs:
        if o is None:
            continue
        me = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)


def smooth_shade(obj):
    obj.data.shade_smooth()
    return obj


# ------------------------------------------------------------------ shapes
_MB_K = {}


def _mb_scale(threshold, stiffness):
    """Surface radius of a lone metaball of radius 1 (so sizes can be given in metres)."""
    key = (threshold, stiffness)
    if key not in _MB_K:
        mb = bpy.data.metaballs.new('mbcal')
        mb.resolution = mb.render_resolution = 0.01
        mb.threshold = threshold
        el = mb.elements.new(type='BALL')
        el.radius = 1.0
        el.stiffness = stiffness
        ob = link(bpy.data.objects.new('mbcal', mb))
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co)
        _MB_K[key] = float(np.abs(co).max())
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.metaballs.remove(mb)
        bpy.data.meshes.remove(me)
        log(f'  metaball scale (t={threshold}, s={stiffness}) = {_MB_K[key]:.3f}')
    return _MB_K[key]


def metaball(name, elements, resolution=0.02, threshold=0.6):
    """Implicit-surface blob -> mesh. elements: dicts with type, co (game), r (surface
    radius in metres for BALL/CAPSULE), size (game xyz semi-axes in metres for
    ELLIPSOID; capsule half-length in size[0]), rot (game euler), neg, stiffness."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = threshold
    for e in elements:
        kind = e.get('type', 'ELLIPSOID')
        stiff = e.get('stiffness', 2.0)
        k = _mb_scale(threshold, stiff)
        el = mb.elements.new(type=kind)
        el.co = G(*e['co'])
        el.stiffness = stiff
        el.use_negative = e.get('neg', False)
        if kind == 'ELLIPSOID':
            sx, sy, sz = e['size']
            el.radius = 1.0 / k
            # game (x, y, z) semi-axes -> Blender (x, z, y)
            el.size_x, el.size_y, el.size_z = sx, sz, sy
        else:
            el.radius = e.get('r', 0.1) / k
            if kind == 'CAPSULE':
                el.size_x = e.get('half', 0.1)
        rx, ry, rz = e.get('rot', (0, 0, 0))
        el.rotation = _game_euler_quat(rx, ry, rz)
    ob = link(bpy.data.objects.new(name, mb))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.metaballs.remove(mb)
    o = link(bpy.data.objects.new(name, me))
    me.shade_smooth()
    return o


def _game_euler_quat(rx, ry, rz):
    """A game-space XYZ euler (three.js convention) as a Blender-space quaternion."""
    # three.js 'XYZ' euler: R = Rx * Ry * Rz. Map each game axis to Blender:
    # game X -> Blender X, game Y -> Blender Z, game Z -> Blender -Y.
    q = (Matrix.Rotation(rx, 3, Vector((1, 0, 0))) @ Matrix.Rotation(ry, 3, Vector((0, 0, 1)))
         @ Matrix.Rotation(rz, 3, Vector((0, -1, 0))))
    return q.to_quaternion()


def game_rot_matrix(rx, ry, rz):
    return _game_euler_quat(rx, ry, rz).to_matrix().to_4x4()


def transform(obj, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Apply a game-space TRS to the object's mesh (scale, then rotate, then move)."""
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    S = Matrix.Diagonal((scale[0], scale[2], scale[1], 1.0))
    obj.data.transform(Matrix.Translation(G(*pos)) @ game_rot_matrix(*rot) @ S)
    obj.data.update()
    return obj


def taper_tube(name, points, r0, r1, radial=16, segs=24, flat=1.0, cap=True):
    """Tube along a Catmull-Rom curve through game-space points, tapering r0 -> r1,
    closed with a pointed tip (horns, claws, teeth, crests)."""
    P = [Vector(p) for p in points]
    if len(P) == 2:
        P = [P[0], P[0].lerp(P[1], 0.5), P[1]]

    def cr(t):
        n = len(P) - 1
        f = min(t * n, n - 1e-6)
        i = int(f)
        u = f - i
        p0 = P[max(i - 1, 0)]; p1 = P[i]; p2 = P[i + 1]; p3 = P[min(i + 2, n)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)

    pts = [cr(i / segs) for i in range(segs + 1)]
    tans = [(pts[min(i + 1, segs)] - pts[max(i - 1, 0)]).normalized() for i in range(segs + 1)]
    # parallel-transport frames
    up = Vector((0, 1, 0)) if abs(tans[0].y) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(up).normalized()
    verts, uvs, faces = [], [], []
    for i in range(segs + 1):
        if i > 0:
            axis = tans[i - 1].cross(tans[i])
            if axis.length > 1e-6:
                ang = tans[i - 1].angle(tans[i])
                nrm = Matrix.Rotation(ang, 3, axis.normalized()) @ nrm
        bin_ = tans[i].cross(nrm).normalized()
        t = i / segs
        r = r0 + (r1 - r0) * t
        for j in range(radial):
            a = j / radial * math.tau
            d = nrm * (math.cos(a) * flat) + bin_ * math.sin(a)
            verts.append(pts[i] + d * r)
            uvs.append((t, j / radial))
    for i in range(segs):
        for j in range(radial):
            a = i * radial + j
            b = i * radial + (j + 1) % radial
            faces.append([a, b, b + radial, a + radial])
    if cap:
        tip = len(verts)
        verts.append(pts[-1] + tans[-1] * r1 * 0.6)
        uvs.append((1, 0.5))
        for j in range(radial):
            faces.append([segs * radial + j, segs * radial + (j + 1) % radial, tip])
        base = len(verts)
        verts.append(pts[0] - tans[0] * r0 * 0.3)
        uvs.append((0, 0.5))
        for j in range(radial):
            faces.append([(j + 1) % radial, j, base])
    return mesh_obj(name, [tuple(v) for v in verts], faces, uvs)


def lathe(name, profile, segments=32, phase=0.0):
    """Revolve a game-space (radius, y) profile around the Y axis."""
    verts, faces = [], []
    n = len(profile)
    for j in range(segments):
        a = j / segments * math.tau + phase
        for (r, y) in profile:
            verts.append((math.sin(a) * r, y, math.cos(a) * r))
    for j in range(segments):
        j2 = (j + 1) % segments
        for i in range(n - 1):
            faces.append([j * n + i, j2 * n + i, j2 * n + i + 1, j * n + i + 1])
    o = mesh_obj(name, verts, faces)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free()
    o.data.shade_smooth()
    return o


def uv_sphere(name, r=1.0, seg=32, rings=16, pos=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), phi=(0, math.pi)):
    verts, faces = [], []
    for i in range(rings + 1):
        th = phi[0] + (phi[1] - phi[0]) * i / rings
        for j in range(seg):
            a = j / seg * math.tau
            verts.append((math.sin(th) * math.cos(a) * r, math.cos(th) * r, math.sin(th) * math.sin(a) * r))
    for i in range(rings):
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append([i * seg + j, i * seg + j2, (i + 1) * seg + j2, (i + 1) * seg + j])
    o = mesh_obj(name, verts, faces)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data); bm.free()
    o.data.shade_smooth()
    return transform(o, pos, rot, scale)


def rounded_box(name, w, h, d, r, pos=(0, 0, 0), rot=(0, 0, 0), bevel_segs=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w; v.co.y *= d; v.co.z *= h
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4), segments=bevel_segs, affect='EDGES', profile=0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.shade_smooth()
    o = link(bpy.data.objects.new(name, me))
    return transform(o, pos, rot)


def torus(name, R, r, seg=48, rseg=12, arc=math.tau, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Torus in the game XY plane (like THREE.TorusGeometry), centred on the origin."""
    verts, faces = [], []
    closed = arc >= math.tau - 1e-6
    n = seg if closed else seg + 1
    for i in range(n):
        u = i / seg * arc
        for j in range(rseg):
            v = j / rseg * math.tau
            verts.append(((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v)))
    for i in range(seg):
        i2 = (i + 1) % n
        for j in range(rseg):
            j2 = (j + 1) % rseg
            faces.append([i * rseg + j, i2 * rseg + j, i2 * rseg + j2, i * rseg + j2])
    o = mesh_obj(name, verts, faces)
    return transform(o, pos, rot, scale)


def fbm(p, octaves=4, lac=2.0, gain=0.5):
    return noise.fractal(Vector(p), 1.0 - gain, lac, octaves, noise_basis='PERLIN_NEW')


def displace(obj, fn):
    """Move each vertex along its normal by fn(game_pos, game_normal) (game units)."""
    me = obj.data
    me.update()
    n = len(me.vertices)
    co = np.empty(n * 3); me.vertices.foreach_get('co', co); co = co.reshape(n, 3)
    nr = np.empty(n * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(n, 3)
    gp = to_game(co); gn = to_game(nr)
    d = np.array([fn(gp[i], gn[i]) for i in range(n)])
    co += nr * d[:, None]
    me.vertices.foreach_set('co', co.ravel().astype(np.float32))
    me.update()
    return obj


# ------------------------------------------------------------------ attributes
def set_attr(obj, name, value):
    """Constant RGBA point color attribute (linear floats)."""
    me = obj.data
    a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    arr = np.tile(np.asarray(value, dtype=np.float32), len(me.vertices))
    a.data.foreach_set('color', arr)
    return obj


def set_attr_fn(obj, name, fn):
    """Per-vertex RGBA attribute from fn(game_pos) -> (r, g, b, a)."""
    me = obj.data
    a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    gp = to_game(verts_np(obj))
    arr = np.array([fn(p) for p in gp], dtype=np.float32)
    a.data.foreach_set('color', arr.ravel())
    return obj


def weight_all(obj, group):
    vg = obj.vertex_groups.get(group) or obj.vertex_groups.new(name=group)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    return obj


def hex_lin(h, a=1.0):
    """'#rrggbb' -> linear RGBA"""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)
