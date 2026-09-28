"""Items and course props: mystery egg + nest, egg bomb, fern peel, tar pit,
meteor, fossil-bone hurdle, jungle log hurdle and the inflatable start arch.

Each is built at the exact size and origin the game places it with (see
public/js/three/props.js), so the Blender model is a drop-in replacement.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from lib import common as C
from lib import static as S

HALF = 4.05              # track.js: half the running surface
HURDLE = HALF * 2 + 0.6  # hurdle length across the track
TAU = math.tau


def smooth(a, b, x):
    f = max(0.0, min(1.0, (x - a) / (b - a)))
    return f * f * (3 - 2 * f)


def egg_profile(w, h, n=64):
    """props.js eggGeometry: r = sin(a) * w * (1 - 0.18 cos a), y = -cos(a) * h."""
    pts = []
    for i in range(n + 1):
        a = i / n * math.pi
        pts.append((max(0.0001, math.sin(a) * w * (1 - 0.18 * math.cos(a))), -math.cos(a) * h))
    return pts


# ------------------------------------------------------------------ mystery egg
def egg():
    """Mystery egg: speckled shell with a painted zig-zag band. Near-white, so the
    game's per-egg hue (and iridescence) tints it."""
    hi = C.lathe('egg_hi', egg_profile(0.34, 0.46, 96), 128)

    def fn(p, n):
        pore = 0.0006 * noise.noise(Vector(p) * 90)
        v = noise.voronoi(Vector(p) * 14)[0][0]
        speck = 0.0012 * smooth(0.18, 0.1, v)
        return pore + speck
    C.displace(hi, fn)

    def col(p, n):
        a = math.atan2(p[0], p[2])
        zig = 0.04 * (2 * abs((a * 8 / TAU) % 1 - 0.5) - 0.5)
        band = abs(p[1] - zig) < 0.05
        edge = abs(abs(p[1] - zig) - 0.05) < 0.008
        v = noise.voronoi(Vector(p) * 14)[0][0]
        if edge:
            return ('#c8c8cc', 0.25, 0, 0)
        if band:
            return ('#ffffff', 0.2, 0, 0)
        if v < 0.12:
            return ('#d4d4d8', 0.3, 0, 0)
        return ('#f1f1f3', 0.22, 0, 0)
    S.paint_fn(hi, col)
    lo = C.lathe('egg', egg_profile(0.34, 0.46, 16), 28)
    return [S.Part(hi, 'egg', lo=lo)], dict(size=512)


def nest():
    """Woven twig nest (the ring the egg floats over), lying flat at y=0."""
    # a packed straw core (so every texel of the game mesh finds a surface)
    # under a layer of woven twigs
    core = C.torus('core', 0.3, 0.078, 96, 24, rot=(-math.pi / 2, 0, 0))
    C.displace(core, lambda p, n: 0.006 * noise.noise(Vector(p) * 25) - 0.004 * (1 - abs(noise.noise(Vector(p) * Vector((40, 8, 40))))) ** 4)
    S.paint_fn(core, lambda p, n: ((0.42 + 0.1 * noise.noise(Vector(p) * 20), 0.3 + 0.06 * noise.noise(Vector(p) * 20), 0.16), 0.95, 0, 0))
    objs = [core]
    rnd = __import__('random').Random(7)
    for i in range(260):
        a0 = rnd.random() * TAU
        span = 0.9 + rnd.random() * 1.6
        rr = 0.3 + (rnd.random() - 0.5) * 0.1
        y0 = (rnd.random() - 0.5) * 0.1
        pts = []
        for k in range(6):
            a = a0 + span * k / 5
            wob = (rnd.random() - 0.5) * 0.05
            pts.append((math.cos(a) * (rr + wob), y0 + math.sin(k * 1.3 + i) * 0.03, math.sin(a) * (rr + wob)))
        t = C.taper_tube('twig', pts, 0.012 + rnd.random() * 0.008, 0.006, 6, 24, cap=True)
        shade = rnd.random()
        S.paint(t, '#8a6a42' if shade < 0.4 else '#a8844f' if shade < 0.8 else '#d8c08a', 0.9)
        objs.append(t)
    for i in range(24):  # a few straw strands
        a0 = rnd.random() * TAU
        pts = [(math.cos(a0 + k * 0.15) * 0.36, 0.03 + (rnd.random() - 0.5) * 0.06, math.sin(a0 + k * 0.15) * 0.36) for k in range(5)]
        t = C.taper_tube('straw', pts, 0.004, 0.003, 5, 16, cap=True)
        S.paint(t, '#e8d49a', 0.85)
        objs.append(t)
    hi = C.join(objs, 'nest_hi')
    lo = C.torus('nest', 0.3, 0.085, 36, 10, rot=(-math.pi / 2, 0, 0))
    return [S.Part(hi, 'nest', lo=lo)], dict(size=512, extrusion=0.06, ray=0.14, ao_distance=0.2)


# ------------------------------------------------------------------ egg bomb
def bomb():
    """Egg Bomb: cream egg with red spots, a riveted metal cap and a twisted fuse."""
    shell = C.lathe('bshell_hi', egg_profile(0.22, 0.3, 160), 192)
    C.displace(shell, lambda p, n: 0.0005 * noise.noise(Vector(p) * 80))

    def col(p, n):
        # big round painted spots (distance to the nearest random spot centre)
        v = noise.voronoi(Vector(p) * 5.5)[0][0]
        k = smooth(0.34, 0.3, v)
        cream, red = (0.96, 0.9, 0.76), (0.8, 0.07, 0.08)
        return (tuple(cream[i] + (red[i] - cream[i]) * k for i in range(3)), 0.32, 0, 0)
    S.paint_fn(shell, col)
    cap = C.lathe('bcap_hi', [(0.0001, 0.345), (0.05, 0.34), (0.075, 0.318), (0.082, 0.29), (0.07, 0.275)], 48)
    rivets = [C.uv_sphere('rivet', 1, 10, 6, pos=(math.cos(a) * 0.074, 0.3, math.sin(a) * 0.074), scale=0.007) for a in [k / 8 * TAU for k in range(8)]]
    cap = C.join([cap] + rivets, 'bcap_hi')
    S.paint(cap, '#6b6f78', 0.35, 1.0)
    fuse = C.taper_tube('fuse_hi', [(0, 0.33, 0), (0.02, 0.42, 0.01), (0.05, 0.5, -0.01), (0.09, 0.55, 0.0)], 0.014, 0.012, 12, 40, cap=True)
    C.displace(fuse, lambda p, n: 0.002 * math.sin(math.atan2(n[0], n[2]) * 2 + p[1] * 160))

    def fcol(p, n):
        return ('#2a2420', 0.9, 0, 1.0) if p[1] > 0.53 else ('#c9a26a', 0.9, 0, 0)
    S.paint_fn(fuse, fcol)
    hi = [shell, cap, fuse]
    lo_shell = C.lathe('bomb', egg_profile(0.22, 0.3, 14), 20)
    parts = [S.Part(shell, 'bomb', lo=lo_shell), S.Part(cap, 'bomb', tris=120), S.Part(fuse, 'bomb', tris=80)]
    return parts, dict(size=512, emissive=True)


# ------------------------------------------------------------------ fern peel
def frond(name, length, width, pairs, curl, lo=False):
    """A fern frond lying along +Z: midrib plus paired leaflets."""
    objs = []
    if lo:
        # a flat strip for the stem (drawn double-sided): 8 triangles
        segs = 4
        verts, faces = [], []
        for i in range(segs + 1):
            f = i / segs
            w = 0.014 * (1 - f * 0.7)
            verts += [(-w, curl * f * f, f * length), (w, curl * f * f, f * length)]
        for i in range(segs):
            faces.append([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])
        rib = C.mesh_obj(name + 'rib', verts, faces, recalc=False)
    else:
        rib = C.taper_tube(name + 'rib', [(0, 0, 0), (0, curl * 0.3, length * 0.5), (0, curl, length)], 0.012, 0.003, 10, 24)
    objs.append(rib)
    for i in range(pairs):
        f = (i + 0.6) / (pairs + 0.4)
        z = f * length * 0.95
        y = curl * f * f
        w = width * math.sin(max(0.15, f) * math.pi * 0.95) * (1.05 - f * 0.4)
        for s in (-1, 1):
            if lo:
                verts = [(0, y, z - 0.02), (s * w, y + 0.01, z + 0.03), (0, y + 0.002, z + 0.05)]
                objs.append(C.mesh_obj(name + 'lf', verts, [[0, 1, 2] if s > 0 else [2, 1, 0]], recalc=False))
            else:
                lf = C.taper_tube(name + 'lf', [(0, y, z), (s * w * 0.5, y + 0.012, z + 0.025), (s * w, y + 0.006, z + 0.045)], 0.018, 0.002, 8, 12, 0.18)
                C.displace(lf, lambda p, n: -0.0012 * (1 - abs(noise.noise(Vector(p) * 60))) ** 6)
                objs.append(lf)
    return C.join(objs, name)


def peel():
    """Fern Peel: five fronds splayed on the ground (the game's leaves: -90 + 15 deg tilt)."""
    his, los = [], []
    for i in range(5):
        a = i / 5 * TAU
        for lo in (False, True):
            fr = frond(f'frond{i}{"lo" if lo else "hi"}', 0.85, 0.2, 11, 0.12, lo=lo)
            C.transform(fr, rot=(0, a, 0), pos=(0, 0.02 + i * 0.005, 0))
            (los if lo else his).append(fr)
    hi = C.join(his, 'peel_hi')

    def col(p, n):
        r = math.hypot(p[0], p[2])
        c = (0.07, 0.3, 0.05) if r > 0.1 else (0.12, 0.35, 0.06)
        return (c, 0.4, 0, 0)
    S.paint_fn(hi, col)
    lo = C.join(los, 'peel')
    return [S.Part(hi, 'peel', lo=lo)], dict(size=512, extrusion=0.02, ray=0.05)


# ------------------------------------------------------------------ tar pit
def tar():
    """Tar pit puddle (3 m x 2.2 m): lumpy glossy rim, sunken middle. The game
    adds the bubbling blobs on top."""
    E = []
    rnd = __import__('random').Random(3)
    for i in range(16):
        a = i / 16 * TAU
        r = 1.2 + rnd.random() * 0.25
        E.append(dict(co=(math.cos(a) * r, 0, math.sin(a) * r * 0.72), size=(0.32, 0.07, 0.26)))
    E.append(dict(co=(0, 0.0, 0), size=(1.4, 0.05, 1.0)))
    E.append(dict(co=(0, 0.06, 0), size=(1.1, 0.05, 0.75), neg=True))
    hi = C.metaball('tar_hi', E, resolution=0.03)
    # cut away everything below the ground plane
    bm = bmesh.new(); bm.from_mesh(hi.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.005], context='VERTS')
    bm.to_mesh(hi.data); bm.free()
    C.displace(hi, lambda p, n: 0.004 * noise.noise(Vector(p) * 6) * max(0, n[1]))

    def col(p, n):
        r = math.hypot(p[0] / 1.5, p[2] / 1.1)
        return ((0.012, 0.01, 0.014) if r < 0.9 else (0.03, 0.025, 0.02), 0.05 if r < 0.95 else 0.2, 0.2, 0)
    S.paint_fn(hi, col)
    return [S.Part(hi, 'tar', tris=700)], dict(size=512, extrusion=0.05, ray=0.12)


# ------------------------------------------------------------------ meteor
def meteor():
    """Meteor: a pitted basalt rock (r 1.2) with molten cracks that glow."""
    def surf(p):
        v = Vector(p)
        k = 1 + 0.14 * noise.noise(v * 1.3) + 0.05 * noise.noise(v * 4.0)
        return k

    hi = C.uv_sphere('meteor_hi', 1.2, 256, 128)
    co = C.verts_np(hi)
    g = C.to_game(co)
    import numpy as np
    k = np.array([surf(p) for p in g])
    C.set_verts_np(hi, co * k[:, None])

    def crack(p):
        (d1, d2) = noise.voronoi(Vector(p) * 1.7, distance_metric='DISTANCE')[0][:2]
        return d2 - d1  # 0 on cell borders

    def fn(p, n):
        c = crack(p)
        pits = -0.02 * smooth(0.1, 0.02, noise.voronoi(Vector(p) * 6)[0][0])
        return -0.05 * smooth(0.09, 0.0, c) + pits + 0.008 * noise.noise(Vector(p) * 12)
    C.displace(hi, fn)

    def col(p, n):
        c = crack(p)
        glow = smooth(0.08, 0.0, c)
        if glow > 0.35:
            return ((1.0, 0.45 + 0.4 * glow, 0.08), 0.6, 0, glow)
        tone = 0.5 + 0.5 * noise.noise(Vector(p) * 3)
        return ((0.05 + 0.03 * tone, 0.035 + 0.02 * tone, 0.03), 0.85, 0, 0)
    S.paint_fn(hi, col)
    lo = C.uv_sphere('meteor', 1.2, 40, 20)
    lco = C.verts_np(lo)
    lk = np.array([surf(p) for p in C.to_game(lco)])
    C.set_verts_np(lo, lco * lk[:, None])
    return [S.Part(hi, 'meteor', lo=lo)], dict(size=1024, emissive=True, extrusion=0.1, ray=0.2, ao_distance=0.4)


# ------------------------------------------------------------------ hurdles
def bone_hurdle():
    """Giant cartoon fossil bone across the track on two steel trestles (stadium,
    volcano). Bone centre at y=0.5 like the game's."""
    L = HURDLE
    E = [dict(type='CAPSULE', co=(0, 0.5, 0), r=0.17, half=(L - 0.8) / 2)]
    for s in (-1, 1):
        for dz in (-0.14, 0.14):
            E.append(dict(type='BALL', co=(s * (L / 2 - 0.3), 0.5, dz), r=0.25))
    shaft = C.metaball('bone_hi', E, resolution=0.012)

    def fn(p, n):
        pores = -0.0025 * smooth(0.08, 0.02, noise.voronoi(Vector(p) * 18)[0][0])
        cracks = -0.006 * smooth(0.02, 0.0, abs(noise.noise(Vector(p) * Vector((0.8, 3, 3)))))
        return pores + cracks + 0.004 * noise.noise(Vector(p) * 5)
    C.displace(shaft, fn)

    def col(p, n):
        t = 0.5 + 0.5 * noise.noise(Vector(p) * 2)
        return ((0.86 - 0.08 * t, 0.8 - 0.1 * t, 0.66 - 0.12 * t), 0.6, 0, 0)
    S.paint_fn(shaft, col)
    stands = []
    for s in (-1, 1):
        x = s * (L / 2 - 0.8)
        legs = [C.rounded_box('leg', 0.05, 0.62, 0.05, 0.012, pos=(x, 0.26, dz * 0.22), rot=(dz * 0.42, 0, 0)) for dz in (-1, 1)]
        top = C.rounded_box('saddle', 0.12, 0.05, 0.24, 0.015, pos=(x, 0.33, 0))
        cradle = C.torus('cradle', 0.18, 0.018, 32, 8, arc=math.pi, pos=(x, 0.5, 0), rot=(0, math.pi / 2, math.pi))
        feet = [C.rounded_box('foot', 0.1, 0.03, 0.12, 0.01, pos=(x, 0.015, dz * 0.35)) for dz in (-1, 1)]
        stands += legs + [top, cradle] + feet
    stand = C.join(stands, 'stand_hi')
    S.paint(stand, '#6b6f78', 0.4, 0.8)
    lo_bone = C.copy_obj(shaft, 'bone_lo')
    for a in list(lo_bone.data.color_attributes):
        lo_bone.data.color_attributes.remove(a)
    C.decimate(lo_bone, 900)
    return [S.Part(shaft, 'bone', lo=lo_bone, uvw=1.0), S.Part(stand, 'stand', tris=400, uvw=0.3)], dict(size=1024, extrusion=0.03, ray=0.08)


def log_hurdle():
    """Mossy fallen log across the jungle track (axis x, centre y=0.28)."""
    L = HURDLE
    prof = [(0.0001, -L / 2 - 0.02), (0.26, -L / 2), (0.3, -L / 2 + 0.03)]
    for i in range(1, 400):  # ~2 cm rings: the bark needs the resolution
        y = -L / 2 + L * i / 400
        prof.append((0.3 + 0.02 * (y / L + 0.5), y))
    prof += [(0.32, L / 2 - 0.03), (0.28, L / 2), (0.0001, L / 2 + 0.02)]
    hi = C.lathe('log_hi', prof, 96)
    # lathe runs along Y: lay it along X at the log height
    C.transform(hi, rot=(0, 0, math.pi / 2))
    C.transform(hi, pos=(0, 0.28, 0))

    def fn(p, n):
        a = math.atan2(p[2], p[1] - 0.28)
        end = abs(n[0]) > 0.7
        if end:
            r = math.hypot(p[1] - 0.28, p[2])
            return -0.004 * (math.sin(r * 120) > 0.3)
        bark = -0.02 * (1 - abs(noise.noise(Vector((p[0] * 1.5, a * 3.0, 0.0)))) ) ** 3
        knots = -0.03 * smooth(0.06, 0.0, noise.voronoi(Vector(p) * 2.5)[0][0])
        return bark + knots
    C.displace(hi, fn)

    def col(p, n):
        if abs(n[0]) > 0.7:
            r = math.hypot(p[1] - 0.28, p[2])
            ring = 0.5 + 0.5 * math.sin(r * 120)
            return ((0.62 + 0.08 * ring, 0.46 + 0.06 * ring, 0.28), 0.8, 0, 0)
        moss = smooth(0.35, 0.8, n[1]) * smooth(-0.2, 0.3, noise.noise(Vector(p) * 1.8))
        bark = 0.5 + 0.5 * noise.noise(Vector(p) * 6)
        c = (0.26 + 0.08 * bark, 0.18 + 0.05 * bark, 0.11 + 0.03 * bark)
        m = (0.28, 0.45, 0.14)
        return (tuple(c[i] + (m[i] - c[i]) * moss for i in range(3)), 0.95, 0, 0)
    S.paint_fn(hi, col)
    lo = C.lathe('log_lo', [(0.0001, -L / 2 - 0.02), (0.28, -L / 2), (0.3, -L / 2 + 0.05), (0.31, 0), (0.32, L / 2 - 0.05), (0.28, L / 2), (0.0001, L / 2 + 0.02)], 18)
    C.transform(lo, rot=(0, 0, math.pi / 2))
    C.transform(lo, pos=(0, 0.28, 0))
    return [S.Part(hi, 'log', lo=lo)], dict(size=1024, extrusion=0.06, ray=0.2)


# ------------------------------------------------------------------ start arch
def arch():
    """Inflatable start/finish arch: a striped air tube with sewn segment seams,
    anchored by two sand bags. Same span as the game's (scaled 1.3 tall in-game)."""
    span = HALF + 1.8
    segs, rseg = 240, 48
    verts, faces, cols = [], [], []
    for i in range(segs + 1):
        u = i / segs * math.pi
        k = u / math.pi * 12  # 12 panels
        seam = min(k % 1, 1 - k % 1)
        for j in range(rseg):
            v = j / rseg * TAU
            r = 0.75 * (1 + 0.035 * (1 - math.exp(-(seam / 0.12) ** 2))) - 0.02 * math.exp(-(seam / 0.02) ** 2)
            verts.append(((span + r * math.cos(v)) * math.cos(u), (span + r * math.cos(v)) * math.sin(u), r * math.sin(v)))
            cols.append(int(k) % 2)
    for i in range(segs):
        for j in range(rseg):
            j2 = (j + 1) % rseg
            faces.append([i * rseg + j, (i + 1) * rseg + j, (i + 1) * rseg + j2, i * rseg + j2])
    hi = C.mesh_obj('arch_hi', verts, faces)
    import numpy as np
    col = np.array([C.hex_lin('#e5484d') if c == 0 else C.hex_lin('#ffffff') for c in cols], dtype=np.float32)
    a = hi.data.color_attributes.new('col', 'FLOAT_COLOR', 'POINT'); a.data.foreach_set('color', col.ravel())
    C.set_attr(hi, 'mat', (0.35, 0, 0, 1))
    C.displace(hi, lambda p, n: -0.004 * (1 - abs(noise.noise(Vector(p) * 3))) ** 8)
    lo = C.torus('arch', span, 0.75, 72, 14, arc=math.pi)
    bags = []
    for s in (-1, 1):
        b = C.metaball('bag', [dict(co=(s * span, 0.25, 0.9), size=(0.5, 0.25, 0.35)),
                               dict(co=(s * span, 0.42, 0.9), size=(0.12, 0.12, 0.12))], resolution=0.02)
        C.displace(b, lambda p, n: 0.006 * noise.noise(Vector(p) * 9))
        bags.append(b)
    bag = C.join(bags, 'bags_hi')
    S.paint(bag, '#c2a36b', 0.95)
    return [S.Part(hi, 'arch', lo=lo), S.Part(bag, 'arch', tris=500, uvw=0.5)], dict(size=1024, extrusion=0.04, ray=0.1)


# ------------------------------------------------------------------ attack items
def blaster():
    """Water Blaster: a chunky toy pump-action water gun, held with the grip at
    the origin and the nozzle pointing +Z (the game adds the jet)."""
    body = C.metaball('body', [
        dict(co=(0, 0.03, 0.1), size=(0.07, 0.075, 0.25)),
        dict(co=(0, 0.02, 0.33), size=(0.05, 0.05, 0.12)),
        dict(type='CAPSULE', co=(0, -0.08, -0.04), r=0.045, half=0.07, rot=(0, 0, math.pi / 2 - 0.25)),
    ], resolution=0.006)
    C.displace(body, lambda p, n: -0.0025 * math.exp(-(p[0] / 0.003) ** 2) + 0.0006 * noise.noise(Vector(p) * 60))  # mould seam
    S.paint_fn(body, lambda p, n: ('#ff8a1f', 0.35, 0, 0) if p[1] > -0.05 or p[2] > 0.02 else ('#e0671a', 0.5, 0, 0))
    tank = C.metaball('tank', [dict(type='CAPSULE', co=(0, 0.16, 0.02), r=0.085, half=0.12, rot=(0, math.pi / 2, 0))], resolution=0.006)

    def tank_col(p, n):
        # water sloshing in a clear tank: deeper blue below the water line
        return ((0.25, 0.62, 1.0) if p[1] < 0.16 + 0.02 * math.sin(p[2] * 20) else (0.72, 0.88, 1.0), 0.08, 0, 0)
    S.paint_fn(tank, tank_col)
    nozzle = C.taper_tube('nozzle', [(0, 0.03, 0.42), (0, 0.035, 0.52), (0, 0.04, 0.58)], 0.03, 0.022, 16, 12, cap=True)
    ring = C.torus('muzzle', 0.028, 0.008, 24, 8, pos=(0, 0.04, 0.58))
    nozzle = C.join([nozzle, ring], 'nozzle')
    S.paint(nozzle, '#ffd84a', 0.4)
    pump = C.metaball('pump', [dict(co=(0, -0.045, 0.3), size=(0.055, 0.04, 0.1))], resolution=0.005)
    C.displace(pump, lambda p, n: -0.004 * (math.sin(p[2] * 180) > 0.4))  # finger grooves
    S.paint(pump, '#5bbf4a', 0.45)
    trigger = C.taper_tube('trigger', [(0, -0.03, 0.02), (0, -0.07, 0.035), (0, -0.09, 0.02)], 0.012, 0.01, 10, 10)
    S.paint(trigger, '#2a2a2e', 0.5)
    parts = [S.Part(body, 'blaster', tris=500), S.Part(tank, 'blaster', tris=200), S.Part(nozzle, 'blaster', tris=120),
             S.Part(pump, 'blaster', tris=100), S.Part(trigger, 'blaster', tris=40)]
    return parts, dict(size=512, extrusion=0.01, ray=0.03, ao_distance=0.12)


def mallet():
    """Squeaky Mallet: a giant inflatable hammer. Grip at the origin, handle up
    +Y, the pillowy head across X at the top."""
    handle = C.taper_tube('handle', [(0, 0, 0), (0, 0.45, 0), (0, 0.9, 0)], 0.042, 0.036, 20, 48, cap=True)

    def hcol(p, n):
        stripe = (math.atan2(n[2], n[0]) / math.tau + p[1] * 3.5) % 1 < 0.5
        return ('#2f80ed' if stripe else '#ffffff', 0.4, 0, 0)
    S.paint_fn(handle, hcol)
    L, R = 0.36, 0.2
    prof = [(0.0001, -L - R * 0.7)]
    for i in range(1, 17):
        a = i / 16 * math.pi / 2
        prof.append((R * math.sin(a), -L - R * 0.7 * math.cos(a)))
    for i in range(1, 40):
        y = -L + 2 * L * i / 40
        prof.append((R * (1 + 0.06 * math.sin(math.pi * (i / 40 * 3 % 1))), y))  # three puffed panels
    for i in range(16, -1, -1):
        a = i / 16 * math.pi / 2
        prof.append((max(0.0001, R * math.sin(a)), L + R * 0.7 * math.cos(a)))
    head = C.lathe('head', prof, 64)
    C.transform(head, rot=(0, 0, math.pi / 2), pos=(0, 1.02, 0))
    seams = [C.torus(f'seam{i}', R * 1.02, 0.014, 64, 8, rot=(0, math.pi / 2, 0), pos=(x, 1.02, 0)) for i, x in enumerate((-L, -L / 3, L / 3, L))]

    def head_col(p, n):
        cap = abs(p[0]) > L + 0.02
        return ('#ffd84a' if cap else '#e5484d', 0.35, 0, 0)
    S.paint_fn(head, head_col)
    seam = C.join(seams, 'seams')
    S.paint(seam, '#b8262b', 0.5)
    valve = C.lathe('valve', [(0.0001, 0), (0.025, 0), (0.025, 0.03), (0.018, 0.045), (0.0001, 0.05)], 16)
    C.transform(valve, pos=(0.1, 1.02 + R, 0))
    S.paint(valve, '#f4f2ec', 0.5)
    return [S.Part(handle, 'mallet', tris=200), S.Part(head, 'mallet', tris=500, uvw=1.5), S.Part(seam, 'mallet', tris=200),
            S.Part(valve, 'mallet', tris=40)], dict(size=512, extrusion=0.015, ray=0.04, ao_distance=0.2)


def balloon():
    """Water Balloon: a glossy teardrop of water with a tied knot, centred on the origin."""
    prof = []
    for i in range(41):
        t = i / 40  # 0 = knot end, 1 = top
        a = t * math.pi
        # round crown on top, pinched to a neck at the knot
        r = 0.22 * math.sin(a) ** (0.55 + 0.6 * (1 - t)) * (0.82 + 0.2 * t)
        prof.append((max(0.0001, r), -0.24 + 0.5 * t))
    body = C.lathe('balloon', prof, 64)
    C.displace(body, lambda p, n: 0.004 * math.sin(p[1] * 20 + math.atan2(p[0], p[2]) * 2) * max(0, -p[1]) * 3)
    deep, light = (0.08, 0.36, 0.95), (0.3, 0.62, 1.0)  # linear: fuller water at the bottom
    S.paint_fn(body, lambda p, n: (tuple(deep[i] + (light[i] - deep[i]) * smooth(-0.2, 0.25, p[1]) for i in range(3)), 0.12, 0, 0))
    knot = C.metaball('knot', [dict(co=(0, -0.27, 0), size=(0.03, 0.035, 0.03)), dict(co=(0.02, -0.31, 0.01), size=(0.035, 0.012, 0.02))], resolution=0.003)
    S.paint(knot, '#2c7bd6', 0.3)
    return [S.Part(body, 'balloon', tris=300), S.Part(knot, 'balloon', tris=60)], dict(size=256, extrusion=0.01, ray=0.03, ao_distance=0.1)


def hatchling():
    """A just-hatched baby inflatable raptor (0.65 m tall), facing +Z, with a
    cap of eggshell still on its head."""
    E = [dict(co=(0, 0.3, 0), size=(0.17, 0.16, 0.22)),
         dict(co=(0, 0.5, 0.17), size=(0.14, 0.13, 0.15)),
         dict(co=(0, 0.47, 0.29), size=(0.09, 0.07, 0.1))]
    for s in (-1, 1):
        E += [dict(type='CAPSULE', co=(s * 0.08, 0.13, 0.02), r=0.05, half=0.07, rot=(0, 0, math.pi / 2 + 0.25)),
              dict(co=(s * 0.08, 0.03, 0.07), size=(0.05, 0.03, 0.08))]
    body = C.metaball('body', E, resolution=0.006)
    tail = C.taper_tube('tail', [(0, 0.3, -0.16), (0, 0.33, -0.36), (0, 0.4, -0.55)], 0.09, 0.012, 20, 24)
    body = C.join([body, tail], 'body')
    C.remesh(body, 0.008, smooth=3)

    def col(p, n):
        belly = smooth(-0.15, -0.65, n[1]) if abs(p[2]) < 0.25 else 0
        v = noise.voronoi(Vector(p) * 14)[0][0]
        spot = 0.0 if n[1] < 0 else smooth(0.12, 0.08, v)
        base = (0.9, 0.3, 0.035)  # linear: a warm raptor orange
        c = tuple(base[i] + ((1.0, 0.9, 0.7)[i] - base[i]) * belly for i in range(3))
        c = tuple(c[i] * (1 - 0.45 * spot) for i in range(3))
        return (c, 0.5, 0, 0)
    S.paint_fn(body, col)
    eyes = []
    for s in (-1, 1):
        e = C.uv_sphere('eye', 1, 24, 16, pos=(s * 0.085, 0.56, 0.26), scale=0.045)
        S.paint_fn(e, lambda p, n, s=s: ('#101014', 0.1, 0, 0) if (Vector(p) - Vector((s * 0.085, 0.56, 0.26))).normalized().dot(Vector((s * 0.4, 0.1, 0.9)).normalized()) > 0.8 else ('#ffffff', 0.15, 0, 0))
        eyes.append(e)
    eyes = C.join(eyes, 'eyes')
    shell = C.uv_sphere('shell', 1, 32, 10, phi=(0, 1.2), pos=(0, 0.52, 0.14), scale=(0.155, 0.13, 0.155), rot=(-0.3, 0, 0.25))
    # a broken, zig-zag rim where it cracked open
    g = C.to_game(C.verts_np(shell))
    rim_y = g[:, 1].min()
    for i, p in enumerate(g):
        if p[1] < rim_y + 0.02:
            a = math.atan2(p[0], p[2] - 0.14)
            g[i, 1] += 0.025 * (2 * abs((a * 7 / math.tau) % 1 - 0.5))
    C.set_verts_np(shell, C.to_blender(g))
    C.mod(shell, 'SOLIDIFY', thickness=0.012, offset=1)
    C.apply_modifiers(shell)
    S.paint(shell, '#fbf4e2', 0.6)
    claws = []
    for s in (-1, 1):
        for k in (-1, 0, 1):
            c = C.taper_tube('claw', [(0, 0, 0), (0, 0, 0.025), (0, -0.015, 0.04)], 0.009, 0.002, 8, 8)
            C.transform(c, pos=(s * 0.08 + k * 0.022, 0.02, 0.14))
            claws.append(c)
    claws = C.join(claws, 'claws')
    S.paint(claws, '#f4ecd6', 0.7)
    return [S.Part(body, 'hatchling', tris=600, uvw=1.3), S.Part(eyes, 'hatchling', tris=100, uvw=1.5),
            S.Part(shell, 'hatchling', tris=100), S.Part(claws, 'hatchling', tris=50)], \
        dict(size=512, extrusion=0.012, ray=0.03, ao_distance=0.15)


ASSETS = {
    'egg': egg, 'nest': nest, 'bomb': bomb, 'peel': peel, 'tar': tar, 'meteor': meteor,
    'bone_hurdle': bone_hurdle, 'log_hurdle': log_hurdle, 'arch': arch,
    'blaster': blaster, 'mallet': mallet, 'balloon': balloon, 'hatchling': hatchling,
}


PREVIEW_TINT = {'egg': '#8fd0ff'}


def build(name, opts):
    C.reset()
    C.log(f'prop {name}')
    parts, kw = ASSETS[name]()
    if opts.get('preview'):
        from lib.preview import render_static
        kw['preview'] = lambda objs, out_dir, files: render_static(name, objs, out_dir, files, PREVIEW_TINT.get(name))
    return S.build(name, 'props', parts, **kw)
