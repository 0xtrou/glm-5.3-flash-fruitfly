import { LIFBrain, buildGraphFromDataset, SUBSTEPS_PER_STEP } from "./core";
import { Critic } from "./critic";
import type { Corpus } from "./corpus";

export interface TrainReport {
  style: string;
  epochs: number;
  finalTeacher: number;
  metrics: { epoch: number; f1: number; inScale: number; silence: number; reward: number }[];
  /** teacher-free playing score — the real test */
  generationF1: number;
  passed: boolean;
  durationMs: number;
}

export interface TrainResult {
  weights: ReturnType<LIFBrain["exportWeights"]>;
  report: TrainReport;
}

export interface TrainOptions {
  seed: number;
  epochs?: number;
  lr?: number;
  teacherStart?: number;
  teacherFloor?: number;
  teacherDecayFrac?: number; // fraction of epochs over which teacher decays
  f1Target?: number;
}

/**
 * Reward-modulated STDP training. One epoch = 2 passes over the 32-step corpus
 * (64 steps total). Per step: stimulate sensory channels at corpus onsets,
 * optionally teach motor targets (decaying), step the brain, score with the
 * critic, apply w += lr * dopamine * eligibility.
 */
export function trainBrain(
  data: { points: [number, number, number][]; edges: [number, number][]; neurons: { region: "brain" | "vnc"; count: number }[] },
  corpus: Corpus,
  opts: TrainOptions
): TrainResult {
  const t0 = Date.now();
  const epochs = opts.epochs ?? 400;
  const lr = opts.lr ?? 0.05;
  const teacherStart = opts.teacherStart ?? 1.0;
  const teacherFloor = opts.teacherFloor ?? 0.18;
  const teacherDecayFrac = opts.teacherDecayFrac ?? 0.7;
  const f1Target = opts.f1Target ?? 0.6;

  const { graph, inputGroups, motorGroups, descendingEdges } = buildGraphFromDataset(data, {
    seed: opts.seed,
    inputPerChannel: 140,
    motorPerChannel: 110,
    channels: corpus.channels,
  });
  const brain = new LIFBrain(graph, { seed: opts.seed, inputGroups, motorGroups });
  brain.boostLastEdges((descendingEdges ?? 0) * 2, 0.25, 0.3); // axonal strength
  const critic = new Critic(corpus);

  const STEPS = 64; // 2 corpus loops per epoch (32-step corpus × 2)
  const metrics: TrainReport["metrics"] = [];
  let teacher = teacherStart;
  const rng = (() => {
    let a = (opts.seed ^ 0x1234567) >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  const onsetMask: boolean[][] = corpus.onsets.map((on) => {
    const m = new Array(32).fill(false);
    for (const o of on) m[o] = true;
    return m;
  });

  for (let epoch = 0; epoch < epochs; epoch++) {
    teacher = epoch < epochs * teacherDecayFrac
      ? teacherStart - (teacherStart - teacherFloor) * ((epoch / (epochs * teacherDecayFrac)) ** 1.5)
      : teacherFloor;

    let tp = 0, fp = 0, fn = 0, onSteps = 0, rewardSum = 0;
    for (let step = 0; step < STEPS; step++) {
      const cStep = step % 32;

      // sensory: stimulate each channel that has an onset this step
      for (let ch = 0; ch < corpus.channels; ch++) {
        if (onsetMask[ch][cStep]) brain.stimulate(ch, 40, 1.15);
      }
      // teacher: force motor spikes at onsets with decaying probability
      if (rng() < teacher) {
        for (let ch = 0; ch < corpus.channels; ch++) {
          if (onsetMask[ch][cStep]) brain.teach(ch, 10);
        }
      }

      // step the brain one 16th
      const fired = brain.step(); // Map<channel, count>
      const counts = fired;

      // critic + plasticity
      const r = critic.reward(cStep, counts);
      rewardSum += r;
      brain.applyPlasticity(r, lr);

      // metrics vs corpus (first 32 steps only, compare like-for-like)
      if (step < 32) {
        for (let ch = 0; ch < corpus.channels; ch++) {
          const spiked = (counts.get(ch) ?? 0) > 0;
          const expected = onsetMask[ch][cStep];
          if (spiked && expected) tp++;
          else if (spiked && !expected) fp++;
          else if (!spiked && expected) fn++;
          if (expected) onSteps++;
        }
      }
    }

    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
    const epochMetric = { epoch, f1, inScale: precision, silence: 1 - recall, reward: rewardSum / STEPS };
    metrics.push(epochMetric);
    if (epoch % 20 === 0 || epoch === epochs - 1) {
      console.log(`  epoch ${epoch}: f1=${f1.toFixed(3)} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} reward=${epochMetric.reward.toFixed(3)} teacher=${teacher.toFixed(2)}`);
    }
    if (f1 >= f1Target && teacher <= teacherFloor + 0.01) {
      console.log(`  early stop at epoch ${epoch}: f1 target reached`);
      break;
    }
  }

  // GENERATION TEST — teacher fully off. The brain must play from its own
  // wiring + learned sensory context. This is the number that matters.
  let gtp = 0, gfp = 0, gfn = 0;
  for (let step = 0; step < 32; step++) {
    for (let ch = 0; ch < corpus.channels; ch++) {
      if (onsetMask[ch][step]) brain.stimulate(ch, 40, 1.15); // sensory context, no teacher
    }
    const counts = brain.step();
    for (let ch = 0; ch < corpus.channels; ch++) {
      const spiked = (counts.get(ch) ?? 0) > 0;
      const expected = onsetMask[ch][step];
      if (spiked && expected) gtp++;
      else if (spiked && !expected) gfp++;
      else if (!spiked && expected) gfn++;
    }
  }
  const gPrecision = gtp / Math.max(1, gtp + gfp);
  const gRecall = gtp / Math.max(1, gtp + gfn);
  const generationF1 = (2 * gPrecision * gRecall) / Math.max(1e-9, gPrecision + gRecall);
  console.log(`  GENERATION (teacher=0): f1=${generationF1.toFixed(3)} precision=${gPrecision.toFixed(3)} recall=${gRecall.toFixed(3)}`);

  const last = metrics.slice(-20);
  const avgF1 = last.reduce((s, m) => s + m.f1, 0) / last.length;
  return {
    weights: brain.exportWeights(),
    report: {
      style: corpus.style,
      epochs: metrics.length,
      finalTeacher: teacher,
      metrics,
      generationF1,
      passed: generationF1 >= 0.45,
      durationMs: Date.now() - t0,
    },
  };
}

export { SUBSTEPS_PER_STEP };
