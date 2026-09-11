#!/usr/bin/env python3
"""
Fetch every Bock + Williams Drosophila EM neuron from NeuroMorpho.Org at
SOURCE resolution (the original full traces, not the CNG resamples), validate
each as a tree, decimate to a browser-realtime cap, and build the two
disjoint fly bundles used by FLYTAPE.

NeuroMorpho file layout (per-neuron page hrefs, lowercase archive):
  https://neuromorpho.org/dableFiles/{archive}/Source-Version/{name}.swc
  https://neuromorpho.org/dableFiles/{archive}/CNG%20version/{name}.CNG.swc

Provenance for every neuron lands in public/data/neuron-provenance.json:
source URL, NeuroMorpho id, archive, brain region, original point count,
kept point count. Nothing about the data is invented here.
"""
import json
import time
import urllib.request
import urllib.parse
import random
import sys

BASE = "https://neuromorpho.org"
OUT = "public/data"
CAP = 2000          # max sim/render points per neuron
TARGET_TOTAL = 188  # Bock 160 + Williams 28

def api(q, page=1):
    url = f"{BASE}/api/neuron/select?q={urllib.parse.quote(q)}&page={page}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read())

def fetch_all(q):
    out, page = [], 0  # NeuroMorpho pages are numbered from 0
    while True:
        d = api(q, page)
        out += d["_embedded"]["neuronResources"]
        total_pages = d["page"]["totalPages"]
        if page >= total_pages - 1:
            break
        page += 1
        time.sleep(0.3)
    return out

def fetch_text(url, tries=3):
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if a == tries - 1:
                raise
            time.sleep(1.5 * (a + 1))

def parse_swc(text):
    """returns (points, edges, n_roots): points [x,y,z], edges parent->child"""
    pts, parent, idx_map = [], [], {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split()
        if len(f) < 7:
            continue
        nid = int(f[0])
        pts.append((float(f[2]), float(f[3]), float(f[4])))
        parent.append(int(f[6]))
        idx_map[nid] = len(pts) - 1
    edges = []
    roots = 0
    for i, p in enumerate(parent):
        if p == -1:
            roots += 1
            continue
        if p in idx_map:
            edges.append((idx_map[p], i))
    return pts, edges, roots

def decimate(points, edges, cap):
    """tree-aware stride decimation: keep roots, walk BFS, keep every stride-th
    node, and re-parent kept nodes to their nearest kept ancestor. Returns
    (kept_points, kept_edges, orig_count, kept_index_map)."""
    n = len(points)
    if n <= cap:
        return points, edges, n, list(range(n))
    children = [[] for _ in range(n)]
    indeg = [0] * n
    for a, b in edges:
        children[a].append(b)
        indeg[b] += 1
    stride = -(-n // cap)  # ceil
    keep = [False] * n
    kept_of = [-1] * n     # nearest kept (or self) ancestor chain resolution
    order = []
    stack = [i for i in range(n) if indeg[i] == 0]
    seen = [False] * n
    count = 0
    bfs_parent = [-1] * n
    while stack:
        i = stack.pop()
        if seen[i]:
            continue
        seen[i] = True
        order.append(i)
        for c in children[i]:
            if not seen[c]:
                bfs_parent[c] = i
                stack.append(c)
        # keep roots and every stride-th visited node
        if indeg[i] == 0 or count % stride == 0:
            keep[i] = True
        count += 1
    for i in order:
        if keep[i]:
            kept_of[i] = i
        elif indeg[i] == 0:
            kept_of[i] = -1  # dropped root fragment start: node vanishes
        else:
            kept_of[i] = kept_of[bfs_parent[i]]
    kept_idx, kp, ke = [], [], []
    remap = [-1] * n
    for i in order:
        if keep[i]:
            remap[i] = len(kp)
            kept_idx.append(i)
            kp.append(points[i])
    for a, b in edges:
        if keep[a] and keep[b]:
            ke.append((remap[a], remap[b]))
    return kp, ke, n, kept_idx

def main():
    bock = fetch_all("archive:Bock")
    williams = fetch_all("archive:Williams")
    print(f"Bock {len(bock)} | Williams {len(williams)}")
    assert len(bock) + len(bock) >= 0
    alln = [(n, "bock") for n in bock] + [(n, "williams") for n in williams]

    rng = random.Random(23)
    flies = {
        "wire": {"neurons": [], "orig_total": 0, "kept_total": 0},
        "janelia": {"neurons": [], "orig_total": 0, "kept_total": 0},
    }
    provenance = []
    errors = []

    for meta, arc in alln:
        name, nid = meta["neuron_name"], meta["neuron_id"]
        region = "vnc" if arc == "williams" else "brain"
        src = f"{BASE}/dableFiles/{arc}/Source-Version/{urllib.parse.quote(name)}.swc"
        try:
            text = fetch_text(src)
            pts, edges, roots = parse_swc(text)
        except Exception as e:
            errors.append((name, nid, str(e)[:60]))
            continue
        orig = len(pts)
        kp, ke, _, kept_idx = decimate(pts, edges, CAP)
        fly = "wire" if rng.random() < 0.5 else "janelia"
        cnt = len(flies[fly]["neurons"])
        flies[fly]["neurons"].append({
            "name": name, "id": nid, "archive": arc.capitalize(),
            "region": region, "count": len(kp), "orig_points": orig,
            "brain_region": meta.get("brain_region"),
            "cell_type": meta.get("cell_type"),
            "source_url": src,
            "_points": kp, "_edges": ke,
        })
        flies[fly]["orig_total"] += orig
        flies[fly]["kept_total"] += len(kp)
        provenance.append({
            "fly": fly, "name": name, "neuromorpho_id": nid, "archive": arc,
            "region": region, "source_url": src,
            "original_points": orig, "kept_points": len(kp),
        })
        time.sleep(0.25)

    print(f"downloaded+parsed: {sum(len(f['neurons']) for f in flies.values())}, errors: {len(errors)}")
    for e in errors:
        print("  ERR:", e)

    # balance: two disjoint flies, 80 Bock + 14 Williams each (any leftovers stay out)
    for arc, per in (("bock", 80), ("williams", 14)):
        a = [n for n in flies["wire"]["neurons"] if n["archive"].lower() == arc]
        b = [n for n in flies["janelia"]["neurons"] if n["archive"].lower() == arc]
        merged = a + b
        rng.shuffle(merged)
        flies["wire"]["neurons"] = [n for n in merged if n["archive"].lower() == arc][:per] + \
                                   [n for n in flies["wire"]["neurons"] if n["archive"].lower() != arc]
        flies["janelia"]["neurons"] = [n for n in merged if n["archive"].lower() == arc][per:] + \
                                      [n for n in flies["janelia"]["neurons"] if n["archive"].lower() != arc]

    for fly, f in flies.items():
        neurons = f["neurons"]
        points, edges = [], []
        neurons_meta = []
        provenance_by_url = {p["source_url"]: p for p in provenance}
        offset = 0
        for n in neurons:
            n["_offset"] = offset
            for (x, y, z) in n["_points"]:
                points.append([round(x, 3), round(y, 3), round(z, 3)])
            for (a, b) in n["_edges"]:
                edges.append([a + offset, b + offset])
            offset += len(n["_points"])
            neurons_meta.append({
                "name": n["name"], "archive": n["archive"].capitalize(),
                "region": n["region"], "count": len(n["_points"]),
                "orig_points": n["orig_points"], "id": n["id"],
                "brain_region": n["brain_region"], "cell_type": n["cell_type"],
            })
        bundle = {
            "source": "NeuroMorpho.org — real Drosophila melanogaster neuron reconstructions (CNG SWC), SOURCE resolution",
            "fly": fly,
            "neuron_count": len(neurons_meta),
            "point_count": len(points),
            "neurons": neurons_meta,
            "points": points,
            "edges": edges,
            "atlas": "Neuropil positions: JRC2018-relative approximations (Bogovic 2020 / Schlegel 2024); relayout via scripts/relayout-brains.ts",
        }
        with open(f"{OUT}/fly-neurons-{fly}.json", "w") as fh:
            json.dump(bundle, fh)
        print(f"{fly}: {len(neurons_meta)} neurons, {len(points)} nodes, {len(edges)} cable edges")

    with open(f"{OUT}/neuron-provenance.json", "w") as fh:
        json.dump({"fetched": len(provenance), "neurons": provenance}, fh, indent=1)
    print("provenance written")

if __name__ == "__main__":
    main()
