# FLYTAPE — Brain Training & Architecture Guide

How the two DJ brains are built, trained, calibrated, and how to extend them.
Philosophy lives in `PHILOSOPHY.md`. This file is the operator manual.

---

## 1. System overview

```
NeuroMorpho.org (real fly neuron SWCs)
        │  morphology bundles checked into public/data/
        │  (re-positioned into neuropils by scripts/relayout-brains.ts)
        ▼
public/data/fly-neurons-{wire,janelia}.json      ← morphology bundles
        │
        ▼
src/lib/brain/core.ts        LIFBrain — leaky integrate-and-fire network
        │                     built ON the real cable graph; STDP synapses
        ▼
scripts/train-brains.ts      R-STDP training loop (offline, deterministic)
        │
        ▼
public/data/weights-{wire,janelia}.json           ← trained weights + gain
        │
        ▼
src/lib/audio-engine.ts      runtime: brains step on the audio clock,
                             motor spikes → voices (the music you hear)
```

**Both DJs are fully independent**: separate morphology sets, separate
training runs, separate weights, separate runtime instances. They share only
the stage and the clock.

## 2. The brains

Each brain is a leaky integrate-and-fire network with:

| Component | Value | Notes |
|---|---|---|
| Nodes | 14,400 (WIRE) / 12,669 (JANELIA) | sampled cable points from real reconstructions |
| Edges | ≈14k cable + 2NN branch grafts + channel-specific descending lines | cable edges are strict per-neuron trees (verified: 0 cross-neuron, 0 loops) |
| Thresholds | 0.30–0.48; motor pools +0.35 | motor elevation keeps tonic drive from firing them — beats must be earned |
| Weights | −0.6…+0.4, trained | inhibitory ≈18%, excitatory 82% |
| Leak | 0.10/substep | runtime (0.12 in training) |
| Cascade gain | from calibration (≤1.8) | `weights.wGain` |
| Ambient hum | from calibration (≤700) | `weights.ambient` — sub-threshold background (0.15) |
| Spike rule | v ≥ threshold → fire, reset −0.2, refractory 2 substeps | |

Determinism: all randomness is seeded (mulberry32 / xorshift32). Same seed →
same trace.

## 3. Training (R-STDP + best-checkpoint)

```
npx tsx scripts/train-brains.ts
```

- **Corpora** (`src/lib/brain/corpus.ts`): FLYWIRE trains on straight 4/4
  techno; JANELIA on syncopated breaks. 32-step (2-bar) patterns, 4 channels
  (kick / snare / hat / bass-or-lead).
- **Drive**: corpus onsets → sensory spikes into input groups (~560 nodes).
- **Teacher**: early epochs force motor-group spikes at onsets; probability
  decays to a floor of 0.02 — essentially no teacher by the end (curriculum,
  declared in PHILOSOPHY.md).
- **Reward (critic)**: hit on onset +0.5 · off-onset fire −1.0 · dropped
  strong onset −0.5. Dopamine gates plasticity; punishments ×0.4.
- **Plasticity**: reward-modulated STDP — causal pairings strengthen the
  synapse, late pairings weaken it; weights clamp [−0.6, +0.4]. Learning
  rate decays ~60% across the run so late updates polish instead of churn.
- **Best checkpoint**: every 10 epochs (from epoch 40) a teacher-free
  generation probe runs; the weights with the best probe are kept and
  restored at the end.
- **Fine-tune**: after the main run, 40 more epochs with the teacher fully
  off — consequences only (sensory context + critic + STDP). Fine-tuned
  weights compete with the main-run checkpoint by the same probe, so this
  stage can only keep an improvement. (`fineTuneEpochs` in `TrainOptions`.)
- **Generation test**: two teacher-free passes over the corpus. Reports
  `generationF1` (beat alignment, pass 0), `divergence` (fraction of fired
  channel-steps OFF-corpus — structure not copied), `uniqueBars` (distinct
  2-bar patterns across passes). Stepping is deterministic, so `uniqueBars`
  is 1 unless runtime-style stochastic context is added; divergence counts
  any spike, while runtime voices only trigger on ≥3-spike bursts, so
  audible precision is higher than the raw number suggests.

### Pass gates (all must hold)
- `generationF1 ≥ 0.35` — plays the learned style with the teacher off
- `onsetSelectivity ≥ 1.8` — motor firing concentrated on onset steps (the rhythm test)
- `participation ≥ 0.10` — the brain is alive, not silent. NOTE: high
  participation is NOT a virtue — 60–100% means tonic avalanche, which
  drowns the beat (this actually happened; see calibration notes)

Calibration (quiet-brain regime): ambient hum 300 stimulations/step @ 0.15
(sub-threshold — background alone never fires a node), cascade gain starts
1.4 and escalates only to 1.8 / hum 700 while participation < 25%.

Current results (see `public/data/train-report.json`):
- WIRE: passed · genF1 0.44 · onsetSelectivity 4.39 · participation 0.62
  (kick bursts 28–41 spikes on onset steps, 0–10 between — four-on-the-floor)
- JANELIA: passed · genF1 0.39 · onsetSelectivity 5.74 · participation 0.67

## 4. Runtime music generation

`audio-engine.ts` steps each brain once per musical 16th (4 substeps):

1. **Sensory context** — corpus onsets stimulate input groups at
   training-level energy (~38–50 nodes @ ~1.15–1.3, per-player `boost`).
   The context is the environment, not the music; it varies every pass
   (probability, jitter, spontaneity) so no two loops are identical.
   The calibrated **ambient hum** (`weights.ambient` stimulations @ 0.95)
   runs every step to keep the full volume recruited.
2. **Spikes** — `stepDetailed()` returns motor-channel spike counts + central
   firing. Voices trigger only on **coordinated bursts** (≥3 spikes in a
   channel-step) — ambient scatter stays silent.
3. **Voice map** — WIRE: kick / snare / hat / bass (lanes A,S audio).
   JANELIA: ghost-kick / ghost-snare / hat accents / bass (lanes K,L audio).
4. **Drops** — when both brains' motor bursts co-occur (joint synchrony
   ≥ 0.55, 8-bar cooldown) the filter opens, the stage erupts, and JANELIA's
   glasses drop. The drop is a measured neural event, not a timer.

## 5. Extension guide

| Want to… | Do this |
|---|---|
| Add a neuropil | Append to `NEUROPHILS` in `src/lib/brain/atlas.ts`, re-run `scripts/relayout-brains.ts`, bump `DATA_VERSION` |
| Add a track | Add a `Corpus` to `corpus.ts`, push into the player's `tracks` array in `audio-engine.ts` |
| Retrain | `npx tsx scripts/train-brains.ts` (background it; ~30–60s per brain). Then bump `DATA_VERSION` in `neural-sim.ts` — bundles are cached immutable |
| Change energy | `boost` per player in `load()` + `brain.wGain` / `ambient` from calibration |
| Tune the fine-tune stage | `fineTuneEpochs` in `TrainOptions` / `train-brains.ts` jobs |
| Tighten the pass gate | `passed` in `train.ts` (currently genF1 ≥ 0.35 && participation ≥ 0.8) |
| New metric | Extend `TrainReport` + the generation test / calibration block; the report ships to `train-report.json` |
| Smoke-test weights offline | `npx tsx scripts/brain-probe3.ts` · `npx tsx scripts/participation-probe.ts` (read-only, no training) |

## 6. Data provenance

- Neuron reconstructions: NeuroMorpho.org — Drosophila melanogaster, CNG SWC
  format, archives Bock (EM, brain) / Williams (EM, VNC) / Cirelli.
  36 neurons (WIRE) + 34 neurons (JANELIA) = 27,069 cable nodes across the
  two bundles. The raw SWC fetch script is not in the repo; bundles are
  checked in and re-layouted by `scripts/relayout-brains.ts`.
- Connectome statistics referenced: FlyWire 783 release (Schlegel et al.,
  Nature 2024) — full wiring is future work (Zenodo 10676866, public).
- Thresholds, weights, gains: modeled parameters, documented inline.
