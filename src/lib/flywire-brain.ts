/**
 * FlyWire FAFB v783 whole-brain loader.
 *
 * Consumes the binary bundles produced by scripts/build-flywire.py:
 *   flywire-topology.bin        shared graph (both DJs fly the same real brain)
 *   flywire-weights-{fly}.bin   per-fly trained synapse weights (int8)
 *
 * Everything in these files is measured data: 139,255 proofread neurons of
 * the adult fruit fly brain and 15,071,499 real directed chemical
 * connections with neurotransmitter-derived signs.
 */
import { LIFBrain } from "./brain/core";

export interface FlywireTopology {
  n: number;
  edgeCount: number;
  adjStart: Uint32Array;   // n + 1
  adjPost: Uint32Array;    // edgeCount
  positions: Float32Array; // n * 3
  sensory: Uint32Array[];  // 4 real input populations
  motor: Uint32Array[];    // 4 real high-output populations
}

const TOPOLOGY_HEADER = 8 * 4 + 8; // magic/version/n/unused + edgeCount u64
const WEIGHTS_HEADER = 2 * 4 + 4;

export function parseTopology(buf: ArrayBuffer): FlywireTopology {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== 0x464c5957) throw new Error("flywire topology: bad magic");
  const n = view.getUint32(8, true);
  const edgeCount = Number(view.getBigUint64(16, true));
  let off = TOPOLOGY_HEADER;
  const adjStart = new Uint32Array(buf.slice(off, off + (n + 1) * 4));
  off += (n + 1) * 4;
  const deltas = new Uint16Array(buf.slice(off, off + edgeCount * 2));
  off += edgeCount * 2;
  const positions = new Float32Array(buf.slice(off, off + n * 12));
  off += n * 12;
  const groupCounts = new Uint32Array(buf.slice(off, off + 8 * 4));
  off += 8 * 4;
  const sensory: Uint32Array[] = [];
  const motor: Uint32Array[] = [];
  for (let g = 0; g < 8; g++) {
    const count = groupCounts[g];
    const arr = new Uint32Array(buf.slice(off, off + count * 4));
    off += count * 4;
    (g < 4 ? sensory : motor).push(arr);
  }
  // expand per-neuron u16 deltas back into absolute targets
  const adjPost = new Uint32Array(edgeCount);
  for (let pre = 0; pre < n; pre++) {
    const from = adjStart[pre];
    const to = adjStart[pre + 1];
    let acc = 0;
    for (let k = from; k < to; k++) {
      acc += deltas[k];
      adjPost[k] = acc;
    }
  }
  return { n, edgeCount, adjStart, adjPost, positions, sensory, motor };
}

export function parseWeights(buf: ArrayBuffer): { w: Float32Array; scale: number } {
  const view = new DataView(buf);
  const scale = view.getFloat32(8, true);
  const q = new Int8Array(buf.slice(WEIGHTS_HEADER));
  const w = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) w[i] = q[i] * scale;
  return { w, scale };
}

export async function loadFlywireTopology(version: number): Promise<FlywireTopology> {
  const res = await fetch(`/data/flywire-topology.bin?v=${version}`);
  if (!res.ok) throw new Error(`flywire topology HTTP ${res.status}`);
  return parseTopology(await res.arrayBuffer());
}

export async function loadFlywireWeights(fly: "wire" | "janelia", version: number): Promise<Float32Array> {
  const res = await fetch(`/data/flywire-weights-${fly}.bin?v=${version}`);
  if (!res.ok) throw new Error(`flywire weights HTTP ${res.status}`);
  return parseWeights(await res.arrayBuffer()).w;
}

/**
 * Adopt the real connectome into a LIFBrain without touching the core class:
 * topology arrays are shared (read-only at runtime), weights are per-fly.
 * Motor pools keep the +0.35 threshold elevation — background noise can
 * never fire the output populations, only coordinated input does.
 */
export function buildFlywireBrain(
  topo: FlywireTopology,
  w: Float32Array,
  opts: { seed: number; learning: boolean; leak?: number },
): LIFBrain {
  const brain = new LIFBrain(
    { points: new Array(topo.n).fill(0) as [number, number, number][], edges: [], neuronCount: topo.n },
    { seed: opts.seed, inputGroups: topo.sensory as unknown as number[][], motorGroups: topo.motor as unknown as number[][] }
  );
  brain.n = topo.n;
  brain.adjStart = topo.adjStart;   // shared, read-only
  brain.adjPost = topo.adjPost;     // shared, read-only
  brain.adjW = w;                   // per-fly
  brain.revStart = new Uint32Array(0); // STDP-only; unused at runtime
  brain.revPre = new Uint32Array(0);
  brain.revE = new Float32Array(0);
  brain.revPair = new Int32Array(0);
  brain.v = new Float32Array(topo.n);
  brain.refracUntil = new Int32Array(topo.n);
  brain.recent = new Float32Array(topo.n);
  brain.preTrace = new Float32Array(topo.n);
  brain.postTrace = new Float32Array(topo.n);
  brain.lastFire = new Float32Array(topo.n).fill(-1e9);
  brain.thresh = new Float32Array(topo.n);
  for (let i = 0; i < topo.n; i++) brain.thresh[i] = 0.30 + (i % 7) * 0.03;
  for (const pool of topo.motor) {
    for (const i of pool) brain.thresh[i] += 0.35;
  }
  brain.wGain = 1;
  brain.leak = opts.leak ?? 0.1;
  brain.inputGroups = topo.sensory as unknown as number[][];
  brain.motorGroups = topo.motor as unknown as number[][];
  brain.learning = opts.learning;
  return brain;
}
