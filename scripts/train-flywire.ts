/**
 * Train both DJs on the REAL FlyWire FAFB v783 connectome.
 *
 *   npx tsx scripts/train-flywire.ts
 *
 * Reads the binary bundles built by scripts/build-flywire.py, runs the full
 * protocol (R-STDP + fading teacher + best checkpoint + fine-tune +
 * calibration + generation test) on each fly's corpus, and writes:
 *   public/data/flywire-weights-{wire,janelia}.bin  trained weights (int8)
 *   public/data/flywire-ambient.json                calibrated hum densities
 *   public/data/train-report-flywire.json           full honest report
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { LIFBrain } from "../src/lib/brain/core";
import { trainExistingBrain, type TrainResult } from "../src/lib/brain/train";
import { FLYWIRE_CORPUS, JANELIA_CORPUS } from "../src/lib/brain/corpus";
import { parseTopology, parseWeights, buildFlywireBrain } from "../src/lib/flywire-brain";

const DATA = "public/data";

function readBin(p: string): ArrayBuffer {
  return fs.readFileSync(path.join(DATA, p)).buffer as ArrayBuffer;
}

function writeWeights(fly: "wire" | "janelia", brain: LIFBrain) {
  const E = brain.adjW.length;
  const header = Buffer.alloc(12);
  // magic 0x5738, version 1, f32 scale 0.5/127 — same layout the builder emits
  header.writeUInt32LE(0x5738, 0);
  header.writeUInt32LE(1, 4);
  header.writeFloatLE(0.5 / 127, 8);
  const q = Buffer.alloc(E);
  for (let k = 0; k < E; k++) {
    q[k] = Math.max(-127, Math.min(127, Math.round((brain.adjW[k] / 0.5) * 127)));
  }
  fs.writeFileSync(path.join(DATA, `flywire-weights-${fly}.bin`), Buffer.concat([header, q]));
}

function train(fly: "wire" | "janelia", corpus: typeof FLYWIRE_CORPUS, seed: number, epochs: number) {
  console.log(`\n=== training ${fly} on the FlyWire connectome — ${corpus.style} ===`);
  const topo = parseTopology(readBin("flywire-topology.bin"));
  const { w } = parseWeights(readBin(`flywire-weights-${fly}.bin`));
  const brain = buildFlywireBrain(topo, w, { seed, learning: true });
  brain.buildReverseCSR();
  brain.wGain = 1;
  brain.leak = 0.12;

  const t = performance.now();
  const result: TrainResult = trainExistingBrain(brain, corpus, {
    seed,
    epochs,
    humStart: 4000,
    humCap: 48000,
    humStep: 4000,
    participationTarget: 0.8,
    f1Target: 0.6,
  });
  const duration = ((performance.now() - t) / 1000).toFixed(0);

  writeWeights(fly, brain);
  const report = {
    fly,
    trainedAt: new Date().toISOString(),
    durationSeconds: Number(duration),
    ...result.report,
    metrics: undefined, // per-epoch table stays in the console log; full file = train-report-legacy
  };
  return { result, report, ambient: result.report.ambientCount };
}

function main() {
  const wire = train("wire", FLYWIRE_CORPUS, 11, 700);
  const janelia = train("janelia", JANELIA_CORPUS, 47, 500);

  fs.writeFileSync(
    path.join(DATA, "flywire-ambient.json"),
    JSON.stringify({ wire: wire.ambient, janelia: janelia.ambient }, null, 1)
  );
  fs.writeFileSync(
    path.join(DATA, "train-report-flywire.json"),
    JSON.stringify({ wire: wire.report, janelia: janelia.report }, null, 1)
  );
  console.log("\nDONE → flywire-weights-*.bin + flywire-ambient.json + train-report-flywire.json");
  console.log("bump DATA_VERSION in src/lib/neural-sim.ts, then redeploy");
}

main();
