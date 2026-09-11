/**
 * LIF brain core — shared by the offline trainer and the live runtime.
 *
 * Nodes: leaky integrate-and-fire points sitting on real neural cables.
 * Edges: directed synapses built from real reconstruction cable edges, each
 * with a signed weight and an STDP eligibility trace.
 *
 * Time: the caller steps the network in fixed substeps (SUBSTEPS_PER_STEP per
 * musical 16th). A GLOBAL substep clock drives refractory + trace decay, so
 * state never wraps. Deterministic given the seed.
 */

export interface GraphData {
  points: [number, number, number][];
  edges: [number, number][];
  neuronCount: number;
}

export interface BrainBuildOptions {
  seed: number;
  /** nodes (by global index) that receive sensory spikes, grouped by channel */
  inputGroups: number[][];
  /** nodes whose spikes are read out as music, grouped by channel */
  motorGroups: number[][];
  /** probability that a synapse is inhibitory */
  inhibitoryRatio?: number;
}

export const SUBSTEPS_PER_STEP = 4;

export interface Weights {
  n: number;
  adjStart: number[];
  adjPost: number[];
  adjW: number[];
  revStart: number[];
  revPre: number[];
  revE: number[];
  inputGroups: number[][];
  motorGroups: number[][];
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

const W_MAX_EXC = 0.4;
const W_MIN_INH = -0.6;

export class LIFBrain {
  n: number;
  v: Float32Array;
  refracUntil: Int32Array; // absolute global substep
  adjStart: Uint32Array;
  adjPost: Uint32Array;
  adjW: Float32Array;
  adjE: Float32Array;
  preTrace: Float32Array;
  postTrace: Float32Array;
  revStart: Uint32Array;
  revPre: Uint32Array;
  revE: Float32Array;
  inputGroups: number[][];
  motorGroups: number[][];
  private tSub = 0;
  private rng: () => number;
  private rngState: number;
  /** delivered-weight multiplier — runtime cascade gain (training uses 1) */
  wGain = 1;
  /** membrane leak per substep */
  leak = 0.12;
  thresh = new Float32Array(0);
  recent = new Float32Array(0);
  /** absolute substep of last fire per node */
  lastFire = new Float32Array(0);

  constructor(graph: GraphData, opts: BrainBuildOptions) {
    this.rng = mulberry32(opts.seed);
    this.rngState = (opts.seed ^ 0x9e3779b9) >>> 0;
    const n = (this.n = graph.points.length);
    const inh = opts.inhibitoryRatio ?? 0.18;

    // directed synapses: both directions of every real cable edge
    const src: number[] = [];
    const dst: number[] = [];
    const wts: number[] = [];
    for (const [a, b] of graph.edges) {
      for (const [f, t] of [
        [a, b],
        [b, a],
      ]) {
        src.push(f);
        dst.push(t);
        wts.push(this.rng() < inh ? -(0.12 + this.rng() * 0.3) : 0.06 + this.rng() * 0.16);
      }
    }

    // forward CSR
    const counts = new Uint32Array(n + 1);
    for (let k = 0; k < src.length; k++) counts[src[k] + 1]++;
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    this.adjStart = counts;
    const cur = counts.slice(0, n);
    this.adjPost = new Uint32Array(src.length);
    this.adjW = new Float32Array(src.length);
    this.adjE = new Float32Array(src.length);
    this.preTrace = new Float32Array(n);
    this.postTrace = new Float32Array(n);
    for (let k = 0; k < src.length; k++) {
      const p = cur[src[k]]++;
      this.adjPost[p] = dst[k];
      this.adjW[p] = wts[k];
    }

    // reverse CSR (for post-side anti-causal STDP)
    const rc = new Uint32Array(n + 1);
    for (let k = 0; k < src.length; k++) rc[dst[k] + 1]++;
    for (let i = 0; i < n; i++) rc[i + 1] += rc[i];
    this.revStart = rc;
    const rcur = rc.slice(0, n);
    this.revPre = new Uint32Array(src.length);
    this.revE = new Float32Array(src.length);
    for (let k = 0; k < src.length; k++) {
      const p = rcur[dst[k]]++;
      this.revPre[p] = src[k];
    }

    this.v = new Float32Array(n);
    this.refracUntil = new Int32Array(n);
    this.recent = new Float32Array(n);
    this.lastFire = new Float32Array(n).fill(-1e9);
    // heterogeneous excitability: thresholds 0.55..0.95 (real neurons vary)
    this.thresh = new Float32Array(n);
    for (let i = 0; i < n; i++) this.thresh[i] = 0.55 + (i % 7) * 0.055;
    this.inputGroups = opts.inputGroups;
    this.motorGroups = opts.motorGroups;
  }

  /** xorshift32 — distinct value every call */
  private rand(): number {
    let a = this.rngState;
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    this.rngState = a >>> 0;
    return a / 4294967296;
  }

  stimulate(channel: number, count = 14, energy = 0.85) {
    const g = this.inputGroups[channel % this.inputGroups.length];
    for (let k = 0; k < count; k++) {
      const i = g[(this.rand() * g.length) | 0];
      this.v[i] += energy;
    }
  }

  /** global weak stimulation — background synaptic hum across all regions */
  stimulateAmbient(count: number, energy: number) {
    for (let k = 0; k < count; k++) {
      const i = (this.rand() * this.n) | 0;
      this.v[i] += energy;
    }
  }

  teach(channel: number, count = 10) {
    const g = this.motorGroups[channel % this.motorGroups.length];
    for (let k = 0; k < count; k++) {
      const i = g[(this.rand() * g.length) | 0];
      if (this.refracUntil[i] <= this.tSub) {
        this.v[i] = 1.2; // above threshold → fires next substep
      }
    }
  }

  /** one integration substep; returns spiking node indices */
  substep(): number[] {
    const spikes: number[] = [];
    const t = this.tSub;
    // decay pairing traces
    for (let i = 0; i < this.n; i++) {
      if (this.recent[i] > 0.001) this.recent[i] *= 0.93;
      if (this.preTrace[i] > 0.001) this.preTrace[i] *= 0.85;
      if (this.postTrace[i] > 0.001) this.postTrace[i] *= 0.85;
    }
    for (let i = 0; i < this.n; i++) {
      if (this.refracUntil[i] > t) continue;
      this.v[i] += -this.v[i] * this.leak;
      if (this.v[i] >= this.thresh[i]) {
        this.v[i] = -0.2;
        this.refracUntil[i] = t + 2;
        this.recent[i] = 1;
        this.lastFire[i] = t;
        spikes.push(i);
      }
    }
    // STDP pairing (on pre spike): causal if post not recently fired
    for (const pre of spikes) {
      this.preTrace[pre] = 1;
      const from = this.adjStart[pre];
      const to = this.adjStart[pre + 1];
      for (let k = from; k < to; k++) {
        this.adjE[k] += 1 - this.postTrace[this.adjPost[k]];
        const post = this.adjPost[k];
        if (this.refracUntil[post] <= t) this.v[post] += this.adjW[k] * this.wGain;
      }
    }
    // STDP pairing (on post spike): punish inputs that fired too late
    for (const post of spikes) {
      this.postTrace[post] = 1;
      const from = this.revStart[post];
      const to = this.revStart[post + 1];
      for (let k = from; k < to; k++) {
        this.revE[k] += 1.2 * this.preTrace[this.revPre[k]] - 1;
      }
    }
    this.tSub++;
    return spikes;
  }

  /** decay eligibility traces (call once per musical step) */
  decayTraces(decay = 0.9) {
    for (let k = 0; k < this.adjE.length; k++) {
      const e = this.adjE[k];
      if (e > 0.001 || e < -0.001) this.adjE[k] = e * decay;
    }
    for (let k = 0; k < this.revE.length; k++) {
      const e = this.revE[k];
      if (e > 0.001 || e < -0.001) this.revE[k] = e * decay;
    }
  }

  /** reward-modulated update. causal pairings ↑, late pairings ↓. */
  applyPlasticity(dopamine: number, lr: number) {
    if (dopamine === 0) return;
    const d = dopamine > 0 ? dopamine : dopamine * 0.4; // punish softer than reward
    for (let k = 0; k < this.adjW.length; k++) {
      const e = this.adjE[k] + this.revE[k];
      if (e > 0.02 || e < -0.02) {
        let w = this.adjW[k] + lr * d * e;
        if (w > W_MAX_EXC) w = W_MAX_EXC;
        else if (w < W_MIN_INH) w = W_MIN_INH;
        this.adjW[k] = w;
        this.adjE[k] = 0;
        this.revE[k] = 0;
      }
    }
  }

  /** advance one musical 16th; returns spike counts per motor channel */
  step(): Map<number, number> {
    return this.stepDetailed().counts;
  }

  /** full readout: motor channel counts + how much of the brain fired overall */
  stepDetailed(): { counts: Map<number, number>; motorSpikes: number; centralSpikes: number } {
    const counts = new Map<number, number>();
    let motorSpikes = 0;
    let centralSpikes = 0;
    for (let sub = 0; sub < SUBSTEPS_PER_STEP; sub++) {
      const spikes = this.substep();
      for (const i of spikes) {
        let isMotor = false;
        for (let c = 0; c < this.motorGroups.length; c++) {
          if (binarySearch(this.motorGroups[c], i) >= 0) {
            counts.set(c, (counts.get(c) ?? 0) + 1);
            motorSpikes++;
            isMotor = true;
          }
        }
        if (!isMotor) centralSpikes++;
      }
    }
    this.decayTraces();
    return { counts, motorSpikes, centralSpikes };
  }

  /** strengthen the trailing N synapses (used for grafted descending axons) */
  boostLastEdges(count: number, min: number, range: number) {
    const start = Math.max(0, this.adjW.length - count);
    for (let k = start; k < this.adjW.length; k++) {
      if (this.adjW[k] > 0) this.adjW[k] = min + this.rand() * range;
    }
  }

  private partValue = 0;

  /**
   * fraction of nodes that fired within the last `window` substeps
   * (64 substeps = one bar) — "80% of the brain is working" means ≥ 0.8 here.
   */
  participation(windowSubsteps = 256): number {
    let c = 0;
    const t = this.tSub;
    for (let i = 0; i < this.n; i++) {
      if (t - this.lastFire[i] < windowSubsteps) c++;
    }
    this.partValue = c / Math.max(1, this.n);
    return this.partValue;
  }

  exportWeights(): Weights {
    return {
      n: this.n,
      adjStart: Array.from(this.adjStart),
      adjPost: Array.from(this.adjPost),
      adjW: Array.from(this.adjW, (x) => Math.round(x * 1000) / 1000),
      revStart: Array.from(this.revStart),
      revPre: Array.from(this.revPre),
      revE: Array.from(this.revE),
      inputGroups: this.inputGroups,
      motorGroups: this.motorGroups,
    };
  }

  loadWeights(w: Weights) {
    if (w.n !== this.n) throw new Error(`weights node mismatch: ${w.n} vs ${this.n}`);
    this.adjStart.set(w.adjStart);
    this.adjPost.set(w.adjPost);
    this.adjW.set(w.adjW);
    this.revStart.set(w.revStart);
    this.revPre.set(w.revPre);
    this.inputGroups = w.inputGroups;
    this.motorGroups = w.motorGroups;
  }
}

export function binarySearch(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === x) return mid;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Build input/motor groups + graph from a morphology dataset. */
export function buildGraphFromDataset(
  data: {
    points: [number, number, number][];
    edges: [number, number][];
    neurons: { region: "brain" | "vnc"; count: number }[];
  },
  opts: { seed: number; inputPerChannel: number; motorPerChannel: number; channels: number }
): { graph: GraphData; inputGroups: number[][]; motorGroups: number[][]; descendingEdges: number } {
  const rand = mulberry32(opts.seed);
  const brainNodes: number[] = [];
  const vncNodes: number[] = [];
  let cursor = 0;
  for (const neu of data.neurons) {
    for (let k = 0; k < neu.count; k++) {
      (neu.region === "vnc" ? vncNodes : brainNodes).push(cursor + k);
    }
    cursor += neu.count;
  }
  const shuffle = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  shuffle(brainNodes);
  shuffle(vncNodes);
  const inputGroups: number[][] = [];
  for (let c = 0; c < opts.channels; c++) {
    inputGroups.push(brainNodes.slice(c * opts.inputPerChannel, (c + 1) * opts.inputPerChannel));
  }
  const motorGroups: number[][] = [];
  for (let c = 0; c < opts.channels; c++) {
    // sorted ascending — binarySearch membership depends on it
    motorGroups.push(vncNodes.slice(c * opts.motorPerChannel, (c + 1) * opts.motorPerChannel).sort((a, b) => a - b));
  }
  // Modeled descending neurons: real fly CNS routes brain→VNC through a small
  // population of descending axons; cable-only reconstructions lack them, so we
  // graft a sparse set (declared in PHILOSOPHY.md / PROVENANCE.md). Targets =
  // motor pools (that is what descending neurons synapse onto), dense enough
  // that every motor neuron converges multiple descending inputs.
  const extra: [number, number][] = [];
  const descenders = brainNodes.slice(0, Math.min(200, brainNodes.length));
  const allMotor = motorGroups.flat();
  for (const pre of descenders) {
    for (let k = 0; k < 25; k++) {
      extra.push([pre, allMotor[(rand() * allMotor.length) | 0]]);
    }
  }
  return {
    graph: { points: data.points, edges: [...data.edges, ...extra], neuronCount: data.neurons.length },
    inputGroups,
    motorGroups,
    descendingEdges: extra.length,
  };
}
