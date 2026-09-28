"""Inflatable dinosaur costumes: high-poly build, low-poly game mesh, rig, bake, export.

The rig is the contract with public/js/three/dino3d.js. Every bone points straight
up in Blender with zero roll, so it exports to glTF with an identity rotation and
the game can animate it exactly like the procedural joints:

  pivot > torso > spine_0..spine_N   (chain from the pelvis bone spine_<root> out to
                                      the tail tip and up to the neck top)
  spine_N > head > jaw, lid_0, lid_1
  spine_k > arm_0, arm_1 (> wing_0, wing_1 on the pteranodon), fan
  pivot > hip_0 > knee_0 > ankle_0, and the same for _1
  index 0 is the runner's side at -x, index 1 at +x (same order as the game)

Materials (glTF names the game maps to its own materials):
  fabric    tinted nylon: body, head, jaw, lids, arms, trousers, species extras
  membrane  pteranodon wing skin (same textures as fabric, translucent)
  trim      everything with a fixed colour: eyes, teeth, claws, horns, shoes, fan
  face      the runner's face behind the window (texture drawn by the game)
  window    clear PVC dome over the face
  bib       race bib (texture drawn by the game)
"""
import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

from lib import bake as B
from lib import common as C

HIP = 0.92
LID_OPEN = -0.75
SIDE = Vector((1, 0, 0))
TAU = math.tau

# spine: tail tip -> neck top. prof: [t, half-width, half-height]. bones: t values,
# root = pelvis bone. rings: t of the sewn seams around the body.
SPECIES = {
    'trex': dict(
        spine=[[0, 0.2, -1.95], [0, 0.4, -1.35], [0, 0.78, -0.72], [0, 1.18, -0.16], [0, 1.56, 0.04], [0, 1.88, 0.18], [0, 2.04, 0.4]],
        prof=[[0, 0.03, 0.03], [0.18, 0.12, 0.13], [0.36, 0.28, 0.3], [0.52, 0.52, 0.56], [0.68, 0.46, 0.5], [0.84, 0.32, 0.32], [1, 0.22, 0.22]],
        bones=[0, 0.14, 0.28, 0.42, 0.55, 0.7, 0.82, 0.92, 1], root=4,
        head=dict(len=0.9, w=0.52, h=0.44, taper=0.42, drop=0.07, at=[0, 0.03, 0.3]),
        pattern='stripes', arms='tiny', armT=0.66, eyes='#e0a020', back='spikes', color='#5bbf4a',
        rings=[0.2, 0.38, 0.8], jaw=True, teeth=(8, 6, 0.085, 0.06)),
    'raptor': dict(
        spine=[[0, 0.5, -2.15], [0, 0.72, -1.45], [0, 1.0, -0.72], [0, 1.24, -0.12], [0, 1.52, 0.2], [0, 1.78, 0.38], [0, 1.92, 0.6]],
        prof=[[0, 0.02, 0.02], [0.2, 0.08, 0.09], [0.4, 0.22, 0.25], [0.55, 0.42, 0.47], [0.68, 0.38, 0.42], [0.82, 0.2, 0.22], [1, 0.16, 0.17]],
        bones=[0, 0.14, 0.28, 0.42, 0.55, 0.68, 0.8, 0.9, 1], root=4,
        head=dict(len=0.8, w=0.34, h=0.3, taper=0.5, drop=0.03, at=[0, 0.02, 0.28]),
        pattern='tiger', arms='feathered', armT=0.64, eyes='#ffc93a', back='feathers', color='#d98b3a',
        rings=[0.24, 0.44, 0.8], jaw=True, teeth=(6, 5, 0.045, 0.035)),
    'trike': dict(
        spine=[[0, 0.36, -1.8], [0, 0.64, -1.3], [0, 1.0, -0.72], [0, 1.3, -0.12], [0, 1.36, 0.4], [0, 1.26, 0.82], [0, 1.2, 1.02]],
        prof=[[0, 0.03, 0.03], [0.15, 0.12, 0.12], [0.35, 0.36, 0.34], [0.55, 0.62, 0.56], [0.72, 0.56, 0.5], [0.88, 0.33, 0.31], [1, 0.3, 0.28]],
        bones=[0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1], root=4,
        head=dict(len=0.72, w=0.56, h=0.48, taper=0.4, drop=0.1, at=[0, 0.02, 0.32]),
        pattern='spots', arms='stubby', armT=0.74, eyes='#6a3a1a', back=None, color='#3f8fd6',
        rings=[0.18, 0.36, 0.84], jaw=False),
    'stego': dict(
        spine=[[0, 0.3, -1.85], [0, 0.6, -1.3], [0, 1.05, -0.72], [0, 1.35, -0.12], [0, 1.3, 0.45], [0, 1.06, 0.86], [0, 0.96, 1.02]],
        prof=[[0, 0.03, 0.03], [0.15, 0.11, 0.12], [0.35, 0.34, 0.36], [0.55, 0.58, 0.6], [0.72, 0.5, 0.52], [0.88, 0.23, 0.23], [1, 0.18, 0.18]],
        bones=[0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1], root=4,
        head=dict(len=0.56, w=0.34, h=0.28, taper=0.45, drop=0.04, at=[0, 0.01, 0.24]),
        pattern='spots', arms='stubby', armT=0.74, eyes='#3a6a2a', back='plates', color='#c9577a',
        rings=[0.18, 0.36, 0.84], jaw=False),
    'ptera': dict(
        spine=[[0, 0.95, -0.62], [0, 1.05, -0.4], [0, 1.25, -0.12], [0, 1.6, 0.05], [0, 1.94, 0.14], [0, 2.2, 0.24], [0, 2.34, 0.4]],
        prof=[[0, 0.04, 0.04], [0.15, 0.12, 0.13], [0.35, 0.4, 0.42], [0.5, 0.44, 0.48], [0.65, 0.36, 0.38], [0.82, 0.15, 0.16], [1, 0.12, 0.13]],
        bones=[0, 0.2, 0.36, 0.5, 0.62, 0.74, 0.86, 1], root=3,
        head=dict(len=0.44, w=0.3, h=0.3, taper=0.3, drop=0, at=[0, 0.02, 0.14]),
        pattern='scales', arms='wings', armT=0.66, eyes='#c0302a', back=None, color='#9a6fd1',
        rings=[0.8], jaw=False),
    'ankylo': dict(
        spine=[[0, 0.48, -1.9], [0, 0.64, -1.35], [0, 0.96, -0.75], [0, 1.2, -0.12], [0, 1.2, 0.45], [0, 1.06, 0.86], [0, 1.0, 1.0]],
        prof=[[0, 0.1, 0.08], [0.15, 0.13, 0.11], [0.35, 0.4, 0.3], [0.55, 0.78, 0.52], [0.72, 0.72, 0.48], [0.88, 0.3, 0.26], [1, 0.26, 0.22]],
        bones=[0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1], root=4,
        head=dict(len=0.54, w=0.6, h=0.34, taper=0.25, drop=0.04, at=[0, 0.01, 0.26]),
        pattern='patches', arms='stubby', armT=0.74, eyes='#5a3a1a', back='armour', color='#8a8f3c',
        rings=[0.2, 0.36, 0.86], jaw=False),
    'parasaur': dict(
        spine=[[0, 0.25, -1.9], [0, 0.45, -1.3], [0, 0.8, -0.7], [0, 1.2, -0.12], [0, 1.58, 0.04], [0, 1.94, 0.18], [0, 2.12, 0.4]],
        prof=[[0, 0.03, 0.03], [0.18, 0.11, 0.12], [0.36, 0.28, 0.3], [0.52, 0.48, 0.52], [0.66, 0.44, 0.48], [0.8, 0.23, 0.25], [1, 0.18, 0.2]],
        bones=[0, 0.14, 0.28, 0.42, 0.55, 0.7, 0.82, 0.92, 1], root=4,
        head=dict(len=0.74, w=0.4, h=0.36, taper=0.3, drop=0.08, bill=1, at=[0, 0.03, 0.28]),
        pattern='stripes', arms='small', armT=0.66, eyes='#2a7a3a', back='spikes', color='#e0b43a',
        rings=[0.2, 0.38, 0.78], jaw=True, teeth=None),
    'pachy': dict(
        spine=[[0, 0.24, -1.85], [0, 0.44, -1.3], [0, 0.8, -0.7], [0, 1.2, -0.12], [0, 1.56, 0.04], [0, 1.86, 0.18], [0, 2.02, 0.38]],
        prof=[[0, 0.03, 0.03], [0.18, 0.11, 0.12], [0.36, 0.28, 0.3], [0.52, 0.49, 0.53], [0.66, 0.45, 0.49], [0.8, 0.26, 0.28], [1, 0.19, 0.2]],
        bones=[0, 0.14, 0.28, 0.42, 0.55, 0.7, 0.82, 0.92, 1], root=4,
        head=dict(len=0.6, w=0.44, h=0.4, taper=0.4, drop=0.05, at=[0, 0.03, 0.24]),
        pattern='spots', arms='small', armT=0.66, eyes='#3a5aa0', back='spikes', color='#4bb3a8',
        rings=[0.2, 0.38, 0.78], jaw=True, teeth=None),
}

IVORY = '#f4ecd6'


def smooth(a, b, x):
    f = max(0.0, min(1.0, (x - a) / (b - a)))
    return f * f * (3 - 2 * f)


def angd(a, b):
    x = (a - b) % TAU
    return min(x, TAU - x)


# ------------------------------------------------------------------ spine curve
class Spine:
    """Port of THREE.CatmullRomCurve3(points, false, 'centripetal') with getPointAt."""

    def __init__(self, pts):
        self.P = [Vector(p) for p in pts]
        n = 200
        L = [0.0]
        prev = self.point(0)
        for i in range(1, n + 1):
            p = self.point(i / n)
            L.append(L[-1] + (p - prev).length)
            prev = p
        self.L = L
        self.length = L[-1]

    def point(self, t):
        P = self.P
        l = len(P)
        p = (l - 1) * t
        ip = int(math.floor(p))
        w = p - ip
        if w == 0 and ip == l - 1:
            ip = l - 2
            w = 1
        p0 = P[ip - 1] if ip > 0 else (P[0] - P[1]) + P[0]
        p1 = P[ip]
        p2 = P[ip + 1]
        p3 = P[ip + 2] if ip + 2 < l else (P[l - 1] - P[l - 2]) + P[l - 1]
        dt0 = ((p1 - p0).length_squared) ** 0.25
        dt1 = ((p2 - p1).length_squared) ** 0.25
        dt2 = ((p3 - p2).length_squared) ** 0.25
        if dt1 < 1e-4:
            dt1 = 1.0
        if dt0 < 1e-4:
            dt0 = dt1
        if dt2 < 1e-4:
            dt2 = dt1
        out = []
        for k in range(3):
            x0, x1, x2, x3 = p0[k], p1[k], p2[k], p3[k]
            t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1
            t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2
            t1 *= dt1
            t2 *= dt1
            c0, c1, c2, c3 = x1, t1, -3 * x1 + 3 * x2 - 2 * t1 - t2, 2 * x1 - 2 * x2 + t1 + t2
            out.append(c0 + c1 * w + c2 * w * w + c3 * w * w * w)
        return Vector(out)

    def u2t(self, u):
        L = self.L
        il = len(L)
        target = u * self.length
        lo, hi = 0, il - 1
        i = 0
        while lo <= hi:
            i = (lo + hi) // 2
            c = L[i] - target
            if c < 0:
                lo = i + 1
            elif c > 0:
                hi = i - 1
            else:
                hi = i
                break
        i = hi
        if i >= il - 1:
            return 1.0
        if L[i] == target:
            return i / (il - 1)
        seg = L[i + 1] - L[i]
        return (i + (target - L[i]) / seg) / (il - 1)

    def at(self, u):
        return self.point(self.u2t(u))

    def tangent(self, u):
        t = self.u2t(u)
        d = 1e-4
        return (self.point(min(1, t + d)) - self.point(max(0, t - d))).normalized()


def profile_at(prof, t):
    for i in range(len(prof) - 1):
        t0, w0, h0 = prof[i]
        t1, w1, h1 = prof[i + 1]
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            s = f * f * (3 - 2 * f)
            return w0 + (w1 - w0) * s, h0 + (h1 - h0) * s
    return prof[-1][1], prof[-1][2]


def frame(sp, spine, u):
    P = spine.at(u)
    T = spine.tangent(u)
    up = T.cross(SIDE).normalized()
    rx, ry = profile_at(sp['prof'], u)
    return P, T, up, rx, ry


def surface(sp, spine, u, theta, lift=1.0):
    """Point on the (undisplaced) shell: theta 0 = right side (+x), pi/2 = dorsal."""
    P, T, up, rx, ry = frame(sp, spine, u)
    bulge = 1.06 if math.sin(theta) < 0 else 1.0
    p = P + SIDE * (math.cos(theta) * rx * lift) + up * (math.sin(theta) * ry * bulge * lift)
    n = (SIDE * (math.cos(theta) / rx) + up * (math.sin(theta) / ry)).normalized()
    return p, n, up


def nearest_bone(sp, u):
    return min(range(len(sp['bones'])), key=lambda i: abs(sp['bones'][i] - u))


# ------------------------------------------------------------------ parts
class Part:
    """One piece of the costume: a high-poly sculpt and its low-poly game mesh."""

    def __init__(self, name, kind, hi=None, bone=None, tris=600, uvw=1.0, lo=None):
        self.name, self.kind, self.hi, self.bone, self.tris, self.uvw, self.lo = name, kind, hi, bone, tris, uvw, lo


def fab(obj, dark=0.0, belly=0.0, accent=0.0, pattern=0.0):
    return C.set_attr(obj, 'mask', (dark, belly, accent, pattern))


def trim(obj, color, rough=0.5, metal=0.0, tint=0.0):
    C.set_attr(obj, 'col', C.hex_lin(color))
    C.set_attr(obj, 'mat', (rough, metal, tint, 1.0))
    return obj


def trim_fn(obj, fn):
    """fn(game_pos) -> (hex or linear rgb, rough, metal, tint)"""
    gp = C.to_game(C.verts_np(obj))
    cols, mats = [], []
    for p in gp:
        c, r, m, t = fn(p)
        cols.append(C.hex_lin(c) if isinstance(c, str) else (*c, 1.0))
        mats.append((r, m, t, 1.0))
    me = obj.data
    for name, arr in (('col', cols), ('mat', mats)):
        a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', np.asarray(arr, dtype=np.float32).ravel())
    return obj


def frame_matrix(origin, z, up_hint=Vector((0, 1, 0))):
    """Game-space 4x4 with local +Z along `z`, +Y as close to up_hint as possible."""
    z = Vector(z).normalized()
    x = Vector(up_hint).cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x).normalized()
    m = Matrix.Identity(4)
    for i in range(3):
        m[i][0], m[i][1], m[i][2], m[i][3] = x[i], y[i], z[i], origin[i]
    return m


def place(obj, m):
    """Apply a game-space matrix to a mesh built in game space."""
    Cb = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game -> blender
    obj.data.transform(Cb @ m @ Cb.inverted())
    obj.data.update()
    return obj


def raycast(obj, origin, direction):
    """Game-space ray against a mesh object; returns (point, normal) in game space."""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(obj, dg)
    o = C.G(*origin)
    d = C.G(*direction).normalized()
    hit, nrm, _, _ = bvh.ray_cast(o, d)
    if hit is None:
        return None, None
    g = lambda v: Vector((v.x, v.z, -v.y))
    return g(hit), g(nrm)


# ------------------------------------------------------------------ body shell
def body_disp(sp, s, theta, rx, ry, L, p):
    """Inflatable detail at arc length s / angle theta: seam grooves, pillowing
    between panels, compression folds at the throat and tail root, pull creases."""
    r_avg = math.sqrt((rx * rx + ry * ry) / 2)
    seams = (math.pi / 2, -math.pi / 2, 0.22, math.pi - 0.22)
    dmin = min(angd(theta, a) for a in seams) * r_avg
    rings = [r * L for r in sp['rings']]
    ds = min(abs(s - r) for r in rings) if rings else 9.0
    groove = -0.011 * math.exp(-(dmin / 0.008) ** 2) - 0.009 * math.exp(-(ds / 0.008) ** 2)
    pillow = 0.016 * (1 - math.exp(-(dmin / 0.07) ** 2)) * (1 - math.exp(-(ds / 0.06) ** 2))
    # pull creases fanning off the seams
    k = min(range(4), key=lambda i: angd(theta, seams[i]))
    ridge = 1 - abs(noise.noise(Vector((s * 5.0, dmin * 26.0, k * 7.3))))
    creases = -0.0035 * ridge ** 8 * math.exp(-dmin / 0.05)
    # compression folds: throat (front of the neck) and underside of the tail root
    u = s / L
    sn = math.sin(theta)
    throat = smooth(0.7, 0.78, u) * (1 - smooth(0.9, 0.97, u)) * smooth(0.3, -0.5, sn)
    root = smooth(0.24, 0.3, u) * (1 - smooth(0.42, 0.48, u)) * smooth(0.2, -0.6, sn)
    ph = 2.5 * noise.noise(Vector(p) * 3.0)
    folds = 0.006 * math.sin(s * TAU / 0.07 + ph) * (throat + root * 0.7)
    lumpy = 0.004 * noise.noise(Vector(p) * 2.2 + Vector((3.1, 0, 0)))
    return (groove + pillow + creases + folds + lumpy) * min(1.0, r_avg / 0.07)


def body_hi(sp, spine, name):
    segs, radial = 240, 144
    L = spine.length
    verts, mask, faces = [], [], []
    for i in range(segs + 1):
        u = i / segs
        P, T, up, rx, ry = frame(sp, spine, u)
        for j in range(radial):
            th = j / radial * TAU - math.pi / 2
            sn, cs = math.sin(th), math.cos(th)
            p = P + SIDE * (cs * rx) + up * (sn * ry * (1.06 if sn < 0 else 1))
            n = (SIDE * (cs / rx) + up * (sn / ry)).normalized()
            verts.append(tuple(p + n * body_disp(sp, u * L, th, rx, ry, L, p)))
            bw = smooth(0.3, 0.8, -sn)
            mask.append((0, bw, 0, smooth(-0.25, 0.25, sn) * (1 - bw)))
    for i in range(segs):
        for j in range(radial):
            j2 = (j + 1) % radial
            faces.append([i * radial + j, i * radial + j2, (i + 1) * radial + j2, (i + 1) * radial + j])
    for row, u in ((0, 0.0), (segs, 1.0)):
        c = len(verts)
        verts.append(tuple(spine.at(u) - spine.tangent(u) * (0.012 if u == 0 else 0)))
        mask.append((0, 0, 0, 0))
        for j in range(radial):
            faces.append([row * radial + j, row * radial + (j + 1) % radial, c])
    o = C.mesh_obj(name, verts, faces)
    a = o.data.color_attributes.new('mask', 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set('color', np.asarray(mask, dtype=np.float32).ravel())
    return o


def body_lo(sp, spine, name):
    """Game mesh for the shell: two UV islands (right/left half, split along the
    dorsal and belly seams where the high-poly has grooves), smooth skin weights."""
    segs, radial = 60, 30
    L = spine.length
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rows, ts, ravg = [], [], []
    for i in range(segs + 1):
        u = i / segs
        P, T, up, rx, ry = frame(sp, spine, u)
        ravg.append(math.sqrt((rx * rx + ry * ry) / 2))
        row = []
        for j in range(radial):
            th = j / radial * TAU - math.pi / 2
            sn, cs = math.sin(th), math.cos(th)
            n = (SIDE * (cs / rx) + up * (sn / ry)).normalized()
            p = P + SIDE * (cs * rx) + up * (sn * ry * (1.06 if sn < 0 else 1)) + n * 0.006 * min(1, ravg[-1] / 0.07)
            row.append(bm.verts.new(C.G(*p)))
            ts.append(u)
        rows.append(row)
    tip = bm.verts.new(C.G(*(spine.at(0) - spine.tangent(0) * 0.012))); ts.append(0.0)
    top = bm.verts.new(C.G(*spine.at(1))); ts.append(1.0)
    bm.verts.index_update()

    def uv_of(i, j, island):
        th = j / radial * TAU - math.pi / 2
        th0 = -math.pi / 2 if island == 0 else math.pi / 2
        if island == 1 and th < th0 - 1e-6:
            th += TAU
        s = i / segs * L
        return (s + (0 if island == 0 else L + 0.3), (th - th0) * ravg[i])

    for i in range(segs):
        for j in range(radial):
            j2 = (j + 1) % radial
            thc = (j + 0.5) / radial * TAU - math.pi / 2
            isl = 0 if thc < math.pi / 2 else 1
            idx = [(i, j), (i, j2), (i + 1, j2), (i + 1, j)]
            f = bm.faces.new([rows[a][b] for a, b in idx])
            for loop, (a, b) in zip(f.loops, idx):
                loop[uvl].uv = uv_of(a, b, isl)
    for row, cv, flip in ((0, tip, True), (segs, top, False)):
        for j in range(radial):
            j2 = (j + 1) % radial
            thc = (j + 0.5) / radial * TAU - math.pi / 2
            isl = 0 if thc < math.pi / 2 else 1
            vs = [rows[row][j], rows[row][j2], cv]
            f = bm.faces.new(vs[::-1] if flip else vs)
            ids = [(row, j), (row, j2), None]
            for loop in f.loops:
                if loop.vert is cv:
                    a0 = uv_of(row, j, isl); a1 = uv_of(row, j2, isl)
                    loop[uvl].uv = ((a0[0] + a1[0]) / 2 + (-0.02 if flip else 0.02), (a0[1] + a1[1]) / 2)
                else:
                    jj = j if loop.vert is rows[row][j] else j2
                    loop[uvl].uv = uv_of(row, jj, isl)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    o = C.link(bpy.data.objects.new(name, me))
    # skin: blend between the two spine bones around each ring
    bones = sp['bones']
    groups = [o.vertex_groups.new(name=f'spine_{k}') for k in range(len(bones))]
    for vi, t in enumerate(ts):
        k = 0
        while k < len(bones) - 2 and t > bones[k + 1]:
            k += 1
        w = max(0.0, min(1.0, (t - bones[k]) / (bones[k + 1] - bones[k])))
        if 1 - w > 1e-4:
            groups[k].add([vi], 1 - w, 'REPLACE')
        if w > 1e-4:
            groups[k + 1].add([vi], w, 'REPLACE')
    return o


# ------------------------------------------------------------------ head
def head_elements(H, jaw):
    L, W, Hh, tp, dr = H['len'], H['w'], H['h'], H['taper'], H['drop']
    bill = H.get('bill', 0)
    E = [
        dict(co=(0, 0.04 * Hh, -0.12 * L), size=(W * 0.53, Hh * 0.6, L * 0.35)),                        # cranium
        dict(co=(0, -dr * 0.6, 0.15 * L), size=(W * 0.48 * (1 - tp * 0.35), Hh * 0.52 * (1 - tp * 0.3), L * 0.35)),  # snout
        dict(co=(0, -dr, 0.35 * L), size=(W * 0.45 * (1 - tp * 0.55), Hh * 0.44 * (1 - tp * 0.4), L * 0.17)),       # snout tip
    ]
    for s in (-1, 1):
        E += [
            dict(co=(s * W * 0.27, -Hh * 0.06, -0.06 * L), size=(W * 0.23, Hh * 0.32, L * 0.22)),        # cheeks
            dict(co=(s * W * 0.12 * (1 - tp * 0.4), Hh * 0.1 * (1 - tp * 0.4) - dr, 0.44 * L), size=(0.035, 0.03, 0.04), stiffness=3),
        ]
    if bill:
        E.append(dict(co=(0, -dr - Hh * 0.08, 0.4 * L), size=(W * 0.4, Hh * 0.13, L * 0.17)))
    if jaw:
        # hollow out a palate so the lower jaw can nest under it
        E.append(dict(co=(0, -Hh * 0.42, 0.18 * L), size=(W * 0.34, Hh * 0.2, L * 0.36), neg=True, stiffness=3))
    return E


def jaw_elements(H):
    L, W, Hh, tp = H['len'], H['w'], H['h'], H['taper']
    return [
        dict(co=(0, -Hh * 0.3, 0.1 * L), size=(W * 0.42 * (1 - tp * 0.25), Hh * 0.13, L * 0.36)),
        dict(co=(0, -Hh * 0.29, 0.34 * L), size=(W * 0.36 * (1 - tp * 0.55), Hh * 0.1, L * 0.14)),
        dict(co=(0, -Hh * 0.2, -0.12 * L), size=(W * 0.36, Hh * 0.15, L * 0.2)),
    ]


def head_seam(H, center):
    """Dorsal seam down the middle of the head plus a little fabric puckering."""
    def fn(p, n):
        q = Vector(p) - Vector(center)
        top = smooth(0.0, H['h'] * 0.25, q.y)
        g = -0.007 * math.exp(-(q.x / 0.007) ** 2) * top
        pucker = -0.002 * (1 - abs(noise.noise(Vector(p) * 18))) ** 6
        return g + pucker + 0.002 * noise.noise(Vector(p) * 4)
    return fn


def build_head(sp, name, hp, parts):
    """Head, jaw, eyes, lids, mouth, teeth and species head gear. hp: head joint (game)."""
    H = sp['head']
    has_jaw = sp.get('jaw', False)
    L, W, Hh = H['len'], H['w'], H['h']
    off = lambda E: [dict(e, co=tuple(Vector(e['co']) + hp)) for e in E]
    head = C.metaball('head_hi', off(head_elements(H, has_jaw)), resolution=0.009)
    C.displace(head, head_seam(H, hp))
    fab(head, pattern=0.6)
    C.set_attr_fn(head, 'mask', lambda p: (0, smooth(0.0, -0.3, (p[1] - hp.y) / Hh), 0, 0.7 * smooth(-0.05, 0.25, (p[1] - hp.y) / Hh)))
    parts.append(Part('head', 'fabric', head, 'head', tris=2600, uvw=1.8))

    if has_jaw:
        jp = hp + Vector((0, -Hh * 0.16, -L * 0.05))
        jaw = C.metaball('jaw_hi', off(jaw_elements(H)), resolution=0.008)
        C.set_attr_fn(jaw, 'mask', lambda p: (0, smooth(-0.22, -0.34, (p[1] - hp.y) / Hh), 0, 0))
        parts.append(Part('jaw', 'fabric', jaw, 'jaw', tris=900, uvw=1.4))
        mouth = C.uv_sphere('mouth_hi', 1, 48, 24, pos=tuple(hp + Vector((0, -Hh * 0.27, L * 0.15))), scale=(W * 0.3, Hh * 0.1, L * 0.3))
        trim(mouth, '#4a1018', 0.7)
        parts.append(Part('mouth', 'trim', mouth, 'head', tris=300))
        tongue = C.uv_sphere('tongue_hi', 1, 40, 20, pos=tuple(hp + Vector((0, -Hh * 0.33, L * 0.16))), scale=(W * 0.2, Hh * 0.05, L * 0.24))
        C.displace(tongue, lambda p, n: -0.004 * math.exp(-((p[0]) / 0.008) ** 2))
        trim(tongue, '#e0576a', 0.45)
        parts.append(Part('tongue', 'trim', tongue, 'jaw', tris=200))
        if sp.get('teeth'):
            nu, nl, su, sl = sp['teeth']
            build_teeth(parts, hp, H, nu, su, head, 'head', down=True)
            build_teeth(parts, hp, H, nl, sl, jaw, 'jaw', down=False)
        for s in (-1, 1):  # nostrils
            n = C.uv_sphere(f'nostril{s}_hi', 1, 16, 10, pos=tuple(hp + Vector((s * W * 0.1, Hh * 0.06 - H['drop'], L * 0.47))), scale=(0.022, 0.014, 0.018))
            fab(n, dark=1)
            parts.append(Part(f'nostril{s}', 'fabric', n, 'head', tris=40, uvw=0.3))

    # eyes: sit each glossy eye in the cheek, facing forward-out like the game's
    eye_r = min(0.11, W * 0.2)
    for idx, s in enumerate((-1, 1)):
        # high on the head and forward enough to read from the chase camera and the front
        d = Vector((s * 0.7, 0.56, 0.44)).normalized()
        hit, nrm = raycast(head, tuple(hp + d * 1.5), tuple(-d))
        if hit is None:
            hit, nrm = hp + d * W * 0.4, d
        c = hit - nrm * eye_r * 0.42
        look = Vector((s * 0.55, 0.1, 0.85)).normalized()
        build_eye(parts, f'eye_{idx}', c, eye_r, look, sp['eyes'])
        build_lid(parts, idx, c, eye_r, look)
        # brow: a soft fabric roll over each eye gives the face its expression
        brow = C.taper_tube(f'brow{idx}_hi', [(-0.07, 0, 0), (0, 0.016, 0.01), (0.07, 0, 0)], eye_r * 0.42, eye_r * 0.3, 16, 16, flat=0.6)
        place(brow, Matrix.Translation(c + Vector((0, eye_r * 1.02, 0))) @ Matrix.Rotation(-s * 0.35, 4, 'Z') @ Matrix.Rotation(-s * 0.5, 4, 'Y'))
        fab(brow)
        parts.append(Part(f'brow{idx}', 'fabric', brow, 'head', tris=160, uvw=0.6))
    head_gear(sp, name, hp, parts)


def build_teeth(parts, hp, H, n, size, surf, bone, down):
    """Soft felt teeth along the lip line. Upper teeth hang from the underside of
    the head so they show with the mouth shut; lower ones stand on the jaw."""
    L, W, Hh = H['len'], H['w'], H['h']
    objs = []
    for i in range(n):
        f = i / max(1, n - 1)
        z = (0 if down else L * 0.08) + (L * 0.4 - (0 if down else L * 0.08)) * f + L * 0.02
        s = size * (1 - abs(f - 0.4) * 0.5)
        for sx in (-1, 1):
            x = sx * W * (0.3 if down else 0.27) * (1 - f * 0.35)
            if down:
                hit, _ = raycast(surf, (hp.x + x, hp.y - Hh * 2, hp.z + z), (0, 1, 0))
                y = (hit.y - hp.y + s * 0.25) if hit is not None else -Hh * 0.25
            else:
                hit, _ = raycast(surf, (hp.x + x, hp.y - Hh * 0.05, hp.z + z), (0, -1, 0))
                y = (hit.y - hp.y - s * 0.25) if hit is not None else -Hh * 0.19
            t = C.lathe('tooth_hi', [(0.0001, 0), (0.42, 0.0), (0.4, 0.25), (0.28, 0.6), (0.12, 0.88), (0.0001, 1.0)], 20)
            C.transform(t, pos=tuple(hp + Vector((x, y, z))), rot=(math.pi if down else 0, 0, 0), scale=(s, s, s * 0.8))
            objs.append(t)
    o = C.join(objs, f'teeth_{bone}_hi')
    trim(o, IVORY, 0.75)
    parts.append(Part(f'teeth_{bone}', 'trim', o, bone, tris=24 * len(objs)))


def build_eye(parts, name, c, r, look, iris_hex):
    o = C.uv_sphere(name + '_hi', 1, 64, 48, pos=tuple(c), scale=r)
    iris = C.hex_lin(iris_hex)[:3]
    upv = Vector((0, 1, 0))
    side = look.cross(upv).normalized()
    hl = (look + upv * 0.42 - side * 0.25).normalized()
    hl2 = (look - upv * 0.3 + side * 0.28).normalized()

    def fn(p):
        d = (Vector(p) - c).normalized()
        a = d.angle(look)
        if d.angle(hl) < 0.14 or d.angle(hl2) < 0.06:
            return ((1, 1, 1), 0.05, 0, 0)
        if a < 0.3:
            return ((0.005, 0.005, 0.008), 0.06, 0, 0)
        if a < 0.68:
            k = smooth(0.4, 0.68, a)
            rim = [x * (1 - 0.55 * k) for x in iris]
            fleck = 0.85 + 0.3 * abs(noise.noise(d * 30))
            return (tuple(min(1, x * fleck) for x in rim), 0.08, 0, 0)
        return ('#f7f8fc', 0.12, 0, 0)
    trim_fn(o, fn)
    parts.append(Part(name, 'trim', o, 'head', tris=420, uvw=5.0))


def build_lid(parts, idx, c, r, look):
    """Fabric eyelid shell, modelled open; the game rotates lid_<idx> about X to blink."""
    o = C.uv_sphere(f'lid{idx}_hi', 1, 48, 20, phi=(0, math.pi / 2))
    C.mod(o, 'SOLIDIFY', thickness=0.08, offset=1)
    C.apply_modifiers(o)
    m = frame_matrix(c, look) @ Matrix.Rotation(LID_OPEN, 4, 'X') @ Matrix.Diagonal((r * 1.12, r * 1.12, r * 1.12, 1))
    place(o, m)
    fab(o)
    parts.append(Part(f'lid_{idx}', 'fabric', o, f'lid_{idx}', tris=260, uvw=0.8))


def head_gear(sp, name, hp, parts):
    H = sp['head']
    L, W, Hh, dr = H['len'], H['w'], H['h'], H['drop']
    at = lambda x, y, z: hp + Vector((x, y, z))

    def horn(nm, pts, r0, r1, pos, color=IVORY, flat=1.0, kind='trim'):
        o = C.taper_tube(nm + '_hi', pts, r0, r1, 20, 28, flat)
        C.transform(o, pos=tuple(pos))
        # felt horn: a couple of soft rings where it is sewn
        if kind == 'trim':
            trim(o, color, 0.7)
        return o

    if name == 'raptor':
        objs = []
        for i in range(7):
            o = C.taper_tube('crestf_hi', [(0, 0, 0), (0, 0.1, -0.1), (0, 0.18, -0.28)], 0.032, 0.003, 12, 16, 0.35)
            C.transform(o, pos=tuple(at((i - 3) * 0.03, Hh * 0.32, -L * 0.18 - abs(i - 3) * 0.02)), rot=(0, 0, (i - 3) * 0.12), scale=1 - abs(i - 3) * 0.08)
            objs.append(o)
        o = C.join(objs, 'crest_hi'); fab(o, accent=1)
        parts.append(Part('crest', 'fabric', o, 'head', tris=500))
    elif name == 'trike':
        beak = horn('beak', [(0, 0, 0), (0, -0.06, 0.1), (0, -0.14, 0.16)], 0.1, 0.012, at(0, -Hh * 0.08, L * 0.4), '#5a4a3a')
        parts.append(Part('beak', 'trim', beak, 'head', tris=300))
        # frill: a stuffed, scalloped fan with piping round the edge
        R = 0.47
        pts2 = []
        for i in range(97):
            a = math.pi - i / 96 * math.pi
            bump = 1 + 0.06 * math.cos(a * 12.0)
            pts2.append((math.cos(a) * R * bump, math.sin(a) * R * bump))
        frill = cushion('frill_hi', pts2, 0.035)
        m = Matrix.Translation(at(0, Hh * 0.2, -L * 0.3)) @ Matrix.Rotation(-0.3, 4, 'X')
        place(frill, m)
        fab(frill, accent=1)
        parts.append(Part('frill', 'fabric', frill, 'head', tris=1400, uvw=1.3))
        pipe = C.taper_tube('frillpipe_hi', [(x, y, 0.0) for x, y in pts2[::3]], 0.018, 0.018, 10, 160, cap=False)
        place(pipe, m)
        fab(pipe, dark=1)
        parts.append(Part('frillpipe', 'fabric', pipe, 'head', tris=500, uvw=0.5))
        objs = []
        for i in range(9):
            a = math.pi - (i + 0.5) / 9 * math.pi
            local = Vector((math.cos(a) * R * 1.03, math.sin(a) * R * 1.03, 0.0))
            o = C.taper_tube('fspike_hi', [(0, 0, 0), (0, 0.04, 0), (0, 0.085, 0)], 0.034, 0.004, 12, 10)
            place(o, m @ Matrix.Translation(local) @ Matrix.Rotation(math.atan2(local.y, local.x) - math.pi / 2, 4, 'Z'))
            objs.append(o)
        o = C.join(objs, 'fspikes_hi'); trim(o, IVORY, 0.7)
        parts.append(Part('fspikes', 'trim', o, 'head', tris=400))
        horns = [horn(f'horn{s}', [(0, 0, 0), (s * 0.05, 0.18, 0.1), (s * 0.08, 0.3, 0.32)], 0.068, 0.006, at(s * W * 0.26, Hh * 0.3, L * 0.02)) for s in (-1, 1)]
        horns.append(horn('nosehorn', [(0, 0, 0), (0, 0.1, 0.03), (0, 0.18, 0.1)], 0.052, 0.005, at(0, Hh * 0.1, L * 0.34)))
        o = C.join(horns, 'horns_hi'); trim(o, IVORY, 0.7)
        parts.append(Part('horns', 'trim', o, 'head', tris=700))
    elif name == 'stego':
        beak = horn('beak', [(0, 0, 0), (0, -0.04, 0.06)], 0.07, 0.03, at(0, -Hh * 0.1, L * 0.42), '#5a4a3a')
        parts.append(Part('beak', 'trim', beak, 'head', tris=200))
    elif name == 'ptera':
        beak = horn('beak', [(0, 0, 0), (0, -0.02, 0.35), (0, -0.06, 0.7)], 0.075, 0.004, at(0, -Hh * 0.08, L * 0.3), '#f0b93a', flat=0.7)
        parts.append(Part('beak', 'trim', beak, 'head', tris=500))
        crest = C.taper_tube('crest_hi', [(0, 0, 0), (0, 0.12, -0.25), (0, 0.26, -0.62)], 0.1, 0.006, 20, 28, 0.3)
        C.transform(crest, pos=tuple(at(0, Hh * 0.2, -L * 0.1)))
        fab(crest, accent=1)
        parts.append(Part('crest', 'fabric', crest, 'head', tris=500))
    elif name == 'ankylo':
        objs = []
        for x, z in ((1, -1), (-1, -1), (1, 0.4), (-1, 0.4)):
            d = Vector((x, 0.35, z * 0.5)).normalized()
            o = C.taper_tube('ahorn_hi', [(0, 0, 0), tuple(d * 0.07), tuple(d * 0.14)], 0.05, 0.005, 14, 10)
            C.transform(o, pos=tuple(at(x * W * 0.42, Hh * 0.1, z * L * 0.18)))
            objs.append(o)
        o = C.join(objs, 'ahorns_hi'); trim(o, IVORY, 0.7)
        parts.append(Part('horns', 'trim', o, 'head', tris=400))
        beak = horn('beak', [(0, 0, 0), (0, -0.03, 0.06)], 0.1, 0.05, at(0, -Hh * 0.12, L * 0.42), '#5a4a3a', flat=0.5)
        parts.append(Part('beak', 'trim', beak, 'head', tris=200))
        objs = [C.uv_sphere('knob_hi', 1, 20, 12, pos=tuple(at((i - 2) * 0.08, Hh * 0.44, 0)), scale=(0.045, 0.025, 0.06)) for i in range(5)]
        o = C.join(objs, 'hknobs_hi'); fab(o, dark=1)
        parts.append(Part('hknobs', 'fabric', o, 'head', tris=300))
    elif name == 'parasaur':
        crest = C.taper_tube('crest_hi', [(0, 0, 0), (0, 0.12, -0.18), (0, 0.17, -0.5), (0, 0.12, -0.88)], 0.08, 0.05, 24, 48, 0.75, cap=False)
        C.transform(crest, pos=tuple(at(0, Hh * 0.3, L * 0.12)))
        C.displace(crest, lambda p, n: -0.005 * math.exp(-(p[0] / 0.006) ** 2) * smooth(0, 0.02, p[1] - hp.y - Hh * 0.3))
        tip = C.uv_sphere('cresttip_hi', 1, 32, 16, pos=tuple(at(0, Hh * 0.3 + 0.12, L * 0.12 - 0.88)), scale=(0.06, 0.066, 0.07))
        o = C.join([crest, tip], 'crest_hi'); fab(o, accent=1)
        parts.append(Part('crest', 'fabric', o, 'head', tris=900, uvw=1.2))
    elif name == 'pachy':
        # the thick domed skull cap is the whole character: big, high and proud
        dome = C.metaball('dome_hi', [dict(co=tuple(at(0, Hh * 0.5, -L * 0.1)), size=(W * 0.52, Hh * 0.46, L * 0.4))], resolution=0.008)
        C.displace(dome, lambda p, n: -0.004 * math.exp(-(p[0] / 0.006) ** 2) + 0.002 * noise.noise(Vector(p) * 12))
        trim(dome, '#e6d6b4', 0.55)
        parts.append(Part('dome', 'trim', dome, 'head', tris=1400, uvw=1.5))
        objs = []
        for i in range(9):
            a = math.pi * (0.15 + i / 8 * 0.7)
            objs.append(C.uv_sphere('pk_hi', 1, 16, 10, pos=tuple(at(math.cos(a) * W * 0.5, Hh * 0.3, -L * 0.1 - math.sin(a) * L * 0.38)), scale=0.036))
        for i in range(3):
            objs.append(C.uv_sphere('pk_hi', 1, 16, 10, pos=tuple(at((i - 1) * 0.05, Hh * 0.12, L * 0.4)), scale=0.028))
        o = C.join(objs, 'pknobs_hi'); fab(o, dark=1)
        parts.append(Part('pknobs', 'fabric', o, 'head', tris=500))


def cushion(name, outline, thick, segs_in=10):
    """A stuffed flat shape (frill, plate): the outline puffed into a pillow of
    half-thickness `thick` in local Z, with a sewn welt round the edge."""
    # close the outline: fill a long gap between the last and first point
    pts = [Vector((x, y)) for x, y in outline]
    step = sum((pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)) / (len(pts) - 1)
    gap = (pts[0] - pts[-1]).length
    k = int(gap / step)
    pts += [pts[-1].lerp(pts[0], j / (k + 1)) for j in range(1, k + 1)]
    n = len(pts)
    cx = sum(p.x for p in pts) / n
    cy = sum(p.y for p in pts) / n
    rings = segs_in
    verts = [(p.x, p.y, 0.0) for p in pts]  # shared seam ring
    faces = []
    for side in (1, -1):
        prev = list(range(n))
        for r in range(1, rings):
            f = r / rings  # 0 = edge, 1 = centre
            puff = thick * math.sqrt(max(0.0, 1 - (1 - f) ** 2))
            cur = []
            for p in pts:
                cur.append(len(verts))
                verts.append((p.x + (cx - p.x) * f, p.y + (cy - p.y) * f, side * puff))
            for i in range(n):
                q = [prev[i], prev[(i + 1) % n], cur[(i + 1) % n], cur[i]]
                faces.append(q if side > 0 else q[::-1])
            prev = cur
        c = len(verts)
        verts.append((cx, cy, side * thick))
        for i in range(n):
            t = [prev[i], prev[(i + 1) % n], c]
            faces.append(t if side > 0 else t[::-1])
    o = C.mesh_obj(name, verts, faces)
    return C.subdivide(o, 1)


# ------------------------------------------------------------------ limbs
def shoulder(sp, spine, side, body_lo):
    """Where an arm joins the shell. Arms sit on the upper chest, just either side
    of the race bib and a hand below the face window, found by casting at the
    front of the body. Wings keep the curve-based spot high on the sides."""
    u = sp['armT']
    if sp['arms'] != 'wings':
        win, _ = raycast(body_lo, (0.003, 1.6, -0.2), (0, 0, 1))
        drop = 0.26 if sp['arms'] in ('tiny', 'small', 'feathered') else 0.42
        y = (win.y if win is not None else 1.5) - drop
        hit, nrm = raycast(body_lo, (side * 0.26, y, 3.0), (0, 0, -1))
        if hit is not None:
            # parent to the spine bone closest in height (the one that carries the chest)
            k = min(range(len(sp['bones'])), key=lambda i: (spine.at(sp['bones'][i]) - hit).length)
            return hit - nrm * 0.02, k
    p, n, up = surface(sp, spine, u, -0.62 if side > 0 else math.pi + 0.62, 0.95)
    return p, nearest_bone(sp, u)


def blob_chain(name, pts, radii, res=0.006, stiffness=2.0):
    """A soft stuffed limb: metaballs strung along a polyline, radii interpolated."""
    E = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        n = max(2, int((b - a).length / (min(radii[i], radii[i + 1]) * 0.45)))
        for k in range(n):
            f = k / n
            E.append(dict(type='BALL', co=tuple(a.lerp(b, f)), r=radii[i] + (radii[i + 1] - radii[i]) * f, stiffness=stiffness))
    E.append(dict(type='BALL', co=tuple(pts[-1]), r=radii[-1], stiffness=stiffness))
    return C.metaball(name, E, resolution=res)


def build_arm(sp, spine, name, parts, idx, side, bones, body_lo):
    kind = sp['arms']
    p, k = shoulder(sp, spine, side, body_lo)
    bone = f'arm_{idx}'
    bones[bone] = (p, f'spine_{k}')
    at = lambda x, y, z: p + Vector((x, y, z))
    if kind == 'wings':
        wb = f'wing_{idx}'
        bones[wb] = (p, bone)
        spar = C.taper_tube('spar_hi', [(0, 0, 0), (side * 0.35, 0.08, 0.02), (side * 0.9, 0.12, -0.05)], 0.05, 0.016, 16, 32)
        C.transform(spar, pos=tuple(p)); fab(spar)
        parts.append(Part(f'spar_{idx}', 'fabric', spar, wb, tris=400))
        # membrane: thin, slightly billowing sheet between the finger struts
        outline = [(0, 0.02), (0.9, 0.1)]
        for (x0, y0, x1, y1, cx, cy) in ((0.9, 0.1, 0.64, -0.3, 0.72, -0.12), (0.64, -0.3, 0.32, -0.55, 0.44, -0.24), (0.32, -0.55, 0.0, -0.7, 0.14, -0.46)):
            for i in range(1, 17):
                t = i / 16
                outline.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1))
        mem = membrane('wing_hi', outline, side)
        C.transform(mem, pos=tuple(at(0, 0, -0.02)))
        fab(mem, accent=1)
        parts.append(Part(f'membrane_{idx}', 'membrane', mem, wb, tris=500, uvw=1.2))
        objs = []
        for (x, y) in ((0.64, -0.3), (0.32, -0.55)):
            s = C.taper_tube('strut_hi', [(0, 0, 0), (side * x * 0.5, y * 0.5 + 0.05, 0), (side * x, y, 0)], 0.014, 0.005, 10, 16)
            C.transform(s, pos=tuple(at(0, 0.03, -0.015)))
            objs.append(s)
        o = C.join(objs, 'struts_hi'); fab(o, dark=1)
        parts.append(Part(f'struts_{idx}', 'fabric', o, wb, tris=200))
        objs = []
        for i in range(3):
            c = C.taper_tube('wclaw_hi', [(0, 0, 0), (0, 0.035, 0.015), (0, 0.06, 0.04)], 0.014, 0.002, 10, 10)
            C.transform(c, pos=tuple(at(side * (0.9 - i * 0.04), 0.12, 0.02 + i * 0.025)), rot=(0.5, 0, -side * 0.6))
            objs.append(c)
        o = C.join(objs, 'wclaws_hi'); trim(o, IVORY, 0.7)
        parts.append(Part(f'wclaws_{idx}', 'trim', o, wb, tris=150))
        return
    if kind == 'stubby':
        # quadruped front leg: hangs from the chest with a round padded foot
        pts = [at(0, 0.02, -0.03), at(side * 0.03, -0.14, 0.04), at(side * 0.02, -0.28, 0.08)]
        arm = blob_chain('arm_hi', pts, [0.1, 0.095, 0.085], res=0.008)
        foot = C.metaball('forefoot_hi', [dict(co=tuple(at(side * 0.02, -0.32, 0.1)), size=(0.095, 0.06, 0.1))], resolution=0.008)
        arm = C.join([arm, foot], 'arm_hi')
        C.displace(arm, lambda q, nn: -0.004 * math.exp(-(((q[1] - p.y) + 0.26) / 0.006) ** 2))  # sewn cuff line
        fab(arm)
        parts.append(Part(f'arm_{idx}', 'fabric', arm, bone, tris=600))
        objs = [C.uv_sphere('toe_hi', 1, 20, 12, pos=tuple(at(side * 0.02 + i * 0.05, -0.35, 0.18)), scale=(0.03, 0.024, 0.04)) for i in (-1, 0, 1)]
        o = C.join(objs, 'toes_hi'); trim(o, IVORY, 0.7)
        parts.append(Part(f'toes_{idx}', 'trim', o, bone, tris=150))
        return
    # biped arms reach forward off the chest: upper arm down-forward, forearm
    # forward, a mitten hand with felt claws curling down
    big = kind != 'tiny'
    ln = 0.24 if big else 0.19
    r0 = 0.068 if big else 0.06
    elbow = at(side * 0.05, -ln * 0.42, ln * 0.45)
    wrist = at(side * 0.04, -ln * 0.52, ln * 0.95)
    arm = blob_chain('arm_hi', [at(0, 0, -0.02), elbow, wrist], [r0, r0 * 0.82, r0 * 0.7])
    hand = C.metaball('hand_hi', [dict(co=tuple(wrist + Vector((0, -0.012, 0.035))), size=(r0 * 0.85, r0 * 0.6, r0 * 0.75))], resolution=0.005)
    arm = C.join([arm, hand], 'arm_hi')
    fab(arm)
    parts.append(Part(f'arm_{idx}', 'fabric', arm, bone, tris=600))
    claws = 3 if big else 2
    objs = []
    for i in range(claws):
        c = C.taper_tube('claw_hi', [(0, 0, 0), (0, -0.01, 0.035), (0, -0.045, 0.06)], 0.017, 0.002, 12, 12)
        C.transform(c, pos=tuple(wrist + Vector(((i - (claws - 1) / 2) * 0.032, -0.02, 0.07))))
        objs.append(c)
    o = C.join(objs, 'claws_hi'); trim(o, IVORY, 0.7)
    parts.append(Part(f'claws_{idx}', 'trim', o, bone, tris=160))
    if kind == 'feathered':
        objs = []
        for i in range(5):
            f = C.taper_tube('afeather_hi', [(0, 0, 0), (side * 0.03, -0.05, -0.06), (side * 0.05, -0.14, -0.1)], 0.026, 0.002, 12, 14, 0.3)
            C.transform(f, pos=tuple(elbow.lerp(wrist, i / 5) + Vector((side * 0.03, -0.02, 0))))
            objs.append(f)
        o = C.join(objs, 'afeathers_hi'); fab(o, accent=1)
        parts.append(Part(f'afeathers_{idx}', 'fabric', o, bone, tris=300))


def membrane(name, outline, side, n=24):
    """Triangulated sheet inside a 2D outline (local XY, mirrored by side), with a
    gentle billow and a hem; given a little thickness so it has two sides."""
    bm = bmesh.new()
    vs = [bm.verts.new((side * x, y, 0)) for x, y in outline]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    for _ in range(3):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    # game-space verts: build in game XY then convert
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    for v in co:
        x, y = v[0], v[1]
        v[2] = 0.035 * math.sin(min(1, abs(x) / 0.9) * math.pi) * math.sin(min(1, -y / 0.7 + 0.05) * math.pi) - 0.01 * noise.noise(Vector((x * 6, y * 6, 0)))
    g = C.to_blender(co)
    me.vertices.foreach_set('co', g.astype(np.float32).ravel())
    me.update()
    o = C.link(bpy.data.objects.new(name, me))
    C.mod(o, 'SOLIDIFY', thickness=0.008, offset=0)
    C.apply_modifiers(o)
    o.data.shade_smooth()
    return o


def build_leg(parts, idx, side, bones):
    hip = Vector((side * 0.2, HIP, 0.02))
    knee = hip + Vector((0, -0.44, 0))
    ankle = knee + Vector((0, -0.43, 0))
    bones[f'hip_{idx}'] = (hip, 'pivot')
    bones[f'knee_{idx}'] = (knee, f'hip_{idx}')
    bones[f'ankle_{idx}'] = (ankle, f'knee_{idx}')

    def dense(prof, n=48):
        out = []
        for i in range(len(prof) - 1):
            (r0, y0), (r1, y1) = prof[i], prof[i + 1]
            for k in range(n // (len(prof) - 1)):
                f = k / (n // (len(prof) - 1))
                f = f * f * (3 - 2 * f) if 0 < i < len(prof) - 2 else f
                out.append((r0 + (r1 - r0) * f, y0 + (y1 - y0) * f))
        out.append(prof[-1])
        return out

    thigh = C.lathe('thigh_hi', dense([(0.001, -0.46), (0.15, -0.44), (0.19, -0.2), (0.2, 0), (0.17, 0.12), (0.001, 0.14)], 60), 96)
    C.transform(thigh, pos=tuple(hip))

    def thigh_fn(p, n):
        y = p[1] - hip.y
        a = math.atan2(p[0] - hip.x, p[2] - hip.z)
        bunch = smooth(-0.2, -0.4, y) * 0.006 * math.sin(y * 70 + 2.2 * noise.noise(Vector(p) * 7) + a * 0.8)
        pull = -0.004 * (1 - abs(noise.noise(Vector((a * 2.5, y * 4, side * 3.0))))) ** 10
        return bunch + pull + 0.003 * noise.noise(Vector(p) * 5)
    C.displace(thigh, thigh_fn)
    fab(thigh, pattern=0.5)
    parts.append(Part(f'thigh_{idx}', 'fabric', thigh, f'hip_{idx}', tris=700))

    shin = C.lathe('shin_hi', dense([(0.001, -0.41), (0.1, -0.4), (0.115, -0.36), (0.14, -0.16), (0.15, 0.03), (0.001, 0.04)], 60), 96)
    C.transform(shin, pos=tuple(knee))

    def shin_fn(p, n):
        y = p[1] - knee.y
        a = math.atan2(p[0] - knee.x, p[2] - knee.z)
        gather = smooth(-0.2, -0.37, y) * (1 - smooth(-0.37, -0.4, y))
        ruffle = 0.014 * gather * (0.5 + 0.5 * math.sin(a * 11 + 1.5 * noise.noise(Vector(p) * 6)))
        return ruffle + 0.003 * noise.noise(Vector(p) * 5)
    C.displace(shin, shin_fn)
    fab(shin, pattern=0.5)
    parts.append(Part(f'shin_{idx}', 'fabric', shin, f'knee_{idx}', tris=700))

    cuff = C.torus('cuff_hi', 0.1, 0.026, 96, 16, pos=tuple(knee + Vector((0, -0.39, 0))), rot=(math.pi / 2, 0, 0))
    C.displace(cuff, lambda p, n: 0.0025 * math.sin(math.atan2(p[0] - knee.x, p[2] - knee.z) * 48))
    fab(cuff, dark=1)
    parts.append(Part(f'cuff_{idx}', 'fabric', cuff, f'knee_{idx}', tris=300, uvw=0.6))
    build_shoe(parts, idx, ankle)


def build_shoe(parts, idx, ankle):
    """Running shoe: stitched upper (tinted to the runner's colour), foam midsole,
    treaded rubber outsole, laces, heel tab and side stripes."""
    at = lambda x, y, z: ankle + Vector((x, y, z))
    bone = f'ankle_{idx}'

    def width(z):  # half-width of the footprint along the foot (z: -0.09 heel .. 0.21 toe)
        f = (z + 0.09) / 0.3
        w = 0.058 + 0.02 * math.sin(min(1, f / 0.7) * math.pi * 0.62)
        return w * math.sqrt(max(0.0, 1 - ((f - 0.5) / 0.5) ** 8))

    def slab(nm, y0, y1, grow=0.0):
        outline = []
        for i in range(64):
            f = i / 63
            z = -0.09 + 0.3 * f
            outline.append((width(z) + grow, z))
        pts = [(x, z) for x, z in outline] + [(-x, z) for x, z in outline[::-1]]
        bm = bmesh.new()
        vb = [bm.verts.new(C.G(x, y0, z)) for x, z in pts]
        f = bm.faces.new(vb)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
        for v in top:
            v.co.z += y1 - y0
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.6], offset=min(0.008, (y1 - y0) * 0.45), segments=3, affect='EDGES')
        me = bpy.data.meshes.new(nm); bm.to_mesh(me); bm.free()
        me.shade_smooth()
        o = C.link(bpy.data.objects.new(nm, me))
        o.data.transform(Matrix.Translation(C.G(*at(0, 0, 0))))
        return o

    out = slab('outsole_hi', -0.101, -0.088)
    C.subdivide(out, 2)
    C.displace(out, lambda p, n: -0.003 * (math.sin((p[2] - ankle.z) * 180) > 0.3) * (n[1] < -0.7))
    trim(out, '#2a2a2e', 0.9)
    mid = slab('midsole_hi', -0.089, -0.06, 0.004)
    C.subdivide(mid, 2)
    C.displace(mid, lambda p, n: -0.0022 * math.exp(-(((p[1] - ankle.y) + 0.074) / 0.0025) ** 2) * (abs(n[1]) < 0.5))
    trim(mid, '#f4f2ec', 0.7)
    E = [dict(co=tuple(at(0, -0.025, -0.035)), size=(0.058, 0.05, 0.07)),
         dict(co=tuple(at(0, -0.04, 0.13)), size=(0.064, 0.034, 0.085)),
         dict(co=tuple(at(0, -0.012, 0.055)), size=(0.058, 0.05, 0.085)),
         dict(co=tuple(at(0, -0.1, 0.06)), size=(0.1, 0.035, 0.2), neg=True, stiffness=4)]
    up = C.metaball('upper_hi', E, resolution=0.004)

    def up_fn(p, n):
        q = Vector(p) - ankle
        # stitched panel line where the toe box meets the vamp
        g = -0.0018 * math.exp(-((q.z - 0.1 + 0.25 * q.y) / 0.0025) ** 2)
        return g + 0.0006 * noise.noise(Vector(p) * 90)
    C.displace(up, up_fn)

    def up_col(p):
        q = Vector(p) - ankle
        stripe = abs(q.x) > 0.045 and any(abs(q.z - 0.02 - k * 0.028 + (q.y + 0.03) * 0.9) < 0.008 for k in range(2))
        if q.z < -0.085 and q.y > -0.03:
            return ('#1f1f24', 0.6, 0, 0)  # heel tab
        if stripe:
            return ('#ffffff', 0.5, 0, 0)
        return ('#f2f2f2', 0.62, 0, 1.0)
    trim_fn(up, up_col)
    objs = []
    for i in range(4):
        lz = 0.02 + i * 0.036
        l = C.taper_tube('lace_hi', [(-0.04, 0, 0), (0, 0.006, 0.004), (0.04, 0, 0)], 0.0055, 0.0055, 8, 10, 0.5, cap=False)
        C.transform(l, pos=tuple(at(0, 0.036 - i * 0.012, lz)), rot=(-0.35, 0, 0))
        objs.append(l)
    laces = C.join(objs, 'laces_hi')
    trim(laces, '#ffffff', 0.8)
    shoe = C.join([out, mid, up, laces], f'shoe{idx}_hi')
    parts.append(Part(f'shoe_{idx}', 'trim', shoe, bone, tris=1300, uvw=2.0))


# ------------------------------------------------------------------ back and tail
def build_back(sp, spine, name, parts, body_lo):
    back = sp.get('back')
    # nothing on the back may poke through the face window (on the quadrupeds
    # the window sits on top of the hump, among the plates and armour)
    win, _ = raycast(body_lo, (0.003, 1.6, -0.2), (0, 0, 1))
    near_window = lambda q: win is not None and (q - win).length < 0.34
    if back == 'spikes':
        objs = []
        for k in range(12):
            u = 0.12 + k / 11 * 0.76
            p, n, up = surface(sp, spine, u, math.pi / 2, 0.97)
            if near_window(p):
                continue
            s =0.05 + math.sin(k / 11 * math.pi) * 0.04
            o = C.lathe('spike_hi', [(0.0001, -0.1), (1.0, -0.1), (0.95, 0.15), (0.7, 0.55), (0.35, 0.88), (0.0001, 1.0)], 24)
            C.transform(o, scale=(s * 0.55, s * 1.8, s * 0.95))
            # lathe axis (+Y) -> the surface's up direction; flat side faces sideways
            place(o, frame_matrix(p, up, up_hint=-spine.tangent(u)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
            objs.append((o, u))
        for o, u in objs:
            fab(o, dark=1)
            parts.append(Part(f'spike{u:.2f}', 'fabric', o, f'spine_{nearest_bone(sp, u)}', tris=90, uvw=0.5))
    elif back == 'feathers':
        for k in range(16):
            u = 0.3 + k / 15 * 0.66
            p, n, up = surface(sp, spine, u, math.pi / 2, 0.95)
            if near_window(p):
                continue
            o = C.taper_tube('feather_hi', [(0, 0, 0), (0, 0.06, -0.08), (0, 0.1, -0.2)], 0.032, 0.002, 12, 16, 0.3)
            place(o, frame_matrix(p, spine.tangent(u), up_hint=up))
            fab(o, accent=1)
            parts.append(Part(f'feather{k}', 'fabric', o, f'spine_{nearest_bone(sp, u)}', tris=90, uvw=0.4))
        p0 = spine.at(0.03)
        objs = []
        for i in range(-3, 4):
            o = C.taper_tube('tfeather_hi', [(0, 0, 0), (i * 0.03, 0.02, -0.15), (i * 0.07, 0.03, -0.32)], 0.032, 0.003, 12, 16, 0.3)
            C.transform(o, pos=tuple(p0))
            objs.append(o)
        o = C.join(objs, 'tailfan_hi'); fab(o, accent=1)
        parts.append(Part('tailfan', 'fabric', o, 'spine_0', tris=500))
    elif back == 'plates':
        for i in range(11):
            u = 0.2 + i / 10 * 0.66
            p, n, up = surface(sp, spine, u, math.pi / 2, 0.9)
            if near_window(p):
                continue
            size =0.22 + math.sin(i / 10 * math.pi) * 0.34
            outline = []
            for k in range(49):  # the game's plate: two quadratic curves, base at y=0
                t = k / 48
                if t <= 0.5:
                    tt = t * 2
                    x = (1 - tt) ** 2 * -0.5 + 2 * (1 - tt) * tt * -0.62
                    y = 2 * (1 - tt) * tt * 0.55 + tt * tt * 1.0
                else:
                    tt = (t - 0.5) * 2
                    x = 2 * (1 - tt) * tt * 0.62 + tt * tt * 0.5
                    y = (1 - tt) ** 2 * 1.0 + 2 * (1 - tt) * tt * 0.55
                outline.append((x, y - 0.05))
            o = cushion('plate_hi', outline, 0.06)
            # plate stands in the spine plane: local X along the body, Y up, Z sideways
            place(o, frame_matrix(p + SIDE * ((1 if i % 2 else -1) * 0.05), SIDE, up_hint=up) @ Matrix.Diagonal((size, size, size * 0.6, 1)))
            fab(o, accent=1)
            parts.append(Part(f'plate{i}', 'fabric', o, f'spine_{nearest_bone(sp, u)}', tris=300, uvw=0.7))
        p0 = spine.at(0.05)
        objs = []
        for x, zz in ((0.09, 0.3), (-0.09, 0.3), (0.12, -0.1), (-0.12, -0.1)):
            o = C.taper_tube('thag_hi', [(0, 0, 0), (x * 1.5, 0.15, zz * 0.3), (x * 3, 0.34, zz * 0.5)], 0.036, 0.003, 14, 16)
            C.transform(o, pos=tuple(p0))
            objs.append(o)
        o = C.join(objs, 'thag_hi'); trim(o, IVORY, 0.7)
        parts.append(Part('thagomizer', 'trim', o, 'spine_0', tris=400))
    elif back == 'armour':
        for row in range(-3, 4):
            objs = []
            bone_u = []
            for k in range(9):
                u = 0.4 + k / 8 * 0.44
                p, n, up = surface(sp, spine, u, math.pi / 2 + row * 0.32, 1.0)
                if near_window(p):
                    continue
                o =C.lathe('scute_hi', [(0.0001, -0.02), (1.0, -0.02), (0.9, 0.25), (0.55, 0.62), (0.18, 0.95), (0.0001, 1.0)], 20)
                C.transform(o, scale=(0.06, 0.055, 0.06))
                place(o, frame_matrix(p, n) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
                fab(o, dark=1)
                parts.append(Part(f'scute{row}_{k}', 'fabric', o, f'spine_{nearest_bone(sp, u)}', tris=60, uvw=0.3))
        for s in (1, -1):
            for k in range(7):
                u = 0.36 + k / 6 * 0.44
                p, n, up = surface(sp, spine, u, -0.15 if s > 0 else math.pi + 0.15, 1.0)
                d = (n + Vector((0, -0.3, 0))).normalized()
                o = C.taper_tube('sspike_hi', [(0, 0, 0), tuple(d * 0.1), tuple(d * 0.2)], 0.042, 0.004, 14, 12)
                C.transform(o, pos=tuple(p))
                trim(o, IVORY, 0.7)
                parts.append(Part(f'sspike{s}_{k}', 'trim', o, f'spine_{nearest_bone(sp, u)}', tris=80))
        p0 = spine.at(0.02)
        club = C.metaball('club_hi', [dict(co=tuple(p0), size=(0.28, 0.18, 0.24)),
                                      dict(co=tuple(p0 + Vector((0.14, 0, -0.04))), size=(0.14, 0.13, 0.14)),
                                      dict(co=tuple(p0 + Vector((-0.14, 0, -0.04))), size=(0.14, 0.13, 0.14))], resolution=0.01)
        C.displace(club, lambda q, nn: -0.006 * math.exp(-(q[0] / 0.008) ** 2))
        fab(club, dark=1)
        parts.append(Part('club', 'fabric', club, 'spine_0', tris=700))
        objs = []
        for i in range(6):
            a = i / 6 * TAU
            objs.append(C.uv_sphere('ck_hi', 1, 20, 12, pos=tuple(p0 + Vector((math.cos(a) * 0.36, math.sin(a) * 0.2, -0.02))), scale=0.06))
        o = C.join(objs, 'clubknobs_hi'); trim(o, IVORY, 0.7)
        parts.append(Part('clubknobs', 'trim', o, 'spine_0', tris=300))


# ------------------------------------------------------------------ window, fan, bib
def build_accessories(sp, spine, parts, bones, body_lo):
    # face window: the runner's face behind clear PVC, with a sewn fabric rim
    hit, nrm = raycast(body_lo, (0.003, 1.6, -0.2), (0, 0, 1))
    if hit is not None:
        k = nearest_bone(sp, 0.66)
        bone = f'spine_{k}'
        m = frame_matrix(hit, nrm)
        # dark lining behind the face (a flat disc, lathe axis Y turned to face +Z)
        backing = C.lathe('backing_hi', [(0.0001, 0.006), (0.08, 0.005), (0.15, 0.0), (0.15, -0.01)], 48)
        C.transform(backing, rot=(math.pi / 2, 0, 0))
        place(backing, m)
        trim(backing, '#141418', 0.9)
        parts.append(Part('backing', 'trim', backing, bone, tris=100))
        R = math.sin(math.pi / 2.4)
        verts, uvs, faces = [], [], []
        rings, seg = 12, 32
        for i in range(rings + 1):
            th = i / rings * (math.pi / 2.4)
            for j in range(seg + 1):
                a = j / seg * TAU
                x, y, z = math.sin(th) * math.cos(a), math.cos(th), math.sin(th) * math.sin(a)
                verts.append((x, y, z))
                uvs.append((0.5 + x / (2 * R), 1 - (0.5 - z / (2 * R))))
        for i in range(rings):
            for j in range(seg):
                a = i * (seg + 1) + j
                faces.append([a, a + seg + 1, a + seg + 2, a + 1])
        face = C.mesh_obj('face', verts, faces, uvs)
        C.transform(face, scale=(0.13, 0.05, 0.13))
        C.transform(face, pos=(0, 0, -0.02), rot=(math.pi / 2, 0, 0))
        place(face, m)
        C.weight_all(face, bone)
        parts.append(Part('face', 'face', None, bone, lo=face))
        pane = C.uv_sphere('window', 1, 32, 10, phi=(0, math.pi / 3))
        C.transform(pane, scale=(0.15, 0.07, 0.15))
        C.transform(pane, pos=(0, 0, -0.035), rot=(math.pi / 2, 0, 0))
        place(pane, m)
        C.weight_all(pane, bone)
        parts.append(Part('window', 'window', None, bone, lo=pane))
        rim = C.torus('rim_hi', 0.152, 0.02, 128, 20)
        C.displace(rim, lambda p, n: -0.0012 * (math.sin(math.atan2(p[1], p[0]) * 90) > 0.2) * (abs(n[2]) > 0.6))
        C.transform(rim, pos=(0, 0, 0.006))
        place(rim, m)
        fab(rim, dark=1)
        parts.append(Part('rim', 'fabric', rim, bone, tris=500, uvw=0.8))

    # blower fan on the lower back (spins about Z on the `fan` bone)
    hit, nrm = raycast(body_lo, (0.003, 1.02, 0.1), (0, 0, -1))
    if hit is not None:
        k = nearest_bone(sp, 0.46)
        m = frame_matrix(hit, Vector((0, 0, -1)))
        hub = m @ Vector((0, 0, 0.05))
        bones['fan'] = (hub, f'spine_{k}')
        box = C.rounded_box('fanbox_hi', 0.2, 0.14, 0.07, 0.022, pos=(0, 0, 0.015), bevel_segs=4)
        place(box, m)
        grill = C.torus('grill_hi', 0.056, 0.008, 64, 12, pos=(0, 0, 0.056))
        bars = [C.rounded_box('bar_hi', 0.11, 0.006, 0.006, 0.0025, pos=(0, 0, 0.058), rot=(0, 0, a)) for a in (0, math.pi / 3, 2 * math.pi / 3)]
        grill = C.join([grill] + bars, 'grill_hi')
        place(grill, m)
        trim(box, '#1c1d22', 0.45)
        trim(grill, '#cfd3d8', 0.25, 1.0)
        parts.append(Part('fanbox', 'trim', box, f'spine_{k}', tris=300))
        parts.append(Part('grill', 'trim', grill, f'spine_{k}', tris=300))
        blades = []
        for i in range(5):
            b = C.taper_tube('blade_hi', [(0.008, 0, 0), (0.025, 0.004, 0.003), (0.046, 0, 0)], 0.012, 0.008, 8, 8, 0.2)
            C.transform(b, rot=(0, 0, i / 5 * TAU))
            blades.append(b)
        blades.append(C.uv_sphere('hub_hi', 1, 16, 8, scale=(0.012, 0.012, 0.006)))
        o = C.join(blades, 'blades_hi')
        C.transform(o, pos=(0, 0, 0.05))
        place(o, m)
        trim(o, '#3a3d46', 0.4)
        parts.append(Part('blades', 'trim', o, 'fan', tris=300))

    # race bib, pinned below the window (texture drawn by the game)
    hitW, _ = raycast(body_lo, (0.003, 1.6, -0.2), (0, 0, 1))
    hit, nrm = raycast(body_lo, (0.003, (hitW.y if hitW is not None else 1.56) - 0.36, -0.2), (0, 0, 1))
    if hit is not None:
        k = nearest_bone(sp, 0.55)
        bone = f'spine_{k}'
        m = frame_matrix(hit, nrm)
        verts, uvs, faces = [], [], []
        nx, ny = 8, 4
        for i in range(ny + 1):
            for j in range(nx + 1):
                x = (j / nx - 0.5) * 0.34
                y = (0.5 - i / ny) * 0.25
                verts.append((x, y, -(x * x) * 0.9 + 0.012))
                uvs.append((j / nx, 1 - (1 - i / ny)))
        for i in range(ny):
            for j in range(nx):
                a = i * (nx + 1) + j
                faces.append([a, a + nx + 1, a + nx + 2, a + 1])
        bib = C.mesh_obj('bib', verts, faces, uvs, recalc=False)
        place(bib, m)
        C.weight_all(bib, bone)
        parts.append(Part('bib', 'bib', None, bone, lo=bib))
        pins = [C.uv_sphere('pin_hi', 1, 12, 8, pos=(x, y, 0.016 - x * x * 0.9), scale=0.012) for x, y in ((-0.15, 0.1), (0.15, 0.1), (-0.15, -0.1), (0.15, -0.1))]
        o = C.join(pins, 'pins_hi')
        place(o, m)
        trim(o, '#cfd3d8', 0.25, 1.0)
        parts.append(Part('pins', 'trim', o, bone, tris=120))


# ------------------------------------------------------------------ rig
def build_rig(bones):
    arm = bpy.data.armatures.new('rig')
    ob = C.link(bpy.data.objects.new('rig', arm))
    C.select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    order = list(bones.keys())
    for name in order:
        pos, parent = bones[name]
        b = arm.edit_bones.new(name)
        h = C.G(*pos)
        b.head = h
        b.tail = h + Vector((0, 0, 0.05))
        b.roll = 0
        eb[name] = b
    for name in order:
        parent = bones[name][1]
        if parent:
            eb[name].parent = eb[parent]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def rig_bones(sp, spine):
    bones = {'pivot': (Vector((0, 0, 0)), None), 'torso': (Vector((0, HIP, 0)), 'pivot')}
    r = sp['root']
    n = len(sp['bones'])
    # parents first: root spine bone, then outwards in both directions
    bones[f'spine_{r}'] = (spine.at(sp['bones'][r]), 'torso')
    for i in range(r - 1, -1, -1):
        bones[f'spine_{i}'] = (spine.at(sp['bones'][i]), f'spine_{i + 1}')
    for i in range(r + 1, n):
        bones[f'spine_{i}'] = (spine.at(sp['bones'][i]), f'spine_{i - 1}')
    hp = spine.at(1) + Vector(sp['head']['at'])
    bones['head'] = (hp, f'spine_{n - 1}')
    return bones, hp


# ------------------------------------------------------------------ build
def lowify(part):
    """Game mesh for a part: decimated copy of the sculpt, smart-UV'd, rigidly skinned."""
    lo = C.copy_obj(part.hi, part.name + '_lo')
    for a in list(lo.data.color_attributes):
        lo.data.color_attributes.remove(a)
    C.decimate(lo, part.tris)
    B.unwrap(lo, angle=66, margin=0.02)
    C.weight_all(lo, part.bone)
    part.lo = lo
    return lo


def equalize_uvs(objs):
    """Same texel density everywhere before per-part weights are applied."""
    B.uv_edit(objs)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_kind(name, kind, parts, size, passes, out_dir):
    """Join the low meshes of one material kind, pack their UVs and bake."""
    ps = [p for p in parts if p.kind in kind and p.hi is not None]
    los = [p.lo for p in ps]
    his = [p.hi for p in ps]
    for p in ps:
        idx = kind.index(p.kind)
        # remember which glTF material each face gets
        p.lo.data.materials.clear()
        for k in kind:
            p.lo.data.materials.append(B.plain_material(k))
        for poly in p.lo.data.polygons:
            poly.material_index = idx
    # per-part texel weights survive averaging: average first, then weight
    equalize_uvs(los)
    for p in ps:
        B.weight_uvs(p.lo, p.uvw)
    lo = C.join(los, f'{kind[0]}_lo')
    B.pack(lo, margin=0.004)
    names = [m.name for m in lo.data.materials]
    results = {}
    for tag, attr, bake_type, pattern in passes:
        img = B.new_image(f'{name}_{kind[0]}_{tag}', size, data=True)
        if bake_type == 'EMIT':
            B.set_pass([h.data.materials[0] for h in his], attr, pattern)
        results[tag] = B.bake_pass(lo, his, img, bake_type, extrusion=0.025, ray=0.06)
        cov = results[tag][..., 3] > 0.5
        C.log(f'  {kind[0]} {tag}: coverage {cov.mean() * 100:.1f}%')
    B.set_slots(lo, [B.plain_material(n) for n in names])
    return lo, results


def assemble_textures(name, fab_res, trim_res, out_dir):
    files = {}
    m, a, n = fab_res['mask'], fab_res['ao'], fab_res['normal']
    cov = m[..., 3] > 0.5
    # AO rides in alpha; keep it off zero so a browser that premultiplies can't wipe the masks
    arr = np.dstack([m[..., 0], m[..., 1], m[..., 2], 0.2 + 0.8 * a[..., 0]])
    arr = B.dilate_alpha(arr, cov)
    B.save_webp(arr, os.path.join(out_dir, f'{name}_fabric_mask.webp'))
    nn = B.dilate_alpha(np.dstack([n[..., 0], n[..., 1], n[..., 2], np.ones_like(n[..., 0])]), n[..., 3] > 0.5)
    B.save_webp(nn, os.path.join(out_dir, f'{name}_fabric_normal.webp'))
    files['fabric'] = {'mask': f'{name}_fabric_mask.webp', 'normal': f'{name}_fabric_normal.webp'}
    if trim_res:
        c, mt, ao, tn = trim_res['col'], trim_res['mat'], trim_res['ao'], trim_res['normal']
        cov = c[..., 3] > 0.5
        one = np.ones_like(ao[..., 0])
        col = np.dstack([B.lin_to_srgb(c[..., 0]), B.lin_to_srgb(c[..., 1]), B.lin_to_srgb(c[..., 2]), one])
        B.save_webp(B.dilate_alpha(col, cov), os.path.join(out_dir, f'{name}_trim_color.webp'))
        # R occlusion, G roughness, B tint mask (metalness is not used by the game)
        orm = np.dstack([ao[..., 0], mt[..., 0], mt[..., 2], one])
        B.save_webp(B.dilate_alpha(orm, cov), os.path.join(out_dir, f'{name}_trim_orm.webp'))
        tnn = B.dilate_alpha(np.dstack([tn[..., 0], tn[..., 1], tn[..., 2], np.ones_like(tn[..., 0])]), tn[..., 3] > 0.5)
        B.save_webp(tnn, os.path.join(out_dir, f'{name}_trim_normal.webp'))
        files['trim'] = {'color': f'{name}_trim_color.webp', 'orm': f'{name}_trim_orm.webp', 'normal': f'{name}_trim_normal.webp'}
    return files


def build(name, opts):
    sp = SPECIES[name]
    C.reset()
    C.log(f'costume {name}')
    spine = Spine(sp['spine'])
    bones, hp = rig_bones(sp, spine)
    parts = []

    body = Part('body', 'fabric', body_hi(sp, spine, 'body_hi'), None, uvw=1.0)
    parts.append(body)
    blo = body_lo(sp, spine, 'body_lo')
    body.lo = blo
    build_head(sp, name, hp, parts)
    if sp.get('jaw'):
        bones['jaw'] = (hp + Vector((0, -sp['head']['h'] * 0.16, -sp['head']['len'] * 0.05)), 'head')
    eye_parts = [p for p in parts if p.name.startswith('eye_')]
    for p in parts:
        if p.name.startswith('lid_'):
            idx = p.name[-1]
            c = C.to_game(C.verts_np(next(e.hi for e in eye_parts if e.name == f'eye_{idx}'))).mean(axis=0)
            bones[p.name] = (Vector(c), 'head')
    for idx, s in enumerate((-1, 1)):
        build_arm(sp, spine, name, parts, idx, s, bones, blo)
        build_leg(parts, idx, s, bones)
    build_back(sp, spine, name, parts, blo)
    build_accessories(sp, spine, parts, bones, blo)
    C.log(f'  {len(parts)} parts built')

    # ambient occlusion from the full high-poly costume, stored per vertex
    his = [p.hi for p in parts if p.hi is not None]
    for p in parts:
        if p.lo is not None:
            p.lo.hide_render = True
    B.bake_vertex_ao(his)
    for p in parts:
        if p.lo is not None:
            p.lo.hide_render = False
    for h in his:
        mat = B.hi_material('hi_' + h.name, sp['pattern'] if 'mask' in h.data.color_attributes else 'none')
        B.assign(h, mat)
    for p in parts:
        if p.lo is None and p.hi is not None:
            lowify(p)
    out_dir = os.path.join(C.OUT, 'costumes')
    size = int(1024 * opts.get('size', 1))
    fab_lo, fab_res = bake_kind(name, ['fabric', 'membrane'], parts, size,
                                [('mask', 'mask', 'EMIT', True), ('ao', 'ao', 'EMIT', False), ('normal', None, 'NORMAL', False)], out_dir)
    trim_lo, trim_res = bake_kind(name, ['trim'], parts, size // 2,
                                  [('col', 'col', 'EMIT', False), ('mat', 'mat', 'EMIT', False), ('ao', 'ao', 'EMIT', False), ('normal', None, 'NORMAL', False)], out_dir)
    files = assemble_textures(name, fab_res, trim_res, out_dir)

    rig = build_rig(bones)
    extra = [p.lo for p in parts if p.kind in ('face', 'window', 'bib')]
    for p in parts:
        if p.kind in ('face', 'window', 'bib'):
            B.assign(p.lo, B.plain_material(p.kind))
            p.lo.name = p.kind
    meshes = [fab_lo, trim_lo] + extra
    for m in meshes:
        m.parent = rig
        md = m.modifiers.new('rig', 'ARMATURE')
        md.object = rig
    tris = sum(C.tri_count(m) for m in meshes)
    C.log(f'  game mesh: {tris} triangles ({C.tri_count(fab_lo)} fabric, {C.tri_count(trim_lo)} trim)')
    for h in his:
        h.hide_render = True
    if opts.get('preview'):
        preview(name, sp, fab_lo, trim_lo, extra, out_dir, files)
    glb = os.path.join(out_dir, f'{name}.glb')
    B.export_glb([rig] + meshes, glb)
    return {'file': f'costumes/{name}.glb', 'textures': files, 'tris': tris, 'bones': len(bones)}


# ------------------------------------------------------------------ preview render
def preview(name, sp, fab_lo, trim_lo, extra, out_dir, files):
    """Quick Cycles render of the game mesh with the baked textures, for review."""
    from lib.preview import render_costume
    render_costume(name, sp, fab_lo, trim_lo, extra, out_dir, files)
