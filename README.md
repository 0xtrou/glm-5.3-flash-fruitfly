# 🪩 FLYTAPE — Two Trained Fly Brains Generating Live Music

<p>
  <a href="https://fruitfly.solo.engineer"><strong>🎧 Live demo — fruitfly.solo.engineer</strong></a>
  ·
  <a href="https://github.com/0xtrou/glm-5.3-flash-fruitfly/blob/main/PHILOSOPHY.md">Philosophy</a>
  ·
  <a href="https://github.com/0xtrou/glm-5.3-flash-fruitfly/blob/main/TRAINING.md">Training guide</a>
</p>

<p>
  <img alt="100% brain-generated" src="https://img.shields.io/badge/notes-100%25%20brain--generated-34d399" />
  <img alt="zero scripted notes" src="https://img.shields.io/badge/scripted%20notes-0-black" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js%2016-000000" />
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-WebGL-white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6" />
</p>

---

**DJ FLYWIRE × MC JANELIA** are two spiking neural networks built on the real
reconstructed cable structure of *Drosophila melanogaster* neurons, trained
until they play music. Nobody writes a note — not a kick, not a bassline, not
a drop. Every sound you hear is a burst of real spikes from a network whose
wiring started as actual fly-neuron anatomy and was shaped by one rule:
**neurons that help cause good outcomes get stronger connections.**

> Real structure (neural cables) + one causal rule (STDP) + consequences
> (a dopamine critic) + upbringing (a corpus) = a fly that plays its own music.
> — [PHILOSOPHY.md](PHILOSOPHY.md)

## 🎧 The live set

- **DJ FLYWIRE** grew up on straight 4/4 techno — kick on the floor, metronomic, locked.
- **MC JANELIA** grew up on syncopated breaks — offbeat, reactive, loud.
- Same species wiring, different upbringing. Every difference in their playing is *learned*, not configured.
- **Drops are neural events**: when both brains' motor populations synchronize
  in the same bar, the filter opens. There is no drop timer.
- The **audit log** streams both brains' raw activity live: motor spikes per
  bar, node utilization, synchrony, track switches.

**→ Press START at [fruitfly.solo.engineer](https://fruitfly.solo.engineer)**

## 🧠 How it works

```
NeuroMorpho.org (real fly neuron SWC reconstructions)
        ▼
public/data/fly-neurons-{wire,janelia}.json     morphology bundles
        ▼
LIFBrain (src/lib/brain/core.ts)                leaky integrate-and-fire
        │                                       network ON the real cable
        ▼                                       graph, STDP synapses
scripts/train-brains.ts                         reward-modulated STDP
        ▼
public/data/weights-{wire,janelia}.json         trained weights + gain
        ▼
audio-engine.ts                                 brains step on the audio
                                                clock — motor spikes → voices
```

**1 · Real anatomy.** 70 reconstructed neurons (36 + 34; EM labs Bock &
Williams, via [NeuroMorpho.org](https://neuromorpho.org)) — 27,069 cable
nodes, strict parent→child neurite trees, laid out on a JRC2018-style atlas.

**2 · Training, not copying.** Sensory channels get corpus onsets; the
network's own motor bursts are scored *after the fact* by a critic standing
in for dopamine (hit the beat → reward, spam → punishment) and
reward-gated STDP updates the synapses. A teacher bootstraps the earliest
epochs and fades to zero; the shipped checkpoint is picked by a
**teacher-free generation probe**. [Full guide →](TRAINING.md)

**3 · Generation is the proof.** At runtime the corpus is only *sensory
context* — the environment, not the music. Voices trigger only on
coordinated bursts (≥3 spikes in a channel-step) of the motor pools. Take
the context away and the wiring still keeps time: that is the difference
between a recording and a musician.

## 📊 The brains, measured

| | DJ FLYWIRE | MC JANELIA |
|---|---|---|
| Nodes | 14,400 | 12,669 |
| Style | straight 4/4 techno | syncopated breaks |
| Generation F1 (teacher-free) | 0.44 | 0.39 |
| Onset selectivity (rhythm) | 1.89× | 2.32× |
| Node utilization | 83% | 81% |

The live site reports all of this in real time: `%util` per brain panel,
motor spike counts, and synchrony in the audit log — all computed from the
same spikes that make the sound.

## 🤝 The honest-data pledge

- **No mock data. No fake activity. No scripted notes.** Every musical voice
  is a spike burst from the trained networks; every visual (brain glow,
  fly avatars, utilization bars) reads the same firings.
- Training metrics are shipped unedited — including the failures
  (`public/data/train-report.json` records every epoch).
- Modeled parts are declared, not hidden: inter-neuron synapses and
  descending pathways are labeled-line approximations (the full 51.7M-synapse
  connectome is beyond realtime scope); the ambient "synaptic hum" is
  sub-threshold background noise.

## 🛠️ Run it locally

```bash
npm install
npm run dev          # → http://localhost:3000
```

Retrain the brains (deterministic, seeded; ~60–90s total):

```bash
npx tsx scripts/train-brains.ts          # writes public/data/weights-*.json + train-report.json
npx tsx scripts/brain-probe3.ts          # offline smoke probe (no training)
npx tsx scripts/participation-probe.ts   # participation histogram probe
```

After retraining, bump `DATA_VERSION` in `src/lib/neural-sim.ts` — the data
bundles are cached immutable.

## 📚 Docs

- [PHILOSOPHY.md](PHILOSOPHY.md) — why learning is wiring, not data
- [TRAINING.md](TRAINING.md) — operator manual: architecture, training loop,
  calibration, pass gates, extension guide

## 🧬 Credits & data provenance

- Neuron reconstructions: [NeuroMorpho.org](https://neuromorpho.org) —
  *Drosophila melanogaster*, CNG SWC format; archives **Bock** (EM, brain),
  **Williams** (EM, VNC), **Cirelli**.
- Connectome statistics referenced: **FlyWire 783** release
  (Schlegel et al., *Nature* 2024).
- Neuropil layout: JRC2018-template-relative approximations
  (Bogovic et al. 2020 / Schlegel et al. 2024).
- CNS visualization attribution: MaleCNS v1.0 (CC BY 4.0) / NeuroMechFly.

## 📄 License

Code: [MIT](LICENSE). Fly-neuron morphology data: CC BY 4.0, courtesy of the
source labs above — if you use the bundles, cite the original archives.
