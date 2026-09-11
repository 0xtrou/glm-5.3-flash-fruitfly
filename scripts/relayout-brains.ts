/**
 * Scientific relayout: re-place every neuron inside its assigned neuropil,
 * using atlas positions (src/lib/brain/atlas.ts, JRC2018-relative).
 *
 * Per neuron: recover its local arbor shape from the stored final coords
 * (PCA-align to principal axes, normalize to unit box), then re-place inside
 * the assigned neuropil's ellipsoid, oriented along the neuropil's axes.
 * No network access needed — operates on existing JSON bundles.
 *
 * Run: npx tsx scripts/relayout-brains.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { NEUROPHILS, neuropilByName, assignNeuropils } from "../src/lib/brain/atlas";

type P3 = [number, number, number];
interface Dataset {
  points: P3[];
  edges: [number, number][];
  neurons: { name: string; archive: string; region: "brain" | "vnc"; count: number }[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PCA on x/y/z: returns dominant axes (normalized) + centroid */
function pca(pts: P3[]): { axes: P3[]; center: P3 } {
  const c: P3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  c[0] /= pts.length;
  c[1] /= pts.length;
  c[2] /= pts.length;
  // covariance
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  // power iterations for top-3 eigenvectors (deflated)
  const axes: P3[] = [];
  const work = cov.map((r) => [...r]);
  let seedV: P3 = [0.31, 0.57, 0.76];
  for (let ax = 0; ax < 3; ax++) {
    let v: P3 = [...seedV];
    for (let it = 0; it < 32; it++) {
      const nv: P3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nv[i] += work[i][j] * v[j];
      const len = Math.hypot(nv[0], nv[1], nv[2]) || 1;
      v = [nv[0] / len, nv[1] / len, nv[2] / len];
    }
    // eigenvalue for this axis
    let lam = 0;
    for (let i = 0; i < 3; i++) lam += work[i][i] * 0; // unused directly
    // deflate covariance with the found component
    const w: P3 = [v[0] * 1, v[1] * 1, v[2] * 1];
    const proj = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) proj[i] += cov[i][j] * v[j];
    const factor = v[0] * proj[0] + v[1] * proj[1] + v[2] * proj[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) work[i][j] -= factor * v[i] * v[j];
    axes.push([v[0], v[1], v[2]]);
    seedV = [seedV[2], seedV[0], seedV[1]];
  }
  return { axes, center: c };
}

function orient(p: P3, axes: P3[]): P3 {
  const d: P3 = [p[0], p[1], p[2]];
  // project onto the principal axes
  return [
    d[0] * axes[0][0] + d[1] * axes[0][1] + d[2] * axes[0][2],
    d[0] * axes[1][0] + d[1] * axes[1][1] + d[2] * axes[1][2],
    d[0] * axes[2][0] + d[1] * axes[2][1] + d[2] * axes[2][2],
  ];
}

function relayout(file: string, seed: number) {
  const p = path.join("public", "data", file);
  const data: Dataset = JSON.parse(fs.readFileSync(p, "utf8"));
  const names = assignNeuropils(
    data.neurons.filter((n) => n.region === "brain").length,
    data.neurons.filter((n) => n.region === "vnc").length,
    seed
  );
  const brainIdx = { v: 0 };
  const vncIdx = { v: 0 };
  const rand = mulberry32(seed);

  let cursor = 0;
  const out: P3[] = [];
  const meta: string[] = [];
  for (const neu of data.neurons) {
    const npName =
      neu.region === "brain"
        ? names[brainIdx.v++]
        : names[24 + vncIdx.v++]; // brain assignments occupy first 24 slots
    const np = neuropilByName(npName);
    meta.push(npName);

    // local cloud = this neuron's stored final coords
    const local: P3[] = [];
    for (let k = 0; k < neu.count; k++) local.push(data.points[cursor + k]);

    // PCA → local axes + centroid
    const { axes, center } = pca(local);
    // project to principal frame, normalize to [-1,1] box per axis
    const proj: P3[] = local.map((pt) => {
      const d: P3 = [pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]];
      return orient(d, axes);
    });
    const ext = [1e-6, 1e-6, 1e-6];
    for (const q of proj) {
      ext[0] = Math.max(ext[0], Math.abs(q[0]));
      ext[1] = Math.max(ext[1], Math.abs(q[1]));
      ext[2] = Math.max(ext[2], Math.abs(q[2]));
    }
    const unit = proj.map((q) => [q[0] / ext[0], q[1] / ext[1], q[2] / ext[2]]) as P3[];

    // place inside neuropil ellipsoid (arbor fills the neuropil volume)
    const k2 = 0.86; // fill factor
    for (const u of unit) {
      out.push([
        Math.round((np.cx + u[0] * np.rx * k2) * 1000) / 1000,
        Math.round((np.cy + u[1] * np.ry * k2) * 1000) / 1000,
        Math.round((np.cz + u[2] * np.rz * k2) * 1000) / 1000,
      ]);
    }
    cursor += neu.count;
    console.log(`  ${neu.name.slice(0, 28).padEnd(28)} → ${npName}`);
  }

  data.points = out;
  (data as Dataset & { neuropils?: string[] }).neuropils = meta;
  (data as Dataset & { atlas?: string }).atlas =
    "Neuropil positions: JRC2018-relative approximations (Bogovic 2020 / Schlegel 2024)";
  fs.writeFileSync(p, JSON.stringify(data));
  console.log(`WROTE ${p} — ${out.length} nodes across ${NEUROPHILS.length} possible neuropils`);
}

relayout("fly-neurons-wire.json", 101);
relayout("fly-neurons-janelia.json", 202);
console.log("DONE");
