#!/usr/bin/env python3
"""Convert raw small-body shape models into Cosmos' compact 'SBSH' binary meshes.

Usage (from repo root; run fetch-shapes.mjs first):
    python -P scripts/data/smallbodies/build-shapes.py [id ...]

Reads  scripts/data/smallbodies/sources.json
       data-raw/smallbodies/<id>/<file>          (OBJ, Gaskell ICQ plate .tab, SPICE DSK type 2)
Writes public/data/smallbodies/shapes/<id>.bin and shapes/index.json

Binary layout (little-endian):
   0  'SBSH'           4  uint32 version=1    8 uint32 nVerts   12 uint32 nTris
  16  float32 scaleKm 20  uint32 flags (bit0 => uint32 indices)
  24  int16 positions[nVerts*3] (km = q/32767*scaleKm), zero-padded to 4 bytes
      then indices[nTris*3], CCW seen from outside (positive signed volume).

Pipeline: read -> weld duplicate vertices -> drop degenerate/duplicate faces ->
orient outward -> (re-centre on volume centroid if offset > 1% of radius) ->
quadric-error-metric edge collapse (Garland & Heckbert 1997) with link-condition
and normal-flip guards -> quantise -> write.  Requires numpy only.
"""
import datetime
import heapq
import json
import math
import os
import struct
import sys
import time

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "data-raw", "smallbodies")
OUT = os.path.join(ROOT, "public", "data", "smallbodies", "shapes")
SOURCES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources.json")


# ----------------------------------------------------------------------------- readers
def read_obj(path):
    verts, faces = [], []
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("f "):
                idx = []
                for tok in line.split()[1:]:
                    i = int(tok.split("/")[0])
                    idx.append(i - 1 if i > 0 else len(verts) + i)
                for k in range(1, len(idx) - 1):
                    faces.append((idx[0], idx[k], idx[k + 1]))
    return np.array(verts, np.float64), np.array(faces, np.int64)


def read_plate(path):
    """Gaskell/PDS plate model: 'nv np', nv lines 'id x y z', np lines 'id i j k' (1-based)."""
    with open(path, "r") as fh:
        toks = fh.read().split()
    nv, nf = int(toks[0]), int(toks[1])
    a = np.array(toks[2:2 + 4 * nv], dtype=np.float64).reshape(nv, 4)
    b = np.array(toks[2 + 4 * nv:2 + 4 * nv + 4 * nf], dtype=np.int64).reshape(nf, 4)
    return a[:, 1:4].copy(), b[:, 1:4] - 1


def read_dsk2(path):
    """SPICE DSK (DAS architecture), first type-2 (plate) segment. Units km."""
    b = open(path, "rb").read()
    if b[:8] != b"DAS/DSK " or b[84:92] != b"LTL-IEEE":
        raise ValueError("not a little-endian DAS/DSK file")
    nresvr, _nresvc, ncomr, _ncomc = struct.unpack("<4i", b[68:84])
    rec = 2 + nresvr + ncomr  # first directory record (1-based)
    dp_recs, int_recs = [], []
    nxt_type = {1: 2, 2: 3, 3: 1}
    prv_type = {1: 3, 2: 1, 3: 2}
    while rec:
        d = np.frombuffer(b[(rec - 1) * 1024:rec * 1024], "<i4")
        ctype, r = int(d[8]), rec + 1
        for k, n in enumerate(d[9:]):
            n = int(n)
            if n == 0:
                break
            if k > 0:
                ctype = nxt_type[ctype] if n > 0 else prv_type[ctype]
            n = abs(n)
            (dp_recs if ctype == 2 else int_recs if ctype == 3 else []).extend(range(r, r + n))
            r += n
        rec = int(d[1])
    dp = np.concatenate([np.frombuffer(b[(q - 1) * 1024:q * 1024], "<f8") for q in dp_recs])
    ii = np.concatenate([np.frombuffer(b[(q - 1) * 1024:q * 1024], "<i4") for q in int_recs])
    # DLA: ii[0]=format, ii[1]=first descriptor address (1-based); descriptor 8 ints
    p = int(ii[1]) - 1
    _bw, _fw, ibase, _isize, dbase, _dsize, _cb, _cs = (int(x) for x in ii[p:p + 8])
    seg_i, seg_d = ii[ibase:], dp[dbase:]
    dtype = int(round(seg_d[3]))
    if dtype != 2:
        raise ValueError("DSK segment type %d unsupported" % dtype)
    nv, nf = int(seg_i[0]), int(seg_i[1])
    verts = seg_d[34:34 + 3 * nv].reshape(nv, 3).copy()  # 24 descriptor + 6 bounds + 3 origin + 1 size
    plates = seg_i[10:10 + 3 * nf].astype(np.int64).reshape(nf, 3) - 1
    return verts, plates


READERS = {"obj": read_obj, "plate": read_plate, "dsk2": read_dsk2}


# ----------------------------------------------------------------------------- mesh utils
def weld(V, F):
    span = np.abs(V).max()
    key = np.round(V / (span * 1e-7)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    V2 = V[first]
    F2 = inv.reshape(-1)[F]
    ok = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 2] != F2[:, 0])
    F2 = F2[ok]
    # drop duplicate faces (same vertex set)
    _, keep = np.unique(np.sort(F2, axis=1), axis=0, return_index=True)
    F2 = F2[np.sort(keep)]
    used = np.unique(F2)
    remap = -np.ones(len(V2), np.int64)
    remap[used] = np.arange(len(used))
    return V2[used], remap[F2]


def volume_centroid(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    v6 = np.einsum("ij,ij->i", a, np.cross(b, c))
    vol = v6.sum() / 6.0
    cen = ((a + b + c) * v6[:, None]).sum(0) / (24.0 * vol) if vol != 0 else np.zeros(3)
    return vol, cen


def edge_stats(F):
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    _, cnt = np.unique(e, axis=0, return_counts=True)
    return int((cnt == 1).sum()), int((cnt > 2).sum())


# ----------------------------------------------------------------------------- QEM decimation
def decimate(V, F, target, min_dot=0.2):
    n = len(V)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    nrm = np.cross(b - a, c - a)
    area2 = np.linalg.norm(nrm, axis=1)
    nn = nrm / np.maximum(area2, 1e-300)[:, None]
    d = -np.einsum("ij,ij->i", nn, a)
    w = area2 * 0.5
    A, B, C = nn[:, 0], nn[:, 1], nn[:, 2]
    fq = np.stack([A * A, A * B, A * C, A * d, B * B, B * C, B * d, C * C, C * d, d * d], 1) * w[:, None]
    Qn = np.zeros((n, 10))
    for k in range(3):
        np.add.at(Qn, F[:, k], fq)
    Q = Qn.tolist()
    P = V.tolist()
    faces = F.tolist()
    alive_f = [True] * len(faces)
    vf = [set() for _ in range(n)]
    for fi, (i, j, k) in enumerate(faces):
        vf[i].add(fi); vf[j].add(fi); vf[k].add(fi)
    alive_v = [True] * n
    stamp = [0] * n

    def qerr(q, x, y, z):
        return (q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y
                + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9])

    def edge_cost(u, v):
        qu, qv = Q[u], Q[v]
        q = [qu[i] + qv[i] for i in range(10)]
        pu, pv = P[u], P[v]
        mx, my, mz = (pu[0] + pv[0]) * 0.5, (pu[1] + pv[1]) * 0.5, (pu[2] + pv[2]) * 0.5
        a11, a12, a13, a22, a23, a33 = q[0], q[1], q[2], q[4], q[5], q[7]
        det = (a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13)
               + a13 * (a12 * a23 - a22 * a13))
        scale = abs(a11 * a22 * a33) + 1e-300
        best = None
        if abs(det) > 1e-9 * scale:
            b1, b2, b3 = -q[3], -q[6], -q[8]
            x = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det
            y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det
            z = (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det
            el2 = (pu[0] - pv[0]) ** 2 + (pu[1] - pv[1]) ** 2 + (pu[2] - pv[2]) ** 2
            if (x - mx) ** 2 + (y - my) ** 2 + (z - mz) ** 2 <= el2:
                best = (qerr(q, x, y, z), x, y, z)
        if best is None:
            for (x, y, z) in ((mx, my, mz), pu, pv):
                e = qerr(q, x, y, z)
                if best is None or e < best[0]:
                    best = (e, x, y, z)
        return max(best[0], 0.0), best[1], best[2], best[3]

    def neighbors(u):
        s = set()
        for fi in vf[u]:
            s.update(faces[fi])
        s.discard(u)
        return s

    heap = []

    def push(u, v):
        cost, x, y, z = edge_cost(u, v)
        heapq.heappush(heap, (cost, u, v, stamp[u], stamp[v], x, y, z))

    def build_heap():
        heap.clear()
        es = set()
        for fi, f in enumerate(faces):
            if alive_f[fi]:
                for e in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])):
                    es.add((min(e), max(e)))
        items = []
        for u, v in es:
            cost, x, y, z = edge_cost(u, v)
            items.append((cost, u, v, stamp[u], stamp[v], x, y, z))
        heap.extend(items)
        heapq.heapify(heap)

    nf = len(faces)
    build_heap()
    rebuilds = 0
    while nf > target:
        if not heap:
            rebuilds += 1
            if rebuilds > 3:
                break
            min_dot -= 0.15
            build_heap()
            continue
        cost, u, v, su, sv, x, y, z = heapq.heappop(heap)
        if not (alive_v[u] and alive_v[v]) or stamp[u] != su or stamp[v] != sv:
            continue
        shared = vf[u] & vf[v]
        if len(shared) != 2:
            continue
        nu, nv_ = neighbors(u), neighbors(v)
        if len(nu & nv_) != 2:
            continue  # link condition (keeps the mesh a 2-manifold)
        ok = True
        for fi in (vf[u] | vf[v]) - shared:
            f = faces[fi]
            p0, p1, p2 = P[f[0]], P[f[1]], P[f[2]]
            q0 = (x, y, z) if f[0] in (u, v) else p0
            q1 = (x, y, z) if f[1] in (u, v) else p1
            q2 = (x, y, z) if f[2] in (u, v) else p2
            e1 = (p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); e2 = (p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])
            n0 = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
            g1 = (q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]); g2 = (q2[0] - q0[0], q2[1] - q0[1], q2[2] - q0[2])
            n1 = (g1[1] * g2[2] - g1[2] * g2[1], g1[2] * g2[0] - g1[0] * g2[2], g1[0] * g2[1] - g1[1] * g2[0])
            l0 = math.sqrt(n0[0] ** 2 + n0[1] ** 2 + n0[2] ** 2)
            l1 = math.sqrt(n1[0] ** 2 + n1[1] ** 2 + n1[2] ** 2)
            if l1 <= 1e-30 or l0 <= 1e-30 or (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) < min_dot * l0 * l1:
                ok = False
                break
        if not ok:
            continue
        # collapse v -> u at (x, y, z)
        for fi in shared:
            alive_f[fi] = False
            for w in faces[fi]:
                vf[w].discard(fi)
            nf -= 1
        for fi in vf[v]:
            f = faces[fi]
            f[f.index(v)] = u
            vf[u].add(fi)
        vf[v] = set()
        alive_v[v] = False
        P[u] = [x, y, z]
        qu, qv = Q[u], Q[v]
        Q[u] = [qu[i] + qv[i] for i in range(10)]
        stamp[u] += 1
        for w in neighbors(u):
            push(u, w)

    keep_f = [faces[i] for i in range(len(faces)) if alive_f[i]]
    Fo = np.array(keep_f, np.int64)
    used = np.unique(Fo)
    remap = -np.ones(n, np.int64)
    remap[used] = np.arange(len(used))
    return np.array(P)[used], remap[Fo]


# ----------------------------------------------------------------------------- output
def write_bin(path, V, F):
    scale = float(np.abs(V).max())
    q = np.clip(np.round(V / scale * 32767.0), -32767, 32767).astype("<i2")
    big = len(V) > 65535
    idx = F.astype("<u4" if big else "<u2")
    hdr = b"SBSH" + struct.pack("<IIIfI", 1, len(V), len(F), scale, 1 if big else 0)
    pos = q.tobytes()
    pad = b"\0" * ((4 - len(pos) % 4) % 4)
    with open(path, "wb") as fh:
        fh.write(hdr + pos + pad + idx.tobytes())
    # return the quantised geometry exactly as the renderer will see it
    scale32 = struct.unpack("<f", struct.pack("<f", scale))[0]
    return q.astype(np.float64) / 32767.0 * scale32, scale


def main():
    cfg = json.load(open(SOURCES))["bodies"]
    only = sys.argv[1:]
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, "index.json")
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {"version": 1, "shapes": {}}
    for bid, s in cfg.items():
        if only and bid not in only:
            continue
        src = os.path.join(RAW, bid, s["file"])
        if not os.path.exists(src):
            print("[%s] missing %s (run fetch-shapes.mjs)" % (bid, src))
            continue
        t0 = time.time()
        V, F = READERS[s["format"]](src)
        n0v, n0f = len(V), len(F)
        V, F = weld(V, F)
        vol, cen = volume_centroid(V, F)
        if vol < 0:
            F = F[:, [0, 2, 1]]
            vol = -vol
        r = (3 * vol / (4 * math.pi)) ** (1 / 3)
        off = float(np.linalg.norm(cen))
        recentred = off > 0.01 * r
        if recentred:
            V = V - cen
        bnd, nonman = edge_stats(F)
        tgt = s.get("targetTris")
        if tgt and len(F) > tgt:
            V, F = decimate(V, F, tgt)
        vol2, _ = volume_centroid(V, F)
        if vol2 < 0:
            F = F[:, [0, 2, 1]]
        Vq, scale = write_bin(os.path.join(OUT, bid + ".bin"), V, F)
        volq, cenq = volume_centroid(Vq, F)
        rq = (3 * volq / (4 * math.pi)) ** (1 / 3)
        ext = (Vq.max(0) - Vq.min(0)).tolist()
        size = os.path.getsize(os.path.join(OUT, bid + ".bin"))
        print("[%s] src %d v/%d f -> %d v/%d f | open edges %d nonmanifold %d | centroid offset %.4f km%s | "
              "R %.4f -> %.4f km | %d B | %.1fs" % (bid, n0v, n0f, len(Vq), len(F), bnd, nonman, off,
                                                    " (re-centred)" if recentred else "", r, rq, size,
                                                    time.time() - t0))
        index["shapes"][bid] = {
            "file": "shapes/%s.bin" % bid,
            "vertices": int(len(Vq)),
            "triangles": int(len(F)),
            "meanRadiusKm": round(rq, 5),
            "extentKm": [round(x, 4) for x in ext],
            "model": s["model"],
            "source": s["url"],
            "citation": s["citation"],
            "license": s["license"],
        }
    index = {"version": 1, "generated": datetime.date.today().isoformat(),
             "shapes": dict(sorted(index["shapes"].items()))}
    with open(idx_path, "w") as fh:
        json.dump(index, fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
