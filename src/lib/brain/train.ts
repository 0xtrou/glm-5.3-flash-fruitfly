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
  /** motor firing on onset steps vs off steps — the rhythm test */
  onsetSelectivity: number;
  /** fraction of generated motor onsets that are OFF-corpus — structure not copied */
  divergence: number;
  /** distinct generated bar patterns across generation passes — variation, not tape */
  uniqueBars: number;
  bestCheckpoint: { epoch: number; genF1: number };
  participation: number;
  ambientCount: number;
  wGain: number;
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
  /** teacher-free fine-tune epochs after the main run (consequences only) */
  fineTuneEpochs?: number;
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
  // floor ≈ 0: by the end there is essentially no teacher — every spike must
  // be earned through consequences (PHILOSOPHY.md principle 2)
  const teacherFloor = opts.teacherFloor ?? 0.02;
  const teacherDecayFrac = opts.teacherDecayFrac ?? 0.7;
  const f1Target = opts.f1Target ?? 0.6;
  // teacher-free fine-tune epochs after the main run: consequences only
  const fineTuneEpochs = opts.fineTuneEpochs ?? 40;

  const { graph, inputGroups, motorGroups } = buildGraphFromDataset(data, {
    seed: opts.seed,
    inputPerChannel: 140,
    motorPerChannel: 110,
    channels: corpus.channels,
  });
  const brain = new LIFBrain(graph, { seed: opts.seed, inputGroups, motorGroups });
  // NOTE: descending grafts deliberately start WEAK (initial 0.06–0.16
  // weights, below the elevated motor threshold). Pre-boosting them let
  // tonic brain chatter fire motor pools continuously — no rhythm. Kept
  // weak, motor spikes must be earned: STDP strengthens the synapses that
  // consistently fire just before the motor pools (teacher early, critic
  // always), which is where the beat comes from.
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

  const genProbe = (): number => {
    // real F1 — counts false positives too, so checkpoint selection tracks
    // actual teacher-free quality instead of always returning 1.0
    let tp = 0, fp = 0, fn = 0;
    for (let step = 0; step < 32; step++) {
      for (let ch = 0; ch < corpus.channels; ch++) {
        if (onsetMask[ch][step]) brain.stimulate(ch, 38, 1.12);
      }
      const counts = brain.step();
      for (let ch = 0; ch < corpus.channels; ch++) {
        const spiked = (counts.get(ch) ?? 0) > 0;
        if (spiked && onsetMask[ch][step]) tp++;
        else if (spiked && !onsetMask[ch][step]) fp++;
        else if (!spiked && onsetMask[ch][step]) fn++;
      }
    }
    const prec = tp / Math.max(1, tp + fp);
    const rec = tp / Math.max(1, tp + fn);
    return (2 * prec * rec) / Math.max(1e-9, prec + rec);
  };
  let bestGen = -1;
  let bestAdjW: Float32Array | null = null;
  let bestEpoch = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    teacher = epoch < epochs * teacherDecayFrac
      ? teacherStart - (teacherStart - teacherFloor) * ((epoch / (epochs * teacherDecayFrac)) ** 1.5)
      : teacherFloor;
    // learning-rate decay — late updates polish instead of churn
    const lrNow = lr * (1 - 0.6 * (epoch / Math.max(1, epochs - 1)));

    let tp = 0, fp = 0, fn = 0, rewardSum = 0;
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
      brain.applyPlasticity(r, lrNow);

      // metrics vs corpus (first 32 steps only, compare like-for-like)
      if (step < 32) {
        for (let ch = 0; ch < corpus.channels; ch++) {
          const spiked = (counts.get(ch) ?? 0) > 0;
          const expected = onsetMask[ch][cStep];
          if (spiked && expected) tp++;
          else if (spiked && !expected) fp++;
          else if (!spiked && expected) fn++;
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
    if (epoch % 10 === 0 && epoch >= 40) {
      const g = genProbe();
      if (g > bestGen) {
        bestGen = g;
        bestAdjW = Float32Array.from(brain.adjW);
        bestEpoch = epoch;
      }
      if (g >= f1Target && teacher <= teacherFloor + 0.01) {
        console.log(`  early stop at epoch ${epoch}: gen f1 ${g.toFixed(3)} reached target`);
        break;
      }
    }
  }

  // ---- FINE-TUNE: teacher fully gone, consequences only ----
  // Reward-gated STDP with zero injected targets. The brain polishes its own
  // wiring against the critic — hits get reinforced, spam gets punished — and
  // fine-tuned weights compete with the main-run checkpoint by the same
  // teacher-free probe, so this stage can only keep an improvement.
  for (let e = 0; e < fineTuneEpochs; e++) {
    const lrNow = lr * 0.4 * (1 - e / Math.max(1, fineTuneEpochs));
    for (let step = 0; step < STEPS; step++) {
      const cStep = step % 32;
      for (let ch = 0; ch < corpus.channels; ch++) {
        if (onsetMask[ch][cStep]) brain.stimulate(ch, 40, 1.15); // sensory context, no teacher
      }
      const counts = brain.step();
      const r = critic.reward(cStep, counts);
      brain.applyPlasticity(r, lrNow);
    }
    if (e % 10 === 9) {
      const g = genProbe();
      if (g > bestGen) {
        bestGen = g;
        bestAdjW = Float32Array.from(brain.adjW);
        bestEpoch = epochs + e; // offset marks a fine-tune checkpoint
      }
      console.log(`  fine-tune ${e}: gen f1 ${g.toFixed(3)} (best ${bestGen.toFixed(3)})`);
    }
  }

  // restore the best teacher-free performer
  if (bestAdjW) brain.adjW.set(bestAdjW);
  console.log(`  best checkpoint: epoch ${bestEpoch} gen f1 ${bestGen.toFixed(3)}`);

  // ---- CALIBRATION: high node utilization WITHOUT drowning the beat ----
  // Utilization = fraction of nodes that fired at least once in the last
  // bar-window — NOT firing rate. Target ≥80% is safe NOW because (a) the
  // hum stays sub-threshold (0.15 < min threshold 0.30 — background alone
  // never fires a node, it only widens the excited pool) and (b) motor
  // pools carry +0.35 threshold elevation, so tonic recruitment cannot
  // fire them; beats still come only from sensory surges + learned lines.
  // The earlier seizure was different: above-threshold hum and NO motor
  // elevation — 99% participation with flat motor output.
  brain.wGain = 1.4;
  let ambientCount = 300;
  let participation = 0;
  let usedAmbient = 300;
  for (let attempt = 0; attempt < 14; attempt++) {
    // 32-step playback pass ×2, count unique firing nodes via lastFire window
    for (let rep = 0; rep < 2; rep++) {
      for (let step = 0; step < 32; step++) {
        for (let ch = 0; ch < corpus.channels; ch++) {
          if (onsetMask[ch][step]) brain.stimulate(ch, 40, 1.15);
        }
        brain.stimulateAmbient(ambientCount, 0.18);
        brain.step();
      }
    }
    let fired = 0;
    for (let i = 0; i < brain.n; i++) {
      if (brain.firedWithin(512, i)) fired++; // fired within last 4 bars
    }
    participation = fired / brain.n;
    usedAmbient = ambientCount;
    console.log(`  calibration ${attempt}: wGain=${brain.wGain.toFixed(2)} ambient=${ambientCount} participation=${(participation * 100).toFixed(0)}%`);
    if (participation >= 0.8) break;
    if (brain.wGain < 1.8) brain.wGain += 0.1;
    else if (ambientCount < 2000) { ambientCount += 250; brain.ambientCount = ambientCount; } // gain capped — widen the excited pool via hum
    else break; // caps reached — report the honest number
  }
  brain.ambientCount = usedAmbient; // export what was actually calibrated

  // GENERATION TEST — teacher fully off. The brain must play from its own
  // wiring + learned sensory context. This is the number that matters.
  // Two passes: pass 0 scores beat-alignment AND onset selectivity (mean
  // motor firing on onset channel-steps vs off steps — the rhythm test);
  // both passes measure divergence (structure not copied) and variety.
  let gtp = 0, gfp = 0, gfn = 0;
  let genOnsets = 0;
  let genOffCorpus = 0;
  let onsetSum = 0, onsetN = 0, offSum = 0, offN = 0;
  const barPatterns = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    let barSig = "";
    for (let step = 0; step < 32; step++) {
      for (let ch = 0; ch < corpus.channels; ch++) {
        if (onsetMask[ch][step]) brain.stimulate(ch, 40, 1.15); // sensory context, no teacher
      }
      const counts = brain.step();
      for (let ch = 0; ch < corpus.channels; ch++) {
        const c = counts.get(ch) ?? 0;
        const expected = onsetMask[ch][step];
        const spiked = c > 0;
        if (spiked) {
          genOnsets++;
          if (!expected) genOffCorpus++;
          barSig += expected ? "1" : "2"; // on-corpus vs invented onset
        } else {
          barSig += expected ? "3" : "."; // dropped onset vs silence
        }
        if (expected) { onsetSum += c; onsetN++; }
        else { offSum += c; offN++; }
        if (pass === 0) {
          if (spiked && expected) gtp++;
          else if (spiked && !expected) gfp++;
          else if (!spiked && expected) gfn++;
        }
      }
    }
    barPatterns.add(barSig);
  }
  const gPrecision = gtp / Math.max(1, gtp + gfp);
  const gRecall = gtp / Math.max(1, gtp + gfn);
  const generationF1 = (2 * gPrecision * gRecall) / Math.max(1e-9, gPrecision + gRecall);
  const divergence = genOnsets > 0 ? genOffCorpus / genOnsets : 0;
  // rhythm = motor pools respond on the beat, not constantly
  const onsetSelectivity = (onsetSum / Math.max(1, onsetN)) / Math.max(0.5, offSum / Math.max(1, offN));
  console.log(
    `  GENERATION (teacher=0): f1=${generationF1.toFixed(3)} precision=${gPrecision.toFixed(3)} recall=${gRecall.toFixed(3)}` +
      ` divergence=${divergence.toFixed(3)} onsetSelectivity=${onsetSelectivity.toFixed(2)} uniqueBars=${barPatterns.size}`
  );

  return {
    weights: brain.exportWeights(),
    report: {
      style: corpus.style,
      epochs: metrics.length,
      finalTeacher: teacher,
      metrics,
      generationF1,
      onsetSelectivity,
      divergence,
      uniqueBars: barPatterns.size,
      participation,
      ambientCount: usedAmbient,
      wGain: brain.wGain,
      bestCheckpoint: { epoch: bestEpoch, genF1: bestGen },
      passed: generationF1 >= 0.35 && onsetSelectivity >= 1.8 && participation >= 0.8,
      durationMs: Date.now() - t0,
    },
  };
}

export { SUBSTEPS_PER_STEP };
