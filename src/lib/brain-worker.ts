/**
 * brain-worker — the whole fly brain, off the main thread.
 *
 * Owns both trained FlyWire brains (139,255 neurons, 15.07M measured
 * synapses each), the record crates, and all stepping math. The main
 * thread keeps only: AudioContext + voice synthesis, Three.js rendering,
 * React state. Communication is message-passing:
 *
 *   main → worker : load | step | bar | switch
 *   worker → main : ready | step | bar | switch | fire (lastFire snapshot)
 *
 * Everything crossing the boundary is plain JSON + transferable typed
 * arrays — the brains themselves never leave the worker.
 */
import { buildFlywireBrain, parseTopology, parseWeights, type FlywireTopology } from "./flywire-brain";
import {
  FLYWIRE_CORPUS, FLYWIRE_TRACK_B, FLYWIRE_TRACK_C, FLYWIRE_TRACK_D, FLYWIRE_TRACK_E, FLYWIRE_TRACK_F,
  JANELIA_CORPUS, JANELIA_TRACK_B, JANELIA_TRACK_C, JANELIA_TRACK_D, JANELIA_TRACK_E,
  JANELIA_TRACK_F, JANELIA_TRACK_G, JANELIA_TRACK_H, JANELIA_TRACK_I,
} from "./brain/corpus";
import { DATA_VERSION } from "./data-version";
import type { Corpus } from "./brain/corpus";
import type { LIFBrain } from "./brain/core";

export interface WorkerNote {
  fly: "wire" | "janelia";
  channel: number;
  voice: "kick" | "snare" | "hat" | "bass" | "ghost-kick" | "ghost-snare";
  count: number;
  /** semitones from A — corpus scale + fly register, computed worker-side */
  pitch: number;
}

export interface StepMsg {
  type: "step";
  notes: WorkerNote[];
  kick: boolean;
  snare: boolean;
  drive: Record<Fly, { motor: number; think: number }>;
  spikes: Record<Fly, { motor: number; central: number }>;
  dbg: Record<string, number>;
}

export interface BarMsg {
  type: "bar";
  counts: Record<Fly, number>;
  sync: number;
  utilWire: number;
  utilJanelia: number;
}

interface Crate {
  tracks: readonly Corpus[];
  seed: number;
}

const CRATES: Record<Fly, Crate> = {
  wire: {
    tracks: [FLYWIRE_CORPUS, FLYWIRE_TRACK_F, FLYWIRE_TRACK_D, FLYWIRE_TRACK_B, FLYWIRE_TRACK_E, FLYWIRE_TRACK_C],
    seed: 11,
  },
  janelia: {
    tracks: [JANELIA_CORPUS, JANELIA_TRACK_G, JANELIA_TRACK_H, JANELIA_TRACK_I, JANELIA_TRACK_D, JANELIA_TRACK_E, JANELIA_TRACK_B, JANELIA_TRACK_C],
    seed: 47,
  },
};

type Fly = "wire" | "janelia";

interface Player {
  brain: LIFBrain;
  crate: Crate;
  corpusIdx: number;
  ambient: number;
  improv: number;
  barSpikes: number;
  lastStep: { motor: number; central: number };
  drive: { motor: number; think: number };
}

const players: Partial<Record<Fly, Player>> = {};

function rand(p: Player): number {
  p.improv = (p.improv + 0x9e3779b9) | 0;
  let t = Math.imul(p.improv ^ (p.improv >>> 16), 0x45d9f3b);
  t = Math.imul(t ^ (t >>> 16), 0x45d9f3b);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function corpusOf(p: Player): Corpus {
  return p.crate.tracks[p.corpusIdx];
}

function makePlayer(
  fly: Fly,
  w: Float32Array,
  topoData: FlywireTopology,
  trained: { ambient: number; wGain: number },
): Player {
  const crate = CRATES[fly];
  // EXACTLY the training build (scripts/train-flywire.ts): leak 0.12,
  // motor elevation 0.15 — plus the calibrated gain the trainer exported.
  // wGain reaching the delivery loop is load-bearing: without it every
  // synapse fires 30% weaker than trained and the brain stays silent.
  const brain = buildFlywireBrain(topoData, w, {
    seed: crate.seed,
    learning: false,
    motorElevation: 0.15,
    leak: 0.12,
    wGain: trained.wGain,
  });

  const p: Player = {
    brain,
    crate,
    corpusIdx: 1, // the set opens on the IDM record
    ambient: trained.ambient,
    improv: 7,
    barSpikes: 0,
    lastStep: { motor: 0, central: 0 },
    drive: { motor: 0, think: 0 },
  };
  return p;
}

function nearScore(p: Player, cStep: number, channel: number): boolean {
  const corpus = corpusOf(p);
  const on = corpus.pitches?.[channel] ? corpus.onsets[channel] : undefined;
  if (!on) return true; // unscored channel (rhythm) — bursts voice freely
  for (const o of on) {
    const d = Math.abs(cStep - o);
    if (d <= 1 || d >= 31) return true; // 32-step wraparound
  }
  return false;
}

function pitchFor(p: Player, cStep: number, channel: number): number {
  const corpus = corpusOf(p);
  const on = corpus.onsets[channel % corpus.onsets.length];
  const pit = corpus.pitches?.[channel];
  if (!on || !pit) return 0;
  let bestIdx = 0;
  let bestD = 99;
  for (let i = 0; i < on.length; i++) {
    const d = Math.abs(cStep - on[i]);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  const scale = corpus.scale ?? [0, 3, 5, 7, 10, 12, 15, 17];
  return scale[pit[bestIdx % pit.length] % scale.length] ?? 0;
}

function stepPlayer(p: Player, cStep: number, fly: Fly): Map<number, number> {
  const corpus = corpusOf(p);
  for (let ch = 0; ch < corpus.channels; ch++) {
    const on = corpus.onsets[ch].includes(cStep);
    if (on && rand(p) < 0.97) {
      // training-matched stimulation (train.ts generation pass): count ≈ 40
      // with light humanization, energy ≈ 1.15-1.25. The old runtime fired
      // 3-4× harder and seized the network; the trained regime is this.
      p.brain.stimulate(ch, 34 + ((rand(p) * 12) | 0), 1.15 + rand(p) * 0.1);
    } else if (!on && rand(p) < 0.12) {
      // spontaneous off-grid thought
      p.brain.stimulate(ch, 12 + ((rand(p) * 10) | 0), 0.85);
    }
  }
  // ambient synaptic hum — ONCE per step, exactly like training (the
  // per-channel loop hummed 4× the calibrated density and over-drove it).
  // Sub-threshold (0.18 < min threshold 0.30): biases excitability only.
  p.brain.stimulateAmbient(p.ambient, 0.18);
  const d = p.brain.stepDetailed();
  p.lastStep = { motor: d.motorSpikes, central: d.centralSpikes };
  // EMA drive — what the fly body + telemetry express
  const k = 0.18;
  p.drive.motor += (Math.min(1, d.motorSpikes / 12) - p.drive.motor) * k;
  p.drive.think += (Math.min(1, d.centralSpikes / 40) - p.drive.think) * k;
  return d.counts;
}

function motorSample(p: Player): number {
  return p.brain.motorGroups[0]?.[0] ?? 0;
}

function participation(p: Player): number {
  const brain = p.brain;
  const t = brain.clock;
  let c = 0;
  for (let i = 0; i < brain.n; i++) {
    if (t - brain.lastFire[i] < 64) c++; // fired within the LAST BAR — honest "now"
  }
  return c / Math.max(1, brain.n);
}

/** accepts legacy number format (hum only) and current {ambient, wGain} */
function normalizeTrained(v: unknown): { ambient: number; wGain: number } {
  if (typeof v === "number") return { ambient: v, wGain: 1.7 };
  const o = (v ?? {}) as { ambient?: number; wGain?: number };
  return { ambient: o.ambient ?? 4000, wGain: o.wGain ?? 1.7 };
}

interface MorphologyDonor {
  neurons: { region: "brain" | "vnc"; count: number }[];
  points: [number, number, number][];
}

/** render region classes — must match neural-sim's REGION_* numbering */
const R_OL = 0, R_CX = 1, R_VNC = 2;

/**
 * Place EVERY real neuron inside the fly-CNS morphology envelope (the
 * NeuroMorpho reconstructions whose silhouette the stage renders).
 * Stratified by donor density: each morphology point hosts ~n/M real
 * neurons with arbor-thickness jitter, so the 139k cloud reproduces the
 * morphology silhouette exactly, 10× denser. One rendered dot = one real
 * neuron; only its drawn coordinates are projected — wiring stays the real
 * connectome. Deterministic per-fly seed.
 */
function shapeIntoMorphology(
  n: number,
  donor: MorphologyDonor,
  seed: number,
): { positions: Float32Array; regions: Uint8Array } {
  const m = donor.points.length;

  let s = seed | 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const positions = new Float32Array(n * 3);
  const regions = new Uint8Array(n);
  const jitter = 0.012; // ~arbor thickness — keeps the silhouette readable
  for (let k = 0; k < n; k++) {
    const p = donor.points[Math.min(m - 1, Math.floor((k * m) / n))];
    const jx = (rand() - 0.5) * 2 * jitter;
    const jy = (rand() - 0.5) * 2 * jitter;
    const jz = (rand() - 0.5) * 2 * jitter;
    positions[k * 3] = p[0] + jx;
    positions[k * 3 + 1] = p[1] + jy;
    positions[k * 3 + 2] = p[2] + jz;
    // region follows the DRAWN position so coloring/pools match the layout:
    // cord stalk below y≈-0.2, optic lobes lateral, else central brain
    const y = p[1] + jy;
    const x = p[0] + jx;
    regions[k] = y <= -0.2 ? R_VNC : Math.abs(x) >= 0.18 ? R_OL : R_CX;
  }
  return { positions, regions };
}

async function fetchMorphology(fly: string): Promise<MorphologyDonor> {
  return (await (await fetch(`/data/fly-neurons-${fly}.json?v=${DATA_VERSION}`)).json()) as MorphologyDonor;
}

interface VisualBundle {
  positions: Float32Array;
  regions: Uint8Array;
  adjStart: Uint32Array;
  edgeSample: Uint32Array;
  n: number;
}

async function load(): Promise<{ topoData: FlywireTopology; visuals: Record<Fly, VisualBundle> }> {
  const [topoData, ambient, ww, wj, morphW, morphJ] = await Promise.all([
    parseTopology((await (await fetch(`/data/flywire-topology.bin?v=${DATA_VERSION}`)).arrayBuffer())),
    (await (await fetch(`/data/flywire-ambient.json?v=${DATA_VERSION}`)).json()) as Record<string, unknown>,
    parseWeights((await (await fetch(`/data/flywire-weights-wire.bin?v=${DATA_VERSION}`)).arrayBuffer())).w,
    parseWeights((await (await fetch(`/data/flywire-weights-janelia.bin?v=${DATA_VERSION}`)).arrayBuffer())).w,
    fetchMorphology("wire"),
    fetchMorphology("janelia"),
  ]);
  players.wire = makePlayer("wire", ww, topoData, normalizeTrained(ambient.wire));
  players.janelia = makePlayer("janelia", wj, topoData, normalizeTrained(ambient.janelia));

  // visuals: per-fly shaped positions inside the real morphology envelope
  const wireShaped = shapeIntoMorphology(topoData.n, morphW, 101);
  const janeliaShaped = shapeIntoMorphology(topoData.n, morphJ, 9047);
  const adjStart = new Uint32Array(topoData.adjStart);
  const edgeSample: number[] = [];
  const cap = 60000;
  // neuron-strided: every ~n/cap-th neuron contributes its first real edge —
  // spread across the whole graph (an edge-count stride starved the sample)
  const stride = Math.max(1, Math.floor(topoData.n / cap));
  for (let pre = 0; pre < topoData.n && edgeSample.length < cap * 2; pre++) {
    if (pre % stride !== 0) continue;
    const from = topoData.adjStart[pre];
    const to = topoData.adjStart[pre + 1];
    if (to > from) edgeSample.push(pre, topoData.adjPost[from]);
  }
  const sample = new Uint32Array(edgeSample);
  const visuals: Record<Fly, VisualBundle> = {
    wire: { positions: wireShaped.positions, regions: wireShaped.regions, adjStart, edgeSample: sample, n: topoData.n },
    janelia: { positions: janeliaShaped.positions, regions: janeliaShaped.regions, adjStart, edgeSample: sample, n: topoData.n },
  };
  return { topoData, visuals };
}

function trackNames() {
  const w = players.wire, j = players.janelia;
  if (!w || !j) return null;
  return { wire: corpusOf(w).style, janelia: corpusOf(j).style };
}

// ---- graphics state: glow + pulses are computed HERE at 10 Hz so the main
// thread never loops over 139k nodes — it only uploads the buffers ----
const GFX_INTERVAL_MS = 100;
const FLASH_SUBSTEPS = 17; // ~1s total at 128 BPM: 2-substep rise, plateau, 3-substep fall
const FLASH_ATTACK = 2;
const FLASH_RELEASE = 3;
const MAX_PULSES = 160;
interface GfxPulse { on: boolean; a: number; b: number; t: number; speed: number }
interface GfxState {
  positions: Float32Array; // shaped copy (the original is transferred away)
  edges: Uint32Array;      // sampled skeleton for pulse paths
  glow: Float32Array;      // scratch, transferred each tick
  pulsePos: Float32Array;
  pulseAlpha: Float32Array;
  pulses: GfxPulse[];
  lastPost: number;
}
const gfx: Partial<Record<Fly, GfxState>> = {};

function initGfx(fly: Fly, positions: Float32Array, edges: Uint32Array) {
  const pulses: GfxPulse[] = [];
  for (let i = 0; i < MAX_PULSES; i++) pulses.push({ on: false, a: 0, b: 0, t: 0, speed: 1 });
  gfx[fly] = {
    positions: new Float32Array(positions),
    edges: new Uint32Array(edges),
    glow: new Float32Array(positions.length / 3),
    pulsePos: new Float32Array(MAX_PULSES * 3),
    pulseAlpha: new Float32Array(MAX_PULSES),
    pulses,
    lastPost: 0,
  };
}

function spawnPulses(fly: Fly, count: number) {
  const g = gfx[fly];
  if (!g) return;
  const edgeCount = g.edges.length / 2;
  if (!edgeCount) return;
  for (let k = 0; k < count; k++) {
    const p = g.pulses.find((q) => !q.on);
    if (!p) return; // pool exhausted — skip silently
    const e = (Math.random() * edgeCount) | 0;
    p.on = true;
    p.a = g.edges[e * 2];
    p.b = g.edges[e * 2 + 1];
    p.t = 0;
    p.speed = 1.2 + Math.random() * 1.6;
  }
}

/** build the 10 Hz graphics snapshot: one-time flash glow + traveling pulses */
function gfxTick(fly: Fly, now: number) {
  const g = gfx[fly];
  const p = players[fly];
  if (!g || !p) return;
  const dt = Math.min(0.25, (now - g.lastPost) / 1000 || GFX_INTERVAL_MS / 1000);
  g.lastPost = now;

  // glow: ONE-TIME flash per real spike — smooth rise, ~1s plateau, smooth
  // release, then dark. Envelope shaped here so the main thread never can.
  const clock = p.brain.clock;
  const lastFire = p.brain.lastFire;
  const glow = g.glow;
  for (let i = 0; i < glow.length; i++) {
    const since = clock - lastFire[i];
    if (since < 0 || since >= FLASH_SUBSTEPS) {
      glow[i] = 0;
      continue;
    }
    let v = 1;
    if (since < FLASH_ATTACK) v = since / FLASH_ATTACK;
    else if (since >= FLASH_SUBSTEPS - FLASH_RELEASE) v = (FLASH_SUBSTEPS - since) / FLASH_RELEASE;
    glow[i] = v * 1.3;
  }

  // pulses: advance the travelers, write positions/alphas
  for (let i = 0; i < g.pulses.length; i++) {
    const q = g.pulses[i];
    if (!q.on) {
      g.pulseAlpha[i] = 0;
      continue;
    }
    q.t += dt * q.speed;
    if (q.t >= 1) {
      q.on = false;
      g.pulseAlpha[i] = 0;
      continue;
    }
    const ax = g.positions[q.a * 3], ay = g.positions[q.a * 3 + 1], az = g.positions[q.a * 3 + 2];
    g.pulsePos[i * 3] = ax + (g.positions[q.b * 3] - ax) * q.t;
    g.pulsePos[i * 3 + 1] = ay + (g.positions[q.b * 3 + 1] - ay) * q.t;
    g.pulsePos[i * 3 + 2] = az + (g.positions[q.b * 3 + 2] - az) * q.t;
    g.pulseAlpha[i] = 1 - q.t;
  }

  const glowOut = new Float32Array(glow); // fresh buffer per post (transferred)
  const posOut = new Float32Array(g.pulsePos);
  const alphaOut = new Float32Array(g.pulseAlpha);
  ctx.postMessage({ type: "gfx", fly, tSub: clock, glow: glowOut, pulsePos: posOut, pulseAlpha: alphaOut }, [
    glowOut.buffer, posOut.buffer, alphaOut.buffer,
  ]);
}

// worker global scope — DOM lib types `self` as Window, whose postMessage
// wants a targetOrigin; the DedicatedWorker overload takes transferables.
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let lastGfxPost = 0;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; cStep?: number; switch?: boolean };
  try {
    if (msg.type === "load") {
      const { topoData, visuals } = await load();
      initGfx("wire", visuals.wire.positions, visuals.wire.edgeSample);
      initGfx("janelia", visuals.janelia.positions, visuals.janelia.edgeSample);
      const names = trackNames();
      ctx.postMessage(
        {
          type: "ready",
          trackNames: names ?? { wire: "", janelia: "" },
          n: topoData.n,
          wirePositions: visuals.wire.positions,
          wireRegions: visuals.wire.regions,
          janeliaPositions: visuals.janelia.positions,
          janeliaRegions: visuals.janelia.regions,
          adjStart: visuals.wire.adjStart,
          edgeSample: visuals.wire.edgeSample,
        },
        [
          visuals.wire.positions.buffer, visuals.wire.regions.buffer,
          visuals.janelia.positions.buffer, visuals.janelia.regions.buffer,
          visuals.wire.adjStart.buffer, visuals.wire.edgeSample.buffer,
        ]
      );
      return;
    }

    const wire = players.wire;
    const janelia = players.janelia;
    if (!wire || !janelia) throw new Error("brains not loaded");

    if (msg.type === "step") {
      const cStep = msg.cStep ?? 0;
      const notes: WorkerNote[] = [];
      let kick = false;
      let snare = false;

      const bands = [
        ["wire", wire, [{ voice: "kick" }, { voice: "snare" }, { voice: "hat" }, { voice: "bass" }]],
        ["janelia", janelia, [{ voice: "ghost-kick" }, { voice: "ghost-snare" }, { voice: "hat" }, { voice: "bass" }]],
      ] as const;

      for (const [fly, p, voiceMap] of bands) {
        const counts = stepPlayer(p, cStep, fly);
        for (const [ch, count] of counts) {
          if (count < 3) continue; // ambient scatter stays silent — only bursts play
          if (!nearScore(p, cStep, ch)) continue; // scored channels snap to the score
          p.barSpikes += count;
          const m = voiceMap[ch] ?? { voice: "hat" as const };
          notes.push({ fly, channel: ch, voice: m.voice, count, pitch: pitchFor(p, cStep, ch) + (fly === "janelia" ? 12 : 0) });
          if (fly === "wire") {
            if (ch === 0) kick = true;
            if (ch === 1) snare = true;
          } else if (ch === 1) snare = true;
        }
      }

      const motorSampleIdx = wire.brain.motorGroups[0]?.[0] ?? 0;
      const msg2: StepMsg & { dbg: Record<string, number> } = {
        type: "step",
        notes,
        kick,
        snare,
        drive: { wire: { ...wire.drive }, janelia: { ...janelia.drive } },
        spikes: { wire: { ...wire.lastStep }, janelia: { ...janelia.lastStep } },
        dbg: {
          wm: wire.lastStep.motor,
          clock: wire.brain.clock,
          motorThr: wire.brain.thresh[motorSampleIdx],
          motorV: wire.brain.v[motorSampleIdx],
          motorLastFire: wire.brain.lastFire[motorSampleIdx],
        },
      };
      ctx.postMessage(msg2);

      // spawn a few travelers on voiced bursts — visuals follow real notes
      for (const n of notes) spawnPulses(n.fly, Math.min(4, 1 + (n.count / 40 | 0)));

      // 10 Hz graphics snapshots: glow + pulses computed here, zero-copy
      const now = performance.now();
      if (now - lastGfxPost >= GFX_INTERVAL_MS) {
        lastGfxPost = now;
        gfxTick("wire", now);
        gfxTick("janelia", now);
      }
      return;
    }

    if (msg.type === "bar") {
      let switchNames: { wire: string; janelia: string } | null = null;
      if (msg.switch) {
        for (const fly of ["wire", "janelia"] as const) {
          const p = players[fly];
          if (p) p.corpusIdx = (p.corpusIdx + 1) % p.crate.tracks.length;
        }
        switchNames = trackNames();
      }
      const wP = players.wire, jP = players.janelia;
      if (!wP || !jP) throw new Error("brains not loaded");
      const counts: Record<Fly, number> = { wire: wP.barSpikes, janelia: jP.barSpikes };
      wP.barSpikes = 0;
      jP.barSpikes = 0;
      const joint = Math.min(counts.wire, counts.janelia);
      const msg2: BarMsg & { switchNames: typeof switchNames; dbg: Record<string, number> } = {
        type: "bar",
        counts,
        sync: Math.min(1, joint / 25),
        utilWire: participation(wP),
        utilJanelia: participation(jP),
        switchNames,
        dbg: {
          wm: wP.lastStep.motor,
          wc: wP.lastStep.central,
          jm: jP.lastStep.motor,
          wGain: wP.brain.wGain,
          hum: wP.ambient,
          motorThr: wP.brain.thresh[wP.crate.tracks[0] ? motorSample(wP) : 0],
        },
      };
      ctx.postMessage(msg2);
      return;
    }

    if (msg.type === "switch") {
      for (const fly of ["wire", "janelia"] as const) {
        const p = players[fly];
        if (!p) continue;
        p.corpusIdx = (p.corpusIdx + 1) % p.crate.tracks.length;
      }
      const names = trackNames();
      ctx.postMessage({ type: "switch", trackNames: names ?? { wire: "", janelia: "" } });
      return;
    }
  } catch (err) {
    ctx.postMessage({ type: "error", message: String(err) });
  }
};
