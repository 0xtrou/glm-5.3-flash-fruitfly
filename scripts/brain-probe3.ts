import * as fs from "node:fs";
import * as path from "node:path";
import { LIFBrain } from "../src/lib/brain/core";
import { FLYWIRE_CORPUS, JANELIA_CORPUS } from "../src/lib/brain/corpus";

function probe(tag: string, weightsFile: string, corpus: typeof FLYWIRE_CORPUS, seed: number) {
  const w = JSON.parse(fs.readFileSync(path.join("public/data", weightsFile), "utf8"));
  const brain = new LIFBrain(
    { points: new Array(w.n).fill(0) as [number, number, number][], edges: [], neuronCount: w.n },
    { seed, inputGroups: w.inputGroups, motorGroups: w.motorGroups }
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
  brain.wGain = (w as { wGain?: number }).wGain ?? 1.45;
  brain.leak = 0.1;
  brain.inputGroups = w.inputGroups;
  brain.motorGroups = w.motorGroups;
brain.rebuildRevPair();
  // mirror the runtime player: calibrated ambient hum from the weights bundle
  const ambient = (w as { ambient?: number }).ambient ?? 900;

  let improvSeed = 7;
  const rand = () => {
    improvSeed = (improvSeed + 0x9e3779b9) | 0;
    let t = Math.imul(improvSeed ^ (improvSeed >>> 16), 0x45d9f3b);
    t = Math.imul(t ^ (t >>> 16), 0x45d9f3b);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };

  let motor = 0, central = 0;
  const perChannel = [0, 0, 0, 0];
  for (let step = 0; step < 128; step++) {
    const cStep = step % 32;
    for (let ch = 0; ch < 4; ch++) {
      const on = corpus.onsets[ch].includes(cStep);
      if (on && rand() < 0.94) {
        brain.stimulate(ch, 38 + ((rand() * 12) | 0) + (rand() < 0.12 ? 12 : 0), 1.12 + rand() * 0.1);
      } else if (!on && rand() < 0.05) {
        brain.stimulate(ch, 12 + ((rand() * 10) | 0), 0.85);
      }
    }
    brain.stimulateAmbient(ambient, 0.18);
    const { counts, motorSpikes, centralSpikes } = brain.stepDetailed();
    motor += motorSpikes;
    central += centralSpikes;
    for (const [ch, c] of counts) perChannel[ch] += c;
  }
  console.log(`${tag}: motor=${motor} central=${central} perChannel=${perChannel.join(",")} bar-participation=${(brain.participation(64) * 100).toFixed(0)}%`);
}

probe("WIRE", "weights-wire.json", FLYWIRE_CORPUS, 11);
probe("JANELIA", "weights-janelia.json", JANELIA_CORPUS, 47);

// participation probe — appended
