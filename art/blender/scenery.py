"""Course scenery: palms, jungle trees, ferns, boulders, glowing flowers,
obsidian spires, dead trees, the fossil ribcage and skull, floodlight towers.

Most of these are drawn as thousands of instances, so the game meshes stay
small (a fern is ~150 triangles) and the detail lives in the baked textures.
Each is modelled at the size and origin the game's instancing expects (see
public/js/three/scenery.js). Meshes that the game tints per instance (canopy,
fern, flower petals) are baked near-white so the tint shows through.
"""
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

from lib import common as C
from lib import static as S

HALF = 4.05
TAU = math.tau


def smooth(a, b, x):
    f = max(0.0, min(1.0, (x - a) / (b - a)))
    return f * f * (3 - 2 * f)


def flat_shade(o):
    o.data.shade_flat()
    return o


# ------------------------------------------------------------------ leaf blades
def leaf_blade(name, spine, side, width, fold, lo, green, tint=False):
    """A V-folded leaf blade along `spine` (list of game points), spanning
    +/- width(t) along the unit vector `side`. The game mesh is a plain strip
    (3 vertices across) and gets its pinnate look from the bake: the high-poly
    has scalloped leaflets, a raised midrib and diagonal veins, all coloured
    per vertex from the blade's own (t, s) coordinates."""
    segs = len(spine) - 1
    across = 2 if lo else 24
    verts, faces, cols, mats = [], [], [], []
    for i, P in enumerate(spine):
        t = i / segs
        w = width(t)
        for j in range(across + 1):
            s = j / across * 2 - 1  # -1 .. 1 across the blade
            lift = fold * w * (1 - abs(s))
            if not lo:
                # leaflets puff up between the diagonal veins; the midrib stands proud
                k = (t * 26 + abs(s) * 1.4) % 1
                lift += 0.012 * abs(s) * math.sin(k * math.pi) + 0.006 * math.exp(-(s / 0.04) ** 2)
            p = Vector(P) + side * (s * w) + Vector((0, lift, 0))
            verts.append(tuple(p))
            k = (t * 26 + abs(s) * 1.4) % 1
            vein = math.exp(-((k - 0.5) / 0.08) ** 2) * (abs(s) > 0.06)
            rib = math.exp(-(s / 0.05) ** 2)
            base = green if not tint else (0.85, 0.9, 0.78)
            c = tuple(base[m] * (1 - 0.35 * vein) * (1 + 0.25 * abs(s)) * (1 - 0.2 * rib) + 0.06 * rib for m in range(3))
            cols.append((*c, 1.0))
            mats.append((0.55, 0.0, 0.0, 1.0))
    n = across + 1
    for i in range(segs):
        for j in range(across):
            a = i * n + j
            faces.append([a, a + 1, a + n + 1, a + n])
    o = C.mesh_obj(name, verts, faces, recalc=False)
    if not lo:
        me = o.data
        for nm, arr in (('col', cols), ('mat', mats)):
            at = me.color_attributes.new(nm, 'FLOAT_COLOR', 'POINT')
            at.data.foreach_set('color', np.asarray(arr, dtype=np.float32).ravel())
    return o


# ------------------------------------------------------------------ palm
CROWN = Vector((2.4, 8.4, 0))


def palm_frond(a, lo):
    """Arching pinnate frond from the crown, heading out along angle a."""
    L = 4.2
    out = Vector((math.cos(a), 0, math.sin(a)))
    side = Vector((-math.sin(a), 0, math.cos(a)))
    n = 6 if lo else 60
    pts = []
    for i in range(n + 1):
        s = L * i / n
        pts.append(CROWN + out * (s * 0.9) + Vector((0, 0.55 * s - 0.14 * s * s, 0)))
    width = lambda t: 0.44 * math.sin(math.pi * min(1.0, t * 1.15 + 0.05)) * (1 - 0.35 * t) + 0.03
    return leaf_blade('frond', pts, side, width, 0.35, lo, (0.17, 0.43, 0.12))


def palm():
    curve = [Vector((0, 0, 0)), Vector((0.5, 3, 0)), Vector((1.4, 6, 0)), CROWN]
    trunk = C.taper_tube('trunk_hi', [tuple(p) for p in curve], 0.3, 0.22, 20, 96, cap=True)

    def ring_fn(p, n):
        y = p[1]
        band = (y * 5.5) % 1
        return 0.018 * smooth(0.0, 0.25, band) * (1 - smooth(0.6, 1.0, band)) + 0.004 * noise.noise(Vector(p) * 14)
    C.displace(trunk, ring_fn)

    def tcol(p, n):
        band = (p[1] * 5.5) % 1
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 8)
        c = (0.36 + 0.06 * t, 0.29 + 0.04 * t, 0.2) if band > 0.3 else (0.24, 0.19, 0.13)
        return (c, 0.9, 0, 0)
    S.paint_fn(trunk, tcol)
    nuts = [C.uv_sphere('coco', 1, 20, 12, pos=tuple(CROWN + Vector((math.cos(a) * 0.25, -0.2, math.sin(a) * 0.25))), scale=0.16) for a in (0.3, 2.4, 4.4)]
    nuts = C.join(nuts, 'nuts_hi')
    S.paint(nuts, '#5a3d1e', 0.6)
    trunk_lo = C.taper_tube('trunk_lo', [tuple(p) for p in curve], 0.3, 0.22, 7, 10, cap=True)
    nuts_lo = C.join([C.uv_sphere('coco', 1, 6, 4, pos=tuple(CROWN + Vector((math.cos(a) * 0.25, -0.2, math.sin(a) * 0.25))), scale=0.16) for a in (0.3, 2.4, 4.4)], 'nuts_lo')
    his, los = [], []
    for i in range(8):
        a = i / 8 * TAU + 0.2
        his.append(palm_frond(a, False))
        los.append(palm_frond(a, True))
    fr = C.join(his, 'fronds_hi')  # coloured by leaf_blade
    fr_lo = C.join(los, 'fronds_lo')
    return [S.Part(trunk, 'trunk', lo=trunk_lo, uvw=0.6), S.Part(nuts, 'trunk', lo=nuts_lo, uvw=0.2),
            S.Part(fr, 'fronds', lo=fr_lo, uvw=1.5)], dict(size=1024, extrusion=0.03, ray=0.08, ao_distance=1.5)


# ------------------------------------------------------------------ jungle tree
def jungle_tree():
    rnd = random.Random(11)
    prof = [(0.0001, -0.05), (1.05, 0.0), (0.75, 0.35), (0.55, 1.2), (0.45, 4.0), (0.38, 7.0), (0.3, 9.0), (0.0001, 9.3)]
    trunk = C.lathe('trunk_hi', prof, 64)
    roots = []
    for k in range(5):
        a = k / 5 * TAU + 0.4
        d = Vector((math.cos(a), 0, math.sin(a)))
        roots.append(C.taper_tube('root', [(0, 1.4, 0), tuple(d * 0.6 + Vector((0, 0.5, 0))), tuple(d * 1.4 + Vector((0, 0.02, 0)))], 0.28, 0.05, 12, 20, 0.35))
    trunk = C.join([trunk] + roots, 'trunk_hi')
    C.remesh(trunk, 0.04, smooth=4)

    def bark(p, n):
        a = math.atan2(p[2], p[0])
        return -0.03 * (1 - abs(noise.noise(Vector((a * 3.0, p[1] * 0.4, 0.0))))) ** 4 + 0.01 * noise.noise(Vector(p) * 4)
    C.displace(trunk, bark)

    def tcol(p, n):
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 2)
        moss = smooth(1.6, 0.2, p[1]) * smooth(-0.1, 0.4, noise.noise(Vector(p) * 1.5))
        c = (0.3 + 0.08 * t, 0.24 + 0.06 * t, 0.17 + 0.04 * t)
        m = (0.22, 0.34, 0.12)
        return (tuple(c[i] + (m[i] - c[i]) * moss for i in range(3)), 0.95, 0, 0)
    S.paint_fn(trunk, tcol)
    trunk_lo = C.copy_obj(trunk, 'trunk_lo')
    for a in list(trunk_lo.data.color_attributes):
        trunk_lo.data.color_attributes.remove(a)
    C.decimate(trunk_lo, 120)

    # a tall, lumpy crown: a core plus clusters stacked at different heights
    E = [dict(co=(0, 9.6, 0), size=(2.0, 2.0, 2.0))]
    for i in range(9):
        a = i / 9 * TAU + rnd.random()
        r = 1.5 + rnd.random() * 1.1
        E.append(dict(co=(math.cos(a) * r, 8.0 + (i % 3) * 1.3 + rnd.random() * 0.8, math.sin(a) * r),
                      size=(1.4 + rnd.random() * 0.6, 1.2 + rnd.random() * 0.4, 1.4 + rnd.random() * 0.6)))
    E.append(dict(co=(0.3, 11.6, -0.2), size=(1.4, 1.1, 1.4)))
    canopy = C.metaball('canopy_hi', E, resolution=0.1)

    def clumps(p, n):
        v = noise.voronoi(Vector(p) * 1.6)[0][0]
        return 0.55 * smooth(0.55, 0.0, v) + 0.08 * noise.noise(Vector(p) * 6)
    C.displace(canopy, clumps)
    C.displace(canopy, lambda p, n: -0.05 * (1 - abs(noise.noise(Vector(p) * 9))) ** 4)

    def ccol(p, n):
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 1.2)
        g = 0.72 + 0.2 * t
        return ((g, g * 1.04, g * 0.9), 0.8, 0, 0)
    S.paint_fn(canopy, ccol)
    canopy_lo = C.copy_obj(canopy, 'canopy_lo')
    for a in list(canopy_lo.data.color_attributes):
        canopy_lo.data.color_attributes.remove(a)
    C.decimate(canopy_lo, 260)
    return [S.Part(trunk, 'trunk', lo=trunk_lo, uvw=0.7), S.Part(canopy, 'canopy', lo=canopy_lo)], \
        dict(size=1024, extrusion=0.25, ray=0.6, ao_distance=3.0)


# ------------------------------------------------------------------ fern
def fern():
    """Seven arching pinnate fronds (near-white: the game tints each fern)."""
    his, los = [], []
    width = lambda t: 0.2 * math.sin(math.pi * min(1.0, t * 1.1 + 0.08)) * (1 - 0.3 * t) + 0.01
    for i in range(7):
        a = i / 7 * TAU + 0.3
        tilt = -0.75 - (i % 3) * 0.18
        for lo in (False, True):
            n = 4 if lo else 40
            spine = [(0, -0.45 * (k / n) ** 2, 1.5 * k / n) for k in range(n + 1)]
            f = leaf_blade(f'fern{i}{lo}', spine, Vector((1, 0, 0)), width, 0.3, lo, None, tint=True)
            C.transform(f, rot=(tilt, 0, 0))
            C.transform(f, rot=(0, a, 0))
            (los if lo else his).append(f)
    hi = C.join(his, 'fern_hi')
    return [S.Part(hi, 'fern', lo=C.join(los, 'fern_lo'))], dict(size=512, extrusion=0.03, ray=0.06, ao_distance=0.5)


# ------------------------------------------------------------------ boulder
def boulder():
    rock = C.metaball('rock_hi', [dict(co=(0, 0.2, 0), size=(1.0, 0.7, 0.9)),
                                  dict(co=(0.45, 0.1, 0.3), size=(0.6, 0.5, 0.55)),
                                  dict(co=(-0.4, 0.05, -0.3), size=(0.55, 0.45, 0.6))], resolution=0.03)

    def facets(p, n):
        d = noise.voronoi(Vector(p) * 2.2)[0]
        return -0.08 * smooth(0.0, 0.35, d[1] - d[0]) + 0.04 * noise.noise(Vector(p) * 5) + 0.012 * noise.noise(Vector(p) * 18)
    C.displace(rock, facets)
    bm = bmesh.new(); bm.from_mesh(rock.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.25], context='VERTS')
    bm.to_mesh(rock.data); bm.free()

    def col(p, n):
        moss = smooth(0.35, 0.8, n[1]) * smooth(-0.3, 0.2, noise.noise(Vector(p) * 1.7))
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 4)
        c = (0.42 + 0.08 * t, 0.43 + 0.08 * t, 0.38 + 0.06 * t)
        m = (0.24, 0.38, 0.12)
        return (tuple(c[i] + (m[i] - c[i]) * moss for i in range(3)), 0.9 - 0.1 * moss, 0, 0)
    S.paint_fn(rock, col)
    return [S.Part(rock, 'boulder', tris=180)], dict(size=512, extrusion=0.08, ray=0.2, ao_distance=0.8)


# ------------------------------------------------------------------ flower
def flower():
    """Giant glowing jungle flower (bloom at y=1.2 like the game's), on a stem."""
    stem = C.taper_tube('stem_hi', [(0, 0, 0), (0.05, 0.6, 0.02), (0, 1.15, 0)], 0.045, 0.03, 12, 24)
    leaves = []
    for s in (-1, 1):
        lf = C.taper_tube('leaf', [(0, 0.35, 0), (s * 0.25, 0.5, 0.05), (s * 0.55, 0.45, 0.1)], 0.1, 0.005, 14, 20, 0.12)
        leaves.append(lf)
    stem = C.join([stem] + leaves, 'stem_hi')
    S.paint(stem, '#2f6b28', 0.6)
    petals = []
    for i in range(5):
        a = i / 5 * TAU
        p = C.metaball('petal', [dict(co=(0, 1.2, 0.3), size=(0.3, 0.07, 0.55)), dict(co=(0, 1.24, 0.72), size=(0.24, 0.06, 0.2))], resolution=0.015)
        C.displace(p, lambda q, n: -0.006 * math.exp(-(q[0] / 0.01) ** 2) - 0.004 * (1 - abs(math.sin(math.atan2(q[0], q[2] - 0.0) * 12))) ** 8)
        C.transform(p, rot=(0, a, 0))
        petals.append(p)
    centre = C.uv_sphere('centre', 1, 32, 16, pos=(0, 1.28, 0), scale=(0.2, 0.12, 0.2))
    C.displace(centre, lambda q, n: 0.012 * max(0.0, math.sin(q[0] * 90) * math.sin(q[2] * 90)))
    bloom = C.join(petals + [centre], 'bloom_hi')

    def col(p, n):
        r = math.hypot(p[0], p[2])
        if r < 0.22 and p[1] > 1.2:
            return ((1.0, 0.95, 0.6), 0.5, 0, 1.0)
        tip = smooth(0.4, 0.95, r)
        g = 0.82 + 0.18 * tip
        return ((g, g, g), 0.45, 0, 0.35 * tip)
    S.paint_fn(bloom, col)
    return [S.Part(stem, 'stem', tris=90, uvw=0.5), S.Part(bloom, 'bloom', tris=190)], dict(size=512, emissive=True, extrusion=0.02, ray=0.05, ao_distance=0.4)


# ------------------------------------------------------------------ volcano
def spire():
    """Obsidian shard cluster in a unit box centred on the origin (y -0.5..0.5,
    base radius ~1): the game stretches each instance."""
    rnd = random.Random(5)
    objs = []
    for k in range(4):
        h = 1.0 if k == 0 else 0.45 + rnd.random() * 0.35
        r = 0.55 if k == 0 else 0.25 + rnd.random() * 0.15
        a = rnd.random() * TAU
        off = Vector((0, 0, 0)) if k == 0 else Vector((math.cos(a) * 0.55, 0, math.sin(a) * 0.55))
        prof = [(0.0001, -0.5), (r, -0.5), (r * 0.92, -0.5 + h * 0.65), (0.0001, -0.5 + h)]
        o = C.lathe('shard', prof, 6, phase=rnd.random())
        C.transform(o, pos=tuple(off), rot=((rnd.random() - 0.5) * 0.3 * (k > 0), 0, (rnd.random() - 0.5) * 0.3 * (k > 0)))
        objs.append(o)
    hi = C.join(objs, 'spire_hi')
    lo = C.copy_obj(hi, 'spire_lo')
    flat_shade(lo)
    C.subdivide(hi, 2)
    C.displace(hi, lambda p, n: -0.015 * (1 - abs(noise.noise(Vector(p) * 7))) ** 6 + 0.004 * noise.noise(Vector(p) * 20))
    flat_shade(hi)

    def col(p, n):
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 5)
        return ((0.03 + 0.02 * t, 0.025 + 0.01 * t, 0.04 + 0.03 * t), 0.12, 0.3, 0)
    S.paint_fn(hi, col)
    return [S.Part(hi, 'spire', lo=lo)], dict(size=512, extrusion=0.02, ray=0.06, ao_distance=0.4)


def dead_tree():
    rnd = random.Random(9)
    objs = [C.taper_tube('trunk', [(0, -0.1, 0), (0.08, 1.8, 0.05), (-0.05, 3.6, -0.04), (0.02, 5.0, 0.0)], 0.3, 0.07, 16, 40)]
    for i in range(5):
        a = i / 5 * TAU + rnd.random()
        y0 = 2.2 + i * 0.55
        d = Vector((math.cos(a), 0.8, math.sin(a))).normalized()
        pts = [(0, y0, 0), tuple(Vector((0, y0, 0)) + d * 0.9 + Vector((0, 0.1, 0))), tuple(Vector((0, y0, 0)) + d * 1.9 + Vector((rnd.random() * 0.3, -0.1, 0)))]
        objs.append(C.taper_tube('branch', pts, 0.1, 0.015, 10, 20))
    hi = C.join(objs, 'dead_hi')
    C.remesh(hi, 0.02, smooth=3)
    C.displace(hi, lambda p, n: -0.012 * (1 - abs(noise.noise(Vector((p[0] * 8, p[1] * 1.5, p[2] * 8))))) ** 5)

    def col(p, n):
        d = noise.voronoi(Vector(p) * Vector((6, 1.5, 6)))[0]
        crack = smooth(0.06, 0.0, d[1] - d[0])
        ember = crack * smooth(1.5, 0.0, p[1])
        return ((0.1 + 0.9 * ember, 0.07 + 0.3 * ember, 0.06), 0.9, 0, ember)
    S.paint_fn(hi, col)
    return [S.Part(hi, 'dead_tree', tris=180)], dict(size=512, emissive=True, extrusion=0.03, ray=0.08, ao_distance=0.6)


def bone_paint(o, glow_sockets=False):
    def col(p, n):
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 1.5)
        return ((0.8 - 0.1 * t, 0.74 - 0.1 * t, 0.6 - 0.12 * t), 0.65, 0, 0)
    return S.paint_fn(o, col)


def bone_detail(p, n):
    pores = -0.02 * smooth(0.08, 0.02, noise.voronoi(Vector(p) * 5)[0][0])
    crack = -0.03 * smooth(0.02, 0.0, abs(noise.noise(Vector(p) * 0.9)))
    return pores + crack + 0.02 * noise.noise(Vector(p) * 1.8)


def rib():
    """One fossil rib: the game's arc (radius HALF+3.5, across the track) at
    thickness 0.45; each instance is scaled in the game."""
    R = HALF + 3.5
    hi = C.torus('rib_hi', R, 0.45, 256, 24, arc=math.pi)
    C.displace(hi, lambda p, n: 0.08 * math.sin(math.atan2(p[1], p[0]) * 9) * 0.3 + bone_detail(p, n))
    bone_paint(hi)
    lo = C.torus('rib', R, 0.45, 40, 8, arc=math.pi)
    return [S.Part(hi, 'rib', lo=lo)], dict(size=512, extrusion=0.06, ray=0.15, ao_distance=1.0)


def vertebra():
    """Unit vertebra (game scales it 1 x 0.7 x 1.3 at radius 0.8)."""
    E = [dict(co=(0, 0, 0), size=(0.62, 0.55, 0.62)),
         dict(type='CAPSULE', co=(0, 0.6, 0), r=0.18, half=0.35, rot=(0, 0, math.pi / 2)),
         dict(type='CAPSULE', co=(0, 0.2, 0), r=0.14, half=0.6)]
    hi = C.metaball('vert_hi', E, resolution=0.02)
    C.displace(hi, lambda p, n: bone_detail(Vector(p) * 3, n) * 0.4)
    bone_paint(hi)
    return [S.Part(hi, 'vertebra', tris=300)], dict(size=512, extrusion=0.04, ray=0.1, ao_distance=0.5)


def skull():
    """The fossil T-Rex skull beside the ribcage: sockets glow with lava light."""
    E = [dict(co=(0, 0.3, -1.2), size=(3.0, 2.4, 2.6)),
         dict(co=(0, -0.2, 1.6), size=(2.2, 1.6, 3.4)),
         dict(co=(0, -0.5, 3.9), size=(1.5, 1.1, 1.3))]
    for s in (-1, 1):
        E += [dict(co=(s * 2.0, 0.8, 0.8), size=(1.2, 1.1, 1.1), neg=True, stiffness=4),  # deep eye sockets
              dict(co=(s * 2.1, -0.4, -1.4), size=(0.8, 1.1, 1.3), neg=True),
              dict(co=(s * 0.55, 0.2, 4.4), size=(0.35, 0.3, 0.5), neg=True)]
    head = C.metaball('skull_hi', E, resolution=0.06)
    jaw = C.metaball('jaw_hi', [dict(co=(0, -2.1, 1.2), size=(2.2, 0.6, 3.6)), dict(co=(0, -2.0, -1.4), size=(2.0, 0.8, 1.2))], resolution=0.06)
    C.transform(jaw, rot=(0.3, 0, 0))
    teeth = []
    for s in (-1, 1):
        for i in range(9):
            z = -0.4 + i * 0.55
            t = C.lathe('tooth', [(0.0001, 0), (0.18, 0), (0.14, 0.3), (0.0001, 0.62)], 10)
            C.transform(t, pos=(s * (1.5 - i * 0.07), -1.25, z), rot=(math.pi, 0, 0))
            teeth.append(t)
    hi = C.join([head, jaw] + teeth, 'skull_all_hi')
    C.displace(hi, bone_detail)

    def col(p, n):
        # socket interiors (facing inward and deep in the eye holes) glow
        sock = min((Vector(p) - Vector((s * 2.0, 0.8, 0.8))).length for s in (-1, 1))
        glow = smooth(1.35, 0.9, sock)
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 0.8)
        base = (0.8 - 0.1 * t, 0.74 - 0.1 * t, 0.6 - 0.12 * t)
        return (tuple(base[i] + ((1, 0.35, 0.05)[i] - base[i]) * glow for i in range(3)), 0.65, 0, glow)
    S.paint_fn(hi, col)
    return [S.Part(hi, 'skull', tris=1600)], dict(size=1024, emissive=True, extrusion=0.1, ray=0.25, ao_distance=1.5)


def floodlight():
    """Stadium floodlight: lattice mast and a lamp bank facing +Z (the game
    points each tower at the pitch)."""
    objs = []
    H = 37.0
    legs = [(-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9)]
    taper = lambda y: 1 - 0.55 * y / H
    for x, z in legs:
        objs.append(C.taper_tube('leg', [(x, 0, z), (x * taper(H / 2), H / 2, z * taper(H / 2)), (x * taper(H), H, z * taper(H))], 0.09, 0.06, 8, 12, cap=False))
    for k in range(18):
        y0, y1 = k * H / 18, (k + 1) * H / 18
        for i in range(4):
            (xa, za), (xb, zb) = legs[i], legs[(i + 1) % 4]
            objs.append(C.taper_tube('brace', [(xa * taper(y0), y0, za * taper(y0)), (xb * taper(y1), y1, zb * taper(y1))], 0.035, 0.035, 6, 2, cap=False))
    frame = C.rounded_box('frame', 7.2, 4.8, 0.5, 0.08, pos=(0, 39, -0.1))
    objs.append(frame)
    lamps = []
    for i in range(4):
        for j in range(3):
            x, y = -2.4 + i * 1.6, 37.6 + j * 1.4
            housing = C.lathe('lamp', [(0.0001, -0.1), (0.66, -0.1), (0.7, 0.18), (0.62, 0.28)], 24)
            C.transform(housing, rot=(math.pi / 2, 0, 0), pos=(x, y, 0.2))
            glass = C.uv_sphere('glass', 1, 24, 6, phi=(0, 0.5), scale=(0.62, 0.08, 0.62))
            C.transform(glass, rot=(math.pi / 2, 0, 0), pos=(x, y, 0.47))
            S.paint(housing, '#3a3f47', 0.4, 0.8)
            S.paint(glass, '#fffbe6', 0.1, 0, 1.0)
            lamps += [housing, glass]
    mast = C.join(objs, 'mast_hi')
    S.paint(mast, '#8d96a3', 0.4, 0.7)
    bank = C.join(lamps, 'lamps_hi')
    return [S.Part(mast, 'tower', tris=2500, uvw=0.4), S.Part(bank, 'tower', tris=1500)], dict(size=1024, emissive=True, extrusion=0.03, ray=0.08, ao_distance=2.0)


ASSETS = {
    'palm': palm, 'jungle_tree': jungle_tree, 'fern': fern, 'boulder': boulder, 'flower': flower,
    'spire': spire, 'dead_tree': dead_tree, 'rib': rib, 'vertebra': vertebra, 'skull': skull,
    'floodlight': floodlight,
}
PREVIEW_TINT = {'jungle_tree': '#4c8a3a', 'fern': '#4f9a3a', 'flower': '#ff7ab8'}


def build(name, opts):
    C.reset()
    C.log(f'scenery {name}')
    parts, kw = ASSETS[name]()
    if opts.get('preview'):
        from lib.preview import render_static
        kw['preview'] = lambda objs, out_dir, files: render_static(name, objs, out_dir, files, PREVIEW_TINT.get(name))
    return S.build(name, 'scenery', parts, **kw)
