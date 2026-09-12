import * as fs from "node:fs";
import { parseTopology, parseWeights, buildFlywireBrain } from "../src/lib/flywire-brain";
import { JANELIA_CORPUS } from "../src/lib/brain/corpus";
const topoBuf = fs.readFileSync("public/data/flywire-topology.bin");
const wBuf = fs.readFileSync("public/data/flywire-weights-janelia.bin");
const topo = parseTopology(topoBuf.buffer.slice(topoBuf.byteOffset, topoBuf.byteOffset + topoBuf.byteLength) as ArrayBuffer);
const { w } = parseWeights(wBuf.buffer.slice(wBuf.byteOffset, wBuf.byteOffset + wBuf.byteLength) as ArrayBuffer);
for (const HUM of [1300, 1600, 1900, 2200]) {
  const brain = buildFlywireBrain(topo, w, { seed: 47, learning: false, motorElevation: 0.15, wGain: 1.4, leak: 0.12 });
  let improv = 47;
  const rand = () => { improv = (improv + 0x9e3779b9) | 0; let t = Math.imul(improv ^ (improv >>> 16), 0x45d9f3b); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
  for (let phase = 0; phase < 2; phase++) {
    let mTot = 0, cTot = 0, onM = 0, offM = 0, onN = 0, offN = 0, voiced = 0;
    for (let step = 0; step < 32; step++) {
      for (let ch = 0; ch < JANELIA_CORPUS.channels; ch++) {
        const on = JANELIA_CORPUS.onsets[ch].includes(step);
        if (on && rand() < 0.97) brain.stimulate(ch, 34 + ((rand() * 12) | 0), 1.15 + rand() * 0.1);
        else if (!on && rand() < 0.12) brain.stimulate(ch, 12 + ((rand() * 10) | 0), 0.85);
      }
      if (HUM > 0) brain.stimulateAmbient(HUM, 0.18);
      const d = brain.stepDetailed();
      if (phase === 1) {
        mTot += d.motorSpikes; cTot += d.centralSpikes;
        for (const [, c] of d.counts) if (c >= 3) { voiced++; break; }
        let onStep = false;
        for (let ch = 0; ch < JANELIA_CORPUS.channels; ch++) if (JANELIA_CORPUS.onsets[ch].includes(step)) onStep = true;
        if (onStep) { onM += d.motorSpikes; onN++; } else { offM += d.motorSpikes; offN++; }
      }
    }
    if (phase === 1) console.log(`janelia hum${HUM} | motor/step ${(mTot/32).toFixed(0)} | central/step ${(cTot/32).toFixed(0)} | voiced ${voiced}/32 | on ${((onM/Math.max(1,onN))||0).toFixed(0)} off ${((offM/Math.max(1,offN))||0).toFixed(0)}`);
  }
}
console.log("DONE");
