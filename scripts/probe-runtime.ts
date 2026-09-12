/**
 * Node-side replica of brain-worker stepping (same params), to debug
 * zero-burst runtime offline. Prints per-step motor/central counts.
 */
import * as fs from "node:fs";
import { parseTopology, parseWeights, buildFlywireBrain } from "../src/lib/flywire-brain";
import { FLYWIRE_CORPUS } from "../src/lib/brain/corpus";

const topo = parseTopology(fs.readFileSync("public/data/flywire-topology.bin").buffer as ArrayBuffer);
const { w, scale } = parseWeights(fs.readFileSync("public/data/flywire-weights-wire.bin").buffer as ArrayBuffer);
let mx = 0, nz = 0;
for (let i = 0; i < w.length; i++) { const a = Math.abs(w[i]); if (a > mx) mx = a; if (w[i] !== 0) nz++; }
console.log("weight scale:", scale, "| |w| max:", mx.toFixed(3), "| nonzero:", nz, "of", w.length);

const WG = Number(process.env.WGAN ?? 1.4);
const brain = buildFlywireBrain(topo, w, { seed: 11, learning: false, motorElevation: 0.15, wGain: WG, leak: 0.12 });
brain.learning = false;

const t0 = Date.now();
let improv = 7;
const rand = () => {
  improv = (improv + 0x9e3779b9) | 0;
  let t = Math.imul(improv ^ (improv >>> 16), 0x45d9f3b);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
};

// warmup 1 loop, measure 1 loop — worker params verbatim
const HUM = Number(process.env.HUM ?? 4000);
console.log(`WGAN=${WG} HUM=${Number(process.env.HUM ?? 4000)} (runtime-matched stim 34-46 @ 1.15-1.25)`);
for (let phase = 0; phase < 2; phase++) {
  let voiced = 0;
  for (let step = 0; step < 32; step++) {
    const st = Date.now();
    for (let ch = 0; ch < 4; ch++) {
      const on = FLYWIRE_CORPUS.onsets[ch].includes(step);
      if (on && rand() < 0.97) {
        brain.stimulate(ch, 34 + ((rand() * 12) | 0), 1.15 + rand() * 0.1);
      } else if (!on && rand() < 0.12) {
        brain.stimulate(ch, 12 + ((rand() * 10) | 0), 0.85);
      }
    }
    brain.stimulateAmbient(Number(process.env.HUM ?? 4000), 0.18); // once per step, as trained
    const d = brain.stepDetailed();
    if (phase === 1 && step % 8 === 0) console.log(`  [timing] step ${step}: ${Date.now() - st}ms`);
    let bursts = 0;
    for (const [, c] of d.counts) if (c >= 3) bursts++;
    if (phase === 1) console.log(`step ${String(step).padStart(2)} motor=${String(d.motorSpikes).padStart(4)} central=${String(d.centralSpikes).padStart(5)} voicedCh=${bursts}`);
  }
}
