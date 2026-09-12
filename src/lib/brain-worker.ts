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
  boost: number;
  seed: number;
}

const CRATES: Record<Fly, Crate> = {
  wire: {
    tracks: [FLYWIRE_CORPUS, FLYWIRE_TRACK_F, FLYWIRE_TRACK_D, FLYWIRE_TRACK_B, FLYWIRE_TRACK_E, FLYWIRE_TRACK_C],
    boost: 2.6,
    seed: 11,
  },
  janelia: {
    tracks: [JANELIA_CORPUS, JANELIA_TRACK_G, JANELIA_TRACK_H, JANELIA_TRACK_I, JANELIA_TRACK_D, JANELIA_TRACK_E, JANELIA_TRACK_B, JANELIA_TRACK_C],
    boost: 1.5,
    seed: 47,
  },
};

type Fly = "wire" | "janelia";

interface Player {
  brain: LIFBrain;
  crate: Crate;
  corpusIdx: number;
  boost: number;
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
  const brain = buildFlywireBrain(topoData, w, { seed: crate.seed, learning: false, motorElevation: 0.15 });

  const p: Player = {
    brain,
    crate,
    corpusIdx: 1, // the set opens on the IDM record
    boost: crate.boost,
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
      const extra = rand(p) < 0.1 ? 42 : 0;
      p.brain.stimulate(ch, Math.round((100 + ((rand(p) * 30) | 0) + extra) * p.boost), 1.25 + rand(p) * 0.12);
    } else if (!on && rand(p) < 0.12) {
      // spontaneous off-grid thought
      p.brain.stimulate(ch, 30 + ((rand(p) * 20) | 0), 0.85);
    }
    // ambient synaptic hum — sub-threshold, calibrated density
    p.brain.stimulateAmbient(p.ambient, 0.18);
  }
  const d = p.brain.stepDetailed();
  p.lastStep = { motor: d.motorSpikes, central: d.centralSpikes };
  // EMA drive — what the fly body + telemetry express
  const k = 0.18;
  p.drive.motor += (Math.min(1, d.motorSpikes / 12) - p.drive.motor) * k;
  p.drive.think += (Math.min(1, d.centralSpikes / 40) - p.drive.think) * k;
  return d.counts;
}

function participation(p: Player): number {
  const brain = p.brain;
  const t = brain.clock;
  let c = 0;
  for (let i = 0; i < brain.n; i++) {
    if (t - brain.lastFire[i] < 512) c++; // fired within last 4 bars
  }
  return c / Math.max(1, brain.n);
}

async function load(): Promise<FlywireTopology> {
  const [topoData, ambient, ww, wj] = await Promise.all([
    parseTopology((await (await fetch(`/data/flywire-topology.bin?v=${DATA_VERSION}`)).arrayBuffer())),
    (await (await fetch(`/data/flywire-ambient.json?v=${DATA_VERSION}`)).json()) as Record<Fly, { ambient: number; wGain: number }>,
    parseWeights((await (await fetch(`/data/flywire-weights-wire.bin?v=${DATA_VERSION}`)).arrayBuffer())).w,
    parseWeights((await (await fetch(`/data/flywire-weights-janelia.bin?v=${DATA_VERSION}`)).arrayBuffer())).w,
  ]);
  players.wire = makePlayer("wire", ww, topoData, ambient.wire ?? { ambient: 4000, wGain: 1.7 });
  players.janelia = makePlayer("janelia", wj, topoData, ambient.janelia ?? { ambient: 4000, wGain: 1.7 });
  return topoData;
}

function trackNames() {
  const w = players.wire, j = players.janelia;
  if (!w || !j) return null;
  return { wire: corpusOf(w).style, janelia: corpusOf(j).style };
}

// worker global scope — DOM lib types `self` as Window, whose postMessage
// wants a targetOrigin; the DedicatedWorker overload takes transferables.
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const FIRE_INTERVAL_MS = 100;
let lastFirePost = 0;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; cStep?: number; switch?: boolean };
  try {
    if (msg.type === "load") {
      const topoData = await load();
      // visuals: real positions + real adjacency + a sampled edge skeleton
      const edgeSample: number[] = [];
      const cap = 60000;
      const stride = Math.max(1, Math.floor(topoData.edgeCount / cap));
      for (let pre = 0; pre < topoData.n; pre++) {
        const from = topoData.adjStart[pre];
        const to = topoData.adjStart[pre + 1];
        if (to > from && pre % stride === 0 && edgeSample.length < cap * 2) {
          edgeSample.push(pre, topoData.adjPost[from]);
        }
      }
      const positions = new Float32Array(topoData.positions);
      const adjStart = new Uint32Array(topoData.adjStart);
      const sample = new Uint32Array(edgeSample);
      const names = trackNames();
      ctx.postMessage(
        { type: "ready", trackNames: names ?? { wire: "", janelia: "" }, positions, adjStart, edgeSample: sample },
        [positions.buffer, adjStart.buffer, sample.buffer]
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

      const msg2: StepMsg = {
        type: "step",
        notes,
        kick,
        snare,
        drive: { wire: { ...wire.drive }, janelia: { ...janelia.drive } },
        spikes: { wire: { ...wire.lastStep }, janelia: { ...janelia.lastStep } },
      };
      ctx.postMessage(msg2);

      // 10 Hz lastFire snapshots for the 3D renders (transfer, zero-copy)
      const now = performance.now();
      if (now - lastFirePost >= FIRE_INTERVAL_MS) {
        lastFirePost = now;
        for (const fly of ["wire", "janelia"] as const) {
          const p = players[fly];
          if (!p) continue;
          const copy = new Float32Array(p.brain.lastFire);
          ctx.postMessage({ type: "fire", fly, tSub: p.brain.clock, buf: copy }, [copy.buffer]);
        }
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
      const msg2: BarMsg & { switchNames: typeof switchNames } = {
        type: "bar",
        counts,
        sync: Math.min(1, joint / 25),
        utilWire: participation(wP),
        utilJanelia: participation(jP),
        switchNames,
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
