import * as fs from "node:fs";
import * as path from "node:path";
import { LIFBrain } from "../src/lib/brain/core";
import { FLYWIRE_CORPUS } from "../src/lib/brain/corpus";

const w = JSON.parse(fs.readFileSync(path.join("public/data", "weights-wire.json"), "utf8"));
const brain = new LIFBrain(
  { points: new Array(w.n).fill(0) as [number, number, number][], edges: [], neuronCount: w.n },
  { seed: 23, inputGroups: w.inputGroups, motorGroups: w.motorGroups }
);
brain.n = w.n;
brain.adjStart = new Uint32Array(w.adjStart);
brain.adjPost = new Uint32Array(w.adjPost);
brain.adjW = new Float32Array(w.adjW);
brain.revStart = new Uint32Array(w.revStart);
brain.revPre = new Uint32Array(w.revPre);
brain.revE = new Float32Array(w.revE.length);
brain.v = new Float32Array(w.n);
brain.refracUntil = new Int32Array(w.n);
brain.preTrace = new Float32Array(w.n);
brain.postTrace = new Float32Array(w.n);
brain.inputGroups = w.inputGroups;
brain.motorGroups = w.motorGroups;
brain.rebuildRevPair();
brain.wGain = (w as { wGain?: number }).wGain ?? 1.7;
brain.ambientCount = (w as { ambient?: number }).ambient ?? 900;


// histogram of thresholds actually used
const thSet = new Map<number, number>();
for (let i = 0; i < brain.n; i++) {
  const t = Math.round(brain.thresh[i] * 100) / 100;
  thSet.set(t, (thSet.get(t) ?? 0) + 1);
}
console.log("threshold histogram:", [...thSet.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => `${t}:${c}`).join(" "));

for (let step = 0; step < 32; step++) {
  for (let ch = 0; ch < 4; ch++) {
    if (FLYWIRE_CORPUS.onsets[ch].includes(step)) brain.stimulate(ch, 44, 1.18);
  }
  // sub-threshold hum, matching the runtime player
  brain.stimulateAmbient(brain.ambientCount, 0.18);
  brain.step();
}
console.log("tSub:", (brain as unknown as { tSub: number }).tSub);
console.log("bar participation (64 substeps):", (brain.participation(64) * 100).toFixed(1) + "%");
console.log("4-bar participation (256):", (brain.participation(256) * 100).toFixed(1) + "%");


