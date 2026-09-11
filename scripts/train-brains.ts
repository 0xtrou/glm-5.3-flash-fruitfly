/**
 * Training CLI: grows up two fly brains on two corpora.
 *   npx tsx scripts/train-brains.ts
 * Writes public/data/weights-{wire,janelia}.json + train-report.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { trainBrain } from "../src/lib/brain/train";
import { FLYWIRE_CORPUS, JANELIA_CORPUS } from "../src/lib/brain/corpus";

type Dataset = {
  points: [number, number, number][];
  edges: [number, number][];
  neurons: { region: "brain" | "vnc"; count: number }[];
};

function load(name: string): Dataset {
  const p = path.join("public", "data", name);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const jobs = [
    { tag: "wire", dataset: load("fly-neurons-wire.json"), corpus: FLYWIRE_CORPUS, seed: 11 },
    { tag: "janelia", dataset: load("fly-neurons-janelia.json"), corpus: JANELIA_CORPUS, seed: 47 },
  ];
  const reports: Record<string, unknown> = {};
  for (const job of jobs) {
    console.log(`\n=== training ${job.tag} — ${job.corpus.style} ===`);
    const t = trainBrain(job.dataset, job.corpus, { seed: job.seed });
    const out = path.join("public", "data", `weights-${job.tag}.json`);
    fs.writeFileSync(out, JSON.stringify(t.weights));
    reports[job.tag] = { ...t.report, weightsBytes: fs.statSync(out).size };
    console.log(
      `${job.tag}: ${t.report.epochs} epochs · avg f1 (last 20) = ${(
        t.report.metrics.slice(-20).reduce((s, m) => s + m.f1, 0) / Math.min(20, t.report.metrics.length)
      ).toFixed(3)} · passed=${t.report.passed} · ${t.report.durationMs}ms`
    );
  }
  fs.writeFileSync(
    path.join("public", "data", "train-report.json"),
    JSON.stringify({ trainedAt: new Date().toISOString(), corpora: { wire: FLYWIRE_CORPUS.style, janelia: JANELIA_CORPUS.style }, ...reports }, null, 2)
  );
  console.log("\nDONE → public/data/weights-*.json + train-report.json");
}

void main();
