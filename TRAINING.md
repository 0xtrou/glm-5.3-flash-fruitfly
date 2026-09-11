# FLYTAPE — Brain Training & Architecture Guide

How the two DJ brains are built, trained, calibrated, and how to extend them.
Philosophy lives in `PHILOSOPHY.md`. This file is the operator manual.

---

## 1. System overview

```
NeuroMorpho.org (real fly neuron SWCs)
        │  scripts/fetch_fly2.py  (72 neurons, 2 disjoint sets)
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
| Edges | ≈14k cable + axonal branch grafts | real parent→child cables, both directions |
| Thresholds | 0.30–0.48, heterogeneous | per-node excitability varies (real neurons vary) |
| Weights | −0.6…+0.4, trained | inhibitory ≈18%, excitatory 82% |
| Leak | 0.10/substep | runtime (0.12 in training) |
| Cascade gain | from calibration (≥1.5) | `weights.wGain` |
| Ambient hum | from calibration (≥900) | `weights.ambient` — background synaptic noise |
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
  decays to a floor (curriculum, declared in PHILOSOPHY.md).
- **Reward (critic)**: hit on onset +0.5 · off-onset fire −1.0 · dropped
  strong onset −0.5. Dopamine gates plasticity; punishments ×0.4.
- **Plasticity**: reward-modulated STDP — causal pairings strengthen the
  synapse, late pairings weaken it; weights clamp [−0.6, +0.4].
- **Best checkpoint**: every 20 epochs a teacher-free generation probe runs;
  the weights with the best probe are kept and restored at the end.

### Pass gates (both must hold)
- `generationF1 ≥ 0.35` — plays the learned style with the teacher off
- `participation ≥ 0.80` — ≥80% of nodes fired within the last bar

Current results (see `public/data/train-report.json`):
- WIRE: passed · genF1 0.41 (recall 1.0 — never misses a beat)
- JANELIA: passed · genF1 0.37 (precision 0.71 — clean, selective)

## 4. Runtime music generation

`audio-engine.ts` steps each brain once per musical 16th (4 substeps):

1. **Sensory context** — corpus onsets stimulate input groups at
   training-level energy (38–50 nodes @ ~1.15). The context is the
   environment, not the music; it varies every pass (probability, jitter,
   spontaneity) so no two loops are identical.
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
| Retrain | `npx tsx scripts/train-brains.ts` (background it; ~30–60s per brain) |
| Change energy | `boost` per player in `load()` + `brain.wGain` from calibration |
| Tighten the pass gate | `passed` in `train.ts` (currently genF1 ≥ 0.35 && participation ≥ 0.8) |
| New metric | Extend `TrainReport` + the calibration block; the report ships to `train-report.json` |

## 6. Data provenance

- Neuron reconstructions: NeuroMorpho.org — Drosophila melanogaster, CNG SWC
  format, archives Bock (EM, brain) / Williams (EM, VNC) / Cirelli.
  36 + 34 neurons per brain bundle, 15,120 cable nodes total.
- Connectome statistics referenced: FlyWire 783 release (Schlegel et al.,
  Nature 2024) — full wiring is future work (Zenodo 10676866, public).
- Thresholds, weights, gains: modeled parameters, documented inline.
