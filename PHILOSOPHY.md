# PHILOSOPHY — Teaching Two Fly Brains to Play Music

## What this is

Two brains. Each one is a spiking network built on the real reconstructed
cable structure of *Drosophila* neurons (NeuroMorpho.org, EM labs Bock,
Cirelli, Williams), trained until they play music. Nobody writes a note.
We build the conditions under which notes get earned.

## Four principles

### 1. Learning is wiring, not data

The brain never stores notes. It starts with real connectome-style wiring —
mostly wrong for music — and one rule from real neuroscience:
**neurons that fire just before other neurons get stronger connections to
them** (spike-timing-dependent plasticity, STDP). Every synapse carries a
timestamped memory of *did I help cause that?* Causal within ~20 ms →
strengthen. Late → weaken. Music is pure temporal causation, so one rule is
enough machinery to learn it.

### 2. Nobody teaches. Only consequences.

There is no labeled correct output. The brain hears the corpus (sensory
spikes in), its motor neurons fire whenever they fire, and a critic —
standing in for dopamine — judges *after the fact*: were your outputs on
the beat? In scale? Alive but not random? Reward arrives as a dopamine
pulse exactly when the score is good; nothing arrives when it is bad
(reward-modulated STDP — the same gate dopaminergic neurons use for motor
learning). The brain must discover which of its own spikes earned the
reward. That discovery, not copying, is the training.

A **fading teacher** bootstraps the earliest epochs (target spikes injected
directly into motor neurons, probability decaying to ~0). This is reward
shaping, a curriculum — declared here, not hidden. By the end of training
the teacher is gone and every spike is the brain's own.

### 3. Generation is the proof of learning

After training the corpus is taken away. The brain plays from its own
internal dynamics: learned wiring holds rhythm attractors, so it keeps
producing beat-aligned, in-scale patterns with no teacher. If it only
echoed the training data, it failed. If it produces structure it was never
shown — variations, fills, call-and-response between its own regions — it
learned *music*, not tape. That is the difference between a recording and
a musician, and the metrics in `train-report.json` test exactly this line:
beat-alignment F1, in-scale ratio, silence ratio, and generated-vs-corpus
divergence.

### 4. Identity comes from upbringing

Same species wiring, different experience. FLYWIRE trains on straight 4/4 —
minimal, locked, metronomic. MC JANELIA trains on syncopated breaks —
offbeat, reactive. Nothing in code distinguishes them except the corpus.
Whatever differences emerge in their playing are acquired taste: learned
wiring, not configuration.

## The claim

Real structure (neural cables) + one causal rule (STDP) + consequences
(dopamine critic) + upbringing (corpus) = a fly that plays its own music.
We never write a note.

If this converges, it demonstrates that reward-gated Hebbian plasticity on
real neural topology is sufficient for temporal art. That claim is testable,
exportable (`train-report.json`), and citable.
