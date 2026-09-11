/**
 * Fly CNS spiking network — FLYTAPE neural activity feed.
 *
 * REAL MORPHOLOGIES: on boot, loads /data/fly-neurons.json — 36 actual
 * Drosophila melanogaster neuron reconstructions (24 brain + 12 ventral
 * nerve cord; EM labs Bock & Williams) downloaded from NeuroMorpho.org.
 * 15,120 sampled cable nodes with 15,084 REAL parent→child cable edges —
 * spikes propagate along the actual reconstructed neurites.
 *
 * Inter-neuron wiring: random sparse synapses biased brain→VNC
 * (the real connectome's 51.7M synapses are far beyond realtime scope;
 * per-neuron cable wiring here is genuine, cross-neuron wiring is modeled).
 *
 * If the fetch fails (offline), falls back to the procedural atlas and
 * says so in `realData`.
 */

export type Region = 0 | 1 | 2; // 0/1 = brain halves · 2 = VNC
export const REGION_OL = 0 as Region;
export const REGION_CX = 1 as Region;
export const REGION_VNC = 2 as Region;

const REVEAL_SECONDS = 0.8;
/** bump when regenerating public/data bundles — busts immutable browser cache */
export const DATA_VERSION = 6;

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface RealDataset {
  source: string;
  neuron_count: number;
  point_count: number;
  neurons: { name: string; archive: string; region: "brain" | "vnc"; count: number }[];
  points: [number, number, number][];
  edges: [number, number][];
}

export class NeuralSim {
  count = 9000; // replaced by real dataset size on load
  x = new Float32Array(9000);
  y = new Float32Array(9000);
  z = new Float32Array(9000); // depth → brightness
  region = new Uint8Array(9000);
  act = new Float32Array(9000);

  loadProgress = 0; // 0..1 — fetch (0..0.5) + reveal sweep (0.5..1)
  realData = false;
  info = { neurons: 0, points: 0, archives: [] as string[], source: "procedural atlas (offline fallback)" };

  private motorRateEma = 0;
  private thinkRateEma = 0;
  /** activity audit trail — most recent 400 events */
  audit: string[] = [];

  auditEvent(msg: string) {
    const t = (performance.now() / 1000).toFixed(1);
    this.audit.push(`[${t}s] ${msg}`);
    if (this.audit.length > 400) this.audit.shift();
  }

  private adjacency: Uint32Array = new Uint32Array(0); // CSR targets
  private offsets: Uint32Array = new Uint32Array(0); // CSR offsets
  private poolIdx: number[][] = [[], [], []];
  private revealed = 9000;
  /** undirected cable pairs from the real reconstructions — drawn as skeletons */
  edgeList: Uint32Array | null = null;
  /** total synapse degree per node — thick trunks vs thin branches */
  deg: Uint32Array = new Uint32Array(0);
  /** modeled inter-neuron synapses — the visible connectome web */
  synapseList: Uint32Array | null = null;
  /** per-node hue 0..1 — one distinct color per neuron (FlyWire-map look) */
  nodeHue: Float32Array = new Float32Array(0);
  /** bumped every time a dataset swaps in */
  dataVersion = 0;
  /** per-neuron {start, count} into the node arrays — root node = soma */
  neuronRanges: { start: number; count: number; region: "brain" | "vnc" }[] = [];

  private datasetUrl: string;

  constructor(datasetUrl: string | null = null) {
    this.datasetUrl = datasetUrl ?? "/data/fly-neurons.json";
    this.buildProcedural();
  }

  /** Immediate procedural atlas so the panel is alive before/without the fetch. */
  private buildProcedural() {
    const N = this.count;
    const i1 = Math.floor(N * 0.55);
    const i2 = Math.floor(N * 0.8);
    for (let i = 0; i < i1; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const bulge = Math.random() < 0.7;
      const bx = bulge ? 0.185 + side * 0.062 : 0.185 + side * 0.028;
      const by = bulge ? 0.42 + side * 0.13 : 0.42;
      this.x[i] = bx + gauss() * 0.032;
      this.y[i] = by + gauss() * 0.115;
      this.z[i] = Math.random();
      this.region[i] = REGION_OL;
      this.poolIdx[REGION_OL].push(i);
    }
    for (let i = i1; i < i2; i++) {
      this.x[i] = 0.185 + gauss() * 0.024;
      this.y[i] = 0.44 + gauss() * 0.07;
      this.z[i] = Math.random();
      this.region[i] = REGION_CX;
      this.poolIdx[REGION_CX].push(i);
    }
    for (let i = i2; i < N; i++) {
      const bead = i % 6;
      this.x[i] = 0.52 + bead * 0.083 + gauss() * 0.034;
      this.y[i] = 0.44 + gauss() * 0.04;
      this.z[i] = Math.random();
      this.region[i] = REGION_VNC;
      this.poolIdx[REGION_VNC].push(i);
    }
    this.wireSynapsesProcedural();
    this.revealed = N;
  }

  private wireSynapsesProcedural() {
    const N = this.count;
    const pairs: number[] = [];
    for (let i = 0; i < N; i++) {
      for (let t = 0; t < 2; t++) {
        let targetRegion: Region;
        if (this.region[i] === REGION_OL) targetRegion = Math.random() < 0.85 ? REGION_CX : REGION_VNC;
        else if (this.region[i] === REGION_CX) targetRegion = Math.random() < 0.75 ? REGION_VNC : REGION_CX;
        else targetRegion = REGION_VNC;
        const pool = this.poolIdx[targetRegion];
        pairs.push(i, pool[(Math.random() * pool.length) | 0]);
      }
    }
    this.buildCSR(pairs);
  }

  /** random neighbor along a real cable — pulses travel these */
  pulseTarget(i: number): number {
    const from = this.offsets[i];
    const to = this.offsets[i + 1];
    if (to <= from) return i;
    return this.adjacency[from + ((Math.random() * (to - from)) | 0)];
  }

  degree(i: number): number {
    return this.offsets[i + 1] - this.offsets[i];
  }

  private buildCSR(pairs: number[]) {
    let maxId = 0;
    for (let k = 1; k < pairs.length; k += 2) if (pairs[k] > maxId) maxId = pairs[k];
    for (let k = 0; k < pairs.length; k += 2) if (pairs[k] > maxId) maxId = pairs[k];
    const n = maxId + 1;
    const counts = new Uint32Array(n + 1);
    for (let k = 0; k < pairs.length; k += 2) counts[pairs[k] + 1]++;
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    const targets = new Uint32Array(pairs.length / 2);
    const cursor = counts.slice(0, n);
    for (let k = 0; k < pairs.length; k += 2) {
      targets[cursor[pairs[k]]++] = pairs[k + 1];
    }
    this.offsets = counts;
    this.adjacency = targets;
    // node degree (out + in) — trunk vs branch rendering
    const deg = new Uint32Array(this.count);
    for (let k = 0; k < pairs.length; k += 2) {
      deg[pairs[k]]++;
      deg[pairs[k + 1]]++;
    }
    this.deg = deg;
  }

  /** Fetch this fly's real morphologies and swap the atlas out from under the panel. */
  async loadReal(): Promise<boolean> {
    try {
      const res = await fetch(`${this.datasetUrl}?v=${DATA_VERSION}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RealDataset;
      const n = data.point_count;
      const x = new Float32Array(n);
      const y = new Float32Array(n);
      const z = new Float32Array(n);
      const region = new Uint8Array(n);
      const pools: number[][] = [[], [], []];

      let cursor = 0;
      for (const neu of data.neurons) {
        const r: Region = neu.region === "vnc" ? REGION_VNC : (cursor % 2 === 0 ? REGION_OL : REGION_CX);
        for (let k = 0; k < neu.count; k++) {
          const p = data.points[cursor + k];
          x[cursor + k] = p[0];
          y[cursor + k] = p[1];
          z[cursor + k] = p[2];
          region[cursor + k] = r;
          pools[r].push(cursor + k);
        }
        cursor += neu.count;
      }

      // real cable edges (both directions for back-propagation realism)
      const pairs: number[] = [];
      const undirected: number[] = [];
      for (const [a, b] of data.edges) {
        pairs.push(a, b);
        pairs.push(b, a);
        undirected.push(a, b);
      }
      this.edgeList = new Uint32Array(undirected);
      this.neuronRanges = [];
      this.nodeHue = new Float32Array(n);
      {
        let c = 0;
        for (let ni = 0; ni < data.neurons.length; ni++) {
          const neu = data.neurons[ni];
          // golden-angle hue spread — evenly distributed rainbow, FlyWire style
          const hue = (ni * 0.61803398875) % 1;
          for (let k = 0; k < neu.count; k++) this.nodeHue[c + k] = hue;
          this.neuronRanges.push({ start: c, count: neu.count, region: neu.region });
          c += neu.count;
        }
      }
      // modeled inter-neuron synapses (real FlyWire wiring queued): dense
      // enough to render as the web that fuses the arbors into one organ
      const brainNodes = pools[REGION_OL].concat(pools[REGION_CX]);
      const synapses: number[] = [];
      for (let i = 0; i < brainNodes.length; i++) {
        if (Math.random() < 0.22) {
          const target = Math.random() < 0.6 ? pools[REGION_VNC] : brainNodes;
          const t = target[(Math.random() * target.length) | 0];
          pairs.push(brainNodes[i], t);
          synapses.push(brainNodes[i], t);
        }
      }
      this.synapseList = new Uint32Array(synapses);
      // VNC local coupling
      for (let i = 0; i < pools[REGION_VNC].length; i += 3) {
        pairs.push(pools[REGION_VNC][i], pools[REGION_VNC][(i + 7) % pools[REGION_VNC].length]);
      }

      // swap in atomically
      this.x = x;
      this.y = y;
      this.z = z;
      this.region = region;
      this.act = new Float32Array(n);
      this.count = n;
      this.poolIdx = pools;
      this.buildCSR(pairs);
      this.realData = true;
      this.dataVersion++;
      this.auditEvent(`dataset loaded — ${data.neuron_count} real neurons, ${data.point_count} nodes`);
      const archives = Array.from(new Set(data.neurons.map((nn) => nn.archive)));
      this.info = {
        neurons: data.neuron_count,
        points: n,
        archives,
        source: data.source,
      };
      // reveal sweep
      const t0 = performance.now();
      return new Promise((resolve) => {
        const sweep = () => {
          const k = Math.min(1, (performance.now() - t0) / (REVEAL_SECONDS * 1000));
          this.loadProgress = 0.5 + k * 0.5;
          this.revealed = Math.floor(k * n);
          if (k < 1) requestAnimationFrame(sweep);
          else resolve(true);
        };
        this.loadProgress = 0.5;
        this.revealed = 0;
        requestAnimationFrame(sweep);
      });
    } catch {
      // offline / fetch failed — procedural atlas stays, honestly labeled
      this.realData = false;
      this.loadProgress = 1;
      this.revealed = this.count;
      return false;
    }
  }

  tick(dt: number) {
    if (this.loadProgress < 0.5 && !this.realData) {
      // still fetching — keep the procedural one charging to 0.5 max
      this.loadProgress = Math.min(0.5, this.loadProgress + dt / 3);
      return;
    }
    if (this.loadProgress >= 1) {
      this.loadProgress = 1;
    }
    const decay = Math.exp(-dt * 4.2);
    const act = this.act;
    const adj = this.adjacency;
    const off = this.offsets;
    let motorFires = 0;
    let centralFires = 0;
    for (let i = 0; i < this.count; i++) {
      const a = act[i];
      if (a > 0.05) {
        if (a > 0.6 && adj.length) {
          const spike = a * 0.055;
          const from = off[i];
          const to = off[i + 1];
          for (let k = from; k < to; k++) {
            if (Math.random() < 0.4) act[adj[k]] += spike;
          }
          // spike event — real reflections feed on these
          if (this.region[i] === REGION_VNC) motorFires++;
          else centralFires++;
        }
        act[i] = Math.min(1.6, a * decay);
      }
    }
    // EMA of firing rates — what the fly avatars express as movement
    const k = Math.min(1, dt * 4);
    this.motorRateEma += (Math.min(1, motorFires / 260) - this.motorRateEma) * k;
    this.thinkRateEma += (Math.min(1, centralFires / 200) - this.thinkRateEma) * k;
  }

  revealedCount(): number {
    return this.realData && this.loadProgress < 1 ? this.revealed : this.count;
  }

  inject(region: Region, energy: number, count = 260) {
    this.auditEvent(`sensory stimulus → region ${region} (${count} nodes, e=${energy.toFixed(2)})`);
    const pool = this.poolIdx[region];
    if (!pool.length) return;
    const limit = Math.max(1, Math.floor(pool.length * Math.min(1, this.loadProgress)));
    for (let k = 0; k < count; k++) {
      const idx = pool[(Math.random() * limit) | 0] ?? 0;
      this.act[idx] = Math.min(2.5, this.act[idx] + energy);
    }
  }

  cascade(energy = 1.4) {
    this.inject(REGION_OL, energy, Math.floor(this.count * 0.06));
    this.inject(REGION_CX, energy * 0.9, Math.floor(this.count * 0.045));
    this.inject(REGION_VNC, energy, Math.floor(this.count * 0.045));
  }

  motorLevel(): number {
    return this.poolLevel(REGION_VNC, 7, 0.5);
  }

  centralLevel(): number {
    return this.poolLevel(REGION_CX, 5, 0.7);
  }

  /** smoothed motor-population firing rate 0..1 — drives body movement */
  motorRate(): number {
    return this.motorRateEma;
  }

  /** smoothed central-brain firing rate 0..1 — drives attention/eye glow */
  thinkRate(): number {
    return this.thinkRateEma;
  }

  private poolLevel(region: Region, stride: number, gain: number): number {
    const pool = this.poolIdx[region];
    if (!pool.length) return 0;
    let sum = 0;
    for (let k = 0; k < pool.length; k += stride) sum += this.act[pool[k]];
    return Math.min(1, (sum / (pool.length / stride)) * gain);
  }
}

export const TOTAL_SOMATA = 140024;

/** Two independent brains — one per fly, each with its own real neurons + dynamics. */
export const flywireSim = new NeuralSim("/data/fly-neurons-wire.json");
export const janeliaSim = new NeuralSim("/data/fly-neurons-janelia.json");
export function bootNeuralSims() {
  void flywireSim.loadReal();
  void janeliaSim.loadReal();
}
