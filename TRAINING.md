# FLYTAPE — Brain Training & Architecture Guide

How the two DJ brains are built from the real FlyWire connectome, trained,
calibrated, and how to extend them. Philosophy lives in `PHILOSOPHY.md`.
This file is the operator manual. Everything below describes what actually
ships — including the parts that failed and were rebuilt.

---

## 1. System overview

```
FlyWire FAFB v783 proofread connectome (Zenodo 10676866)
Dorkenwald et al. 2024 — 139,255 neurons, whole adult fly brain
        │  scripts/build-flywire.py
        ▼
public/data/flywire-topology.bin        binary CSR graph:
        │  + flywire-meta.json          15,071,499 measured connections,
        │                               neurotransmitter signs, real positions,
        │                               sensory + output populations
        ▼
src/lib/flywire-brain.ts                binary loader + whole-brain adoption
        │
        ▼
scripts/train-flywire.ts                R-STDP protocol per DJ corpus
        │  (resume-capable: 10-epoch weight snapshots)
        ▼
public/data/flywire-weights-{wire,janelia}.bin   trained weights (int8)
        │  + flywire-ambient.json               calibrated hum densities
        │  + train-report-flywire.json          full honest report
        ▼
src/lib/audio-engine.ts                 runtime: brains step on the audio
                                        clock — motor bursts → voices
```

**Both DJs are the SAME real brain** — the complete FlyWire connectome,
loaded once and shared. DJ FLYWIRE and MC JANELIA differ only in trained
weights and corpora. Same anatomy, different upbringing.

The legacy NeuroMorpho path (70 sampled neurons, modeled wiring) is kept in
git history and `scripts/fetch-neuromorpho.py`; it is superseded.

## 2. The brains

| Component | Value | Notes |
|---|---|---|
| Neurons | 139,255 (both DJs) | every proofread neuron of FAFB v783 — none sampled out |
| Connections | 15,071,499 directed | measured synapses, aggregated per (pre, post) pair from 16.8M neuropil-split rows |
| Inhibitory share | 19.0% | sign from each connection's measured neurotransmitter mix (GABA-dominant → inhibitory) |
| Neuron model | LIF: one voltage, threshold, 2-substep refractory | threshold 0.30–0.48 heterogeneous; motor pools +0.15 elevation |
| Positions | 79.5% real | input-weighted centroid of innervated FlyWire neuropils, JRC2018-relative; unplaced neurons openly marked |
| Cascade gain | calibrated (1.4–1.8) | `weights.wGain` |
| Ambient hum | calibrated (≤48k stimulations/step @ 0.18) | sub-threshold — background alone never fires a neuron |
| Step | 2 substeps per musical 16th at 96 BPM | 4 was slower and trained no better |

Deterministic: mulberry32/xorshift seeding everywhere. Same seed → same run.

## 3. Training (R-STDP on the real connectome)

```
npx tsx scripts/train-flywire.ts
```

Per DJ (wire: straight 4/4 techno, 150 epochs · janelia: syncopated breaks,
120 epochs — counts tuned to wall time, see §5):

- **Sensory drive**: corpus onsets stimulate the real populations — 120
  neurons @ 1.25 per onset into olfactory / optic / MB+LH / central-complex
  input groups (measured populations, top 400 by input synapses each).
- **Teacher**: force-fires motor targets early, probability decays
  1.0 → 0.02 (≈ zero by the end; PHILOSOPHY.md principle 2).
- **Critic**: motor bursts scored after the fact — hit the beat earns
  reward, off-beat fire costs more than hitting pays; punishments ×0.4.
- **Plasticity**: reward-gated STDP on the real synapses. Eligibility is
  subsampled on high-degree neurons (≤4 edges per presynaptic spike,
  deterministic stride) and the active set is ring-capped at 65,536 —
  declared approximations; without them, hub cascades mark millions of
  edges per epoch and training grinds (measured: 115 s/epoch at 17.8M
  active traces vs ~10 s bounded).
- **Best checkpoint**: teacher-free generation probes every 10 epochs; the
  best probe's weights are restored at the end.
- **Fine-tune**: 40 consequence-only epochs after the main run; competes
  with the main checkpoint by the same probe.
- **Calibration**: participation during playback is measured; cascade gain
  (1.4–1.8) and ambient hum (4k–48k) escalate until ≥80% of neurons fired
  within the last 4 bars — or caps are reached, and the honest number ships.

**Snapshot/resume**: every 10 epochs the full weight vector (67 MB) is
snapshotted to `flywire-snapshot-{fly}.bin`; a killed or interrupted run
resumes from the last checkpoint on relaunch. Completed training deletes
its snapshot.

### Pass gates (all must hold)
- `generationF1 ≥ 0.35` — plays the style with the teacher off
- `onsetSelectivity ≥ 1.8` — motor firing concentrates on onset steps
- `participation ≥ 0.80` — ≥80% of neurons fired within the last 4 bars

### What the first attempts taught us (kept here so we don't re-learn it)

1. **Random output pools → silence.** The first FlyWire training picked
   the brain's highest-output neurons as "motor pools". With the teacher
   off, recall collapsed to 3%: nothing in the measured connectome drives
   those neurons from the senses. Output pools are now each channel's
   *downstream convergence targets* — the neurons its sensory population
   demonstrably drives, ranked by received synapses. Real labeled lines.
2. **Unbounded eligibility → seizure-slow training.** Hub neurons (up to
   9,617 out-edges) mark thousands of eligibility traces per spike; at a
   0.9 decay the active set reached 17.8M edges and epochs took 115 s.
   Subsampling + ring cap + a tighter trace window (0.6) bounded it.
3. **Motor elevation matters more as brains grow.** Without it, tonic
   cascade noise fires the pools on every step (the "precision 0.258,
   recall 1.0" wall-of-sound signature).

## 4. Runtime music generation

`audio-engine.ts` steps each brain per musical 16th (2 substeps) at 96 BPM:

1. **Sensory context** — corpus onsets stimulate input groups (100–130
   neurons @ ~1.25, per-DJ boost) with probability/jitter so no two loops
   match; the calibrated ambient hum (`weights.ambient` @ 0.18) runs every
   step. Playback runs with `learning = false` — no trace bookkeeping,
   pure LIF + delivery, which is what makes 139,255 neurons realtime.
2. **Voices** — motor bursts (≥3 spikes in a channel-step) become sounds.
   Channels with a written score voice only bursts landing within ±1 step
   of a scored onset — between-note bursts stay silent so the written line
   is audible. Rhythm channels voice freely (that is the IDM character).
3. **Records** — each DJ's crate: upbringing corpus + Beethoven IDM cuts +
   Gymnopédie + originals (public domain / original; River Flows in You is
   copyrighted and deliberately absent). Track switch every 16 bars.
4. **Drops** — joint motor-synchrony between both brains (≥0.55, 8-bar
   cooldown) opens the filter. A measured neural event, not a timer.

The audit log streams it all live: motor spikes per bar, node utilization
(% of the 139,255 that fired in the last 4 bars — the same number the
brain panels and the 3D renders display), synchrony, track switches.

## 5. Verification (run after any training)

The FlyWire path is verified by `train-flywire.ts` itself: timing lines
per epoch (ms/step, spike counts, active-trace set size), generation test
(F1 / onset selectivity / divergence / unique bars), calibration log, and
the shipped `train-report-flywire.json`. The legacy probes remain for the
70-neuron path:

```bash
npx tsx scripts/brain-probe3.ts          # offline burst probe
npx tsx scripts/participation-probe.ts   # utilization probe
```

## 6. Extension guide

| Want to… | Do this |
|---|---|
| Retrain | `npx tsx scripts/train-flywire.ts` (resumes from snapshots automatically) |
| Rebuild the connectome bundles | `python scripts/build-flywire.py` (needs FlyWire v783 feathers from Zenodo 10676866; see script header) |
| Refresh after training | bump `DATA_VERSION` in `src/lib/neural-sim.ts` — bundles are cached immutable |
| Add a record | add a `Corpus` to `corpus.ts`, push into the crate in `audio-engine.ts`; melodic corpora set `scale: CHROMATIC` and write semitones ≤ 11 |
| Tune the crate order | the arrays in `BrainModeController.load()` — index 0 is the upbringing, index 1 opens the set |
| Tune drive/calibration | `stimCount` / `stimEnergy` / `humStart` / `humCap` in `TrainOptions` |
| Tighten the pass gates | `passed` in `train.ts` |
| New metric | extend `TrainReport` + the generation test; ships in `train-report-flywire.json` |

## 7. Data provenance

- Connectome: FlyWire FAFB v783 proofread release — Dorkenwald et al.,
  *Nature* 2024; bulk data Zenodo 10676866 (public, no login).
- Neurotransmitter signs: per-connection NT mix from the same release
  (GABA-dominant → inhibitory; ACh/Glut/other → excitatory).
- Legacy morphology bundles (NeuroMorpho.org, Bock/Williams EM, CC BY 4.0)
  remain in `public/data/fly-neurons-*.json` for the legacy path and are
  verified 1:1 against the NeuroMorpho API.
- Thresholds, weights, gains, hum: modeled parameters, documented inline.
- Model limitations, stated plainly: LIF point neurons (no ion channels,
  no dendrites), weight magnitudes derived from synapse counts, STDP
  eligibility subsampled on hubs, dopamine = one float. The connectome
  itself — neurons, edges, signs, positions, populations — is measured.
