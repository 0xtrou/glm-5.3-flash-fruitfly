/**
 * E/I balance sweep: find the inhibitory multiplier that tames global
 * cascades while keeping onset-locked motor bursts. Read-only on weights.
 */
import * as fs from "node:fs";
import { parseTopology, parseWeights, buildFlywireBrain } from "../src/lib/flywire-brain";
import { FLYWIRE_CORPUS } from "../src/lib/brain/corpus";

const topo = parseTopology(fs.readFileSync("public/data/flywire-topology.bin").buffer as ArrayBuffer);
const { w } = parseWeights(fs.readFileSync("public/data/flywire-weights-wire.bin").buffer as ArrayBuffer);

// which edges are inhibitory: sign encoded in int8
const inhMask = new Uint8Array(w.length);
for (let k = 0; k < w.length; k++) inhMask[k] = w[k] < 0 ? 1 : 0;

function run(mult: number) {
  const w2 = new Float32Array(w.length);
  for (let k = 0; k < w.length; k++) {
    w2[k] = w[k] * (inhMask[k] ? mult : 1);
  }
  const brain = buildFlywireBrain(topo, w2, { seed: 11, learning: false, motorElevation: 0.15 });
  brain.wGain = 1.5;
  brain.leak = 0.12;
  let improv = 7;
  const rand = () => {
    improv = (improv + 0x9e3779b9) | 0;
    let t = Math.imul(improv ^ (improv >>> 16), 0x45d9f3b);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  let totalSpikes = 0, onsetBursts = 0, offBursts = 0, onSteps = 0, offSteps = 0;
  const lagHist = new Array(9).fill(0);   // all channel-steps by lag class
  const lagW = new Array(9).fill(0);      // voiced bursts by lag class
  for (let loop = 0; loop < 2; loop++) {
    for (let step = 0; step < 32; step++) {
      for (let ch = 0; ch < 4; ch++) {
        if (FLYWIRE_CORPUS.onsets[ch].includes(step)) brain.stimulate(ch, 120, 1.25);
      }
      brain.stimulateAmbient(12000, 0.18);
      const d = brain.stepDetailed();
      const ch3 = d.counts.get(3) ?? 0;
      if (loop === 1) {
        const on = FLYWIRE_CORPUS.onsets[3].includes(step);
        if (ch3 >= 3) { if (on) onsetBursts++; else offBursts++; }
        if (on) onSteps++; else offSteps++;
        // lag histogram: distance from this step to the NEAREST ch3 onset
        const onsets = FLYWIRE_CORPUS.onsets[3];
        let lag = 99;
        for (const o of onsets) lag = Math.min(lag, Math.min(Math.abs(step - o), 32 - Math.abs(step - o)));
        lagHist[Math.min(lag, 8)] += ch3 >= 3 ? 1 : 0;
        if (ch3 >= 3) lagW[Math.min(lag, 8)]++;
      }
    }
  }
  const sel = onsetBursts / Math.max(1, offBursts);
  console.log(`inh×${mult.toFixed(1)}: bursts on=${onsetBursts} off=${offBursts} sel=${sel.toFixed(2)} lagHist(all→voiced): ${lagHist.map((h, i) => `lag${i}:${h}/${lagW[i]}`).join(" ")}`);
}

for (const m of [1, 1.5, 2, 3, 4, 6]) run(m);
