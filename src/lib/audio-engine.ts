import { LIFBrain } from "./brain/core";
import {
  FLYWIRE_CORPUS,
  FLYWIRE_TRACK_B,
  FLYWIRE_TRACK_C,
  JANELIA_CORPUS,
  JANELIA_TRACK_B,
  JANELIA_TRACK_C,
  PENTATONIC,
} from "./brain/corpus";
import { DATA_VERSION, flywireSim, janeliaSim } from "./neural-sim";

export type Lane = 0 | 1 | 2 | 3; // kept for API compat

export interface VisualEvent {
  time: number;
  type: "kick" | "snare" | "bar" | "drop" | "drop-end" | "reward";
}

const BPM = 128;
/** nearest-onset pitch lookup for a melodic channel (what the brain learned) */
function corpusPitchAt(corpus: typeof FLYWIRE_CORPUS, step: number, channel: number): number {
  const on = corpus.onsets[channel % corpus.onsets.length];
  const pit = corpus.pitches?.[channel];
  if (!on || !pit) return 0;
  let bestIdx = 0;
  let bestD = 99;
  for (let i = 0; i < on.length; i++) {
    const d = Math.abs(step - on[i]);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return pit[bestIdx % pit.length] ?? 0;
}

interface BrainWeights {
  n: number;
  adjStart: number[];
  adjPost: number[];
  adjW: number[];
  revStart: number[];
  revPre: number[];
  revE: number[];
  inputGroups: number[][];
  motorGroups: number[][];
}

export interface BrainNote {
  fly: "wire" | "janelia";
  channel: number;
  voice: "kick" | "snare" | "hat" | "bass" | "ghost-kick" | "ghost-snare";
  count: number;
  time: number;
}

class BrainPlayer {
  brain: LIFBrain;
  private corpus: typeof FLYWIRE_CORPUS;
  private tracks: (typeof FLYWIRE_CORPUS)[];
  trackIdx = 0;

  setTrack(idx: number) {
    this.trackIdx = idx % this.tracks.length;
    this.corpus = this.tracks[this.trackIdx];
  }

  get trackStyle(): string {
    return this.corpus.style;
  }

  constructor(weights: BrainWeights, tracks: (typeof FLYWIRE_CORPUS)[], seed: number, boost = 1) {
    this.boostFor = boost;
    this.tracks = tracks;
    this.corpus = tracks[0];
    this.brain = new LIFBrain(
      { points: new Array(weights.n).fill(0) as [number, number, number][], edges: [], neuronCount: weights.n },
      { seed, inputGroups: weights.inputGroups, motorGroups: weights.motorGroups }
    );
    // adopt trained topology + weights without re-randomizing
    this.brain.n = weights.n;
    this.brain.adjStart = new Uint32Array(weights.adjStart);
    this.brain.adjPost = new Uint32Array(weights.adjPost);
    this.brain.adjW = new Float32Array(weights.adjW);
    this.brain.revStart = new Uint32Array(weights.revStart);
    this.brain.revPre = new Uint32Array(weights.revPre);
    this.brain.revE = new Float32Array(weights.revE.length);
    this.brain.v = new Float32Array(weights.n);
    this.brain.refracUntil = new Int32Array(weights.n);
    this.brain.preTrace = new Float32Array(weights.n);
    this.brain.postTrace = new Float32Array(weights.n);
    this.brain.inputGroups = weights.inputGroups;
    this.brain.motorGroups = weights.motorGroups;
  }

  private improvSeed = 7;
  private boostFor = 1;

  private rand(): number {
    // xorshift — varies per call, gives each pass through the corpus a life of its own
    let a = (this.improvSeed = (this.improvSeed + 0x9e3779b9) | 0);
    a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
    a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
    return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
  }

  /**
   * One musical 16th. Sensory context = learned corpus + live variation:
   * onsets fire with ~88% probability, 10% gain an extra spur, and every
   * ~16 steps a random channel gets a spontaneous stimulus. The brain's
   * learned wiring turns that stream into its own evolving beat — never
   * the same loop twice.
   */
  step(cStep: number): { counts: Map<number, number>; motorSpikes: number; centralSpikes: number } {
    for (let ch = 0; ch < this.corpus.channels; ch++) {
      const on = this.corpus.onsets[ch].includes(cStep);
      const boost = this.boostFor;
      if (on && this.rand() < 0.97) {
        const extra = this.rand() < 0.1 ? 14 : 0;
        this.brain.stimulate(ch, Math.round((38 + ((this.rand() * 12) | 0) + extra) * boost), (1.12 + this.rand() * 0.1) * Math.min(1.15, boost));
      } else if (!on && this.rand() < 0.12) {
        // spontaneous off-grid thought
        this.brain.stimulate(ch, 12 + ((this.rand() * 10) | 0), 0.85);
      }
    }
    return this.brain.stepDetailed();
  }
}

class BrainModeController {
  loaded = false;
  loading = false;
  /** spikes this bar per brain — synchrony between them triggers drops */
  private barSpikes = { wire: 0, janelia: 0 };
  private lastBarCounts = { wire: 0, janelia: 0 };
  private lastSync = 0;
  private drive: Record<"wire" | "janelia", { motor: number; think: number }> = {
    wire: { motor: 0, think: 0 },
    janelia: { motor: 0, think: 0 },
  };
  private players: { wire: BrainPlayer; janelia: BrainPlayer } | null = null;

  get ready(): boolean {
    return this.loaded;
  }

  /** preload without enabling — called on app mount so START is instant */
  preload(): void {
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loaded || this.loading) return;
    this.loading = true;
    try {
      const [w, j] = await Promise.all([
        fetch(`/data/weights-wire.json?v=${DATA_VERSION}`).then((r) => r.json()),
        fetch(`/data/weights-janelia.json?v=${DATA_VERSION}`).then((r) => r.json()),
      ]);
      this.players = {
        wire: new BrainPlayer(w, [FLYWIRE_CORPUS, FLYWIRE_TRACK_B, FLYWIRE_TRACK_C], 11, 2.6),
        janelia: new BrainPlayer(j, [JANELIA_CORPUS, JANELIA_TRACK_B, JANELIA_TRACK_C], 47, 1.5),
      };
      this.loaded = true;
    } finally {
      this.loading = false;
    }
  }

  /**
   * The only music generator in the system.
   * FLYWIRE = rhythm section (kick, snare, hat, bass).
   * JANELIA = melodies + percussion color (lead, ghost snare, hat accent, soft kick).
   */
  step(cStep: number, time: number): { notes: BrainNote[]; kick: boolean; snare: boolean } {
    const notes: BrainNote[] = [];
    let kick = false;
    let snare = false;
    if (!this.players) return { notes, kick, snare };

    // FLYWIRE — the rhythm keeper
    const wireOut = this.players.wire.step(cStep);
    const wireCounts = wireOut.counts;
    const wireMap: { voice: BrainNote["voice"] }[] = [
      { voice: "kick" },
      { voice: "snare" },
      { voice: "hat" },
      { voice: "bass" },
    ];
    for (const [ch, count] of wireCounts) {
      if (count <= 0) continue;
      this.barSpikes.wire += count;
      const m = wireMap[ch] ?? { voice: "hat" as const };
      notes.push({ fly: "wire", channel: ch, voice: m.voice, count, time });
      if (ch === 0) kick = true;
      if (ch === 1) snare = true;
    }

    // MC JANELIA — melodies + hype percussion
    const jOut = this.players.janelia.step(cStep);
    const jCounts = jOut.counts;
    const jMap: { voice: BrainNote["voice"] }[] = [
      { voice: "ghost-kick" },
      { voice: "ghost-snare" },
      { voice: "hat" },
      { voice: "bass" },
    ];
    for (const [ch, count] of jCounts) {
      if (count <= 0) continue;
      this.barSpikes.janelia += count;
      const m = jMap[ch] ?? { voice: "hat" as const };
      notes.push({ fly: "janelia", channel: ch, voice: m.voice, count, time });
      if (ch === 1) snare = true;
    }

    // EMA of each brain's real spike output — flies animate from THESE
    const k = 0.18;
    this.drive.wire.motor += (Math.min(1, wireOut.motorSpikes / 12) - this.drive.wire.motor) * k;
    this.drive.wire.think += (Math.min(1, wireOut.centralSpikes / 40) - this.drive.wire.think) * k;
    this.drive.janelia.motor += (Math.min(1, jOut.motorSpikes / 12) - this.drive.janelia.motor) * k;
    this.drive.janelia.think += (Math.min(1, jOut.centralSpikes / 40) - this.drive.janelia.think) * k;

    return { notes, kick, snare };
  }

  /** live readout of the actual music-generating brain — one per fly */
  flyDrive(fly: "wire" | "janelia"): { motor: number; think: number } {
    return this.drive[fly];
  }

  lastBarSpikeCounts() {
    return this.lastBarCounts;
  }

  /**
   * Motor synchrony 0..1 between the two brains — the biological drop trigger.
   * Called at bar boundaries; resets the per-bar counters.
   */
  synchrony(): number {
    const a = this.barSpikes.wire;
    const b = this.barSpikes.janelia;
    this.lastBarCounts = { wire: a, janelia: b };
    this.barSpikes.wire = 0;
    this.barSpikes.janelia = 0;
    // synchrony = both brains actively contributing in the same bar
    // (they have different trained recall — equality is NOT required,
    //  joint activity is). ≥ ~20 spikes each → full synchrony.
    const joint = Math.min(a, b);
    return Math.min(1, joint / 25);
  }

  switchTrack(): { wire: string; janelia: string } | null {
    if (!this.players) return null;
    this.players.wire.setTrack((this.players.wire.trackIdx + 1) % 3);
    this.players.janelia.setTrack((this.players.janelia.trackIdx + 1) % 3);
    return { wire: this.players.wire.trackStyle, janelia: this.players.janelia.trackStyle };
  }

  noteSync() {
    this.lastSync = performance.now();
  }

  pitchFor(note: BrainNote, cStep: number): number {
    const corpus = note.fly === "wire" ? FLYWIRE_CORPUS : JANELIA_CORPUS;
    const deg = corpusPitchAt(corpus, cStep, note.channel);
    return PENTATONIC[deg % PENTATONIC.length];
  }
}

class AudioEngine {
  bpm = BPM;
  stepDur = 60 / BPM / 4;
  visualEvents: VisualEvent[] = [];
  started = false;
  startTime = 0;
  brains = new BrainModeController();

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private analyser!: AnalyserNode;
  private noise!: AudioBuffer;
  private step = 0;
  private nextStepTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingDrop = false;
  private lastDropBar = -99;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(64));

  get time(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get simTime(): number {
    return this.started ? Math.max(0, this.ctx!.currentTime - this.startTime) : 0;
  }

  get bar(): number {
    return Math.floor(this.step / 16);
  }

  start() {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    void this.ctx.resume();
    void this.brains.load(); // brains ARE the music — load before the first bar lands

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 500;
    this.filter.Q.value = 0.8;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.75;
    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.master.connect(this.filter);
    this.filter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.started = true;
    this.startTime = this.ctx.currentTime;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
  }

  toggleMute(): boolean {
    if (!this.ctx) return false;
    const muted = this.master.gain.value > 0;
    this.master.gain.value = muted ? 0 : 0.85;
    return muted;
  }

  redrop() {
    if (!this.ctx || this.pendingDrop) return;
    this.pendingDrop = true;
  }

  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      const f = 452 + i * 7;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 1.05, t + 0.35);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.03);
      g.gain.setValueAtTime(0.11, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.75);
    }
  }

  bassLevel(): number {
    if (!this.ctx || !this.started) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += this.freqData[i];
    return Math.min(1, sum / (8 * 200));
  }

  trebleLevel(): number {
    if (!this.ctx || !this.started) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    const bins = this.freqData.length;
    for (let i = Math.floor(bins * 0.45); i < bins; i++) sum += this.freqData[i];
    return Math.min(1, sum / ((bins - Math.floor(bins * 0.45)) * 160));
  }

  private tick() {
    if (!this.ctx) return;
    while (this.nextStepTime < this.ctx.currentTime + 0.15) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.stepDur;
    }
  }

  private scheduleStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;

    // ---- arrangement: filter arc + drop mechanics (mixing, not music) ----
    if (bar === 0 && s === 0) {
      this.filter.frequency.setValueAtTime(500, t);
    }
    if (this.pendingDrop && bar % 2 === 0 && s === 0) {
      this.filter.frequency.cancelScheduledValues(t);
      this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
      this.filter.frequency.exponentialRampToValueAtTime(320, t + 16 * this.stepDur);
    }
    if (bar === 4 && s === 0) this.openFilter(t, true);
    if (this.pendingDrop && bar % 2 === 1 && s === 0) {
      this.pendingDrop = false;
      this.openFilter(t, false);
    }

    // ---- visual events ----
    if (s === 0) {
      this.visualEvents.push({ time: t, type: "bar" });
      // brains decide the drop: synchrony between both motor populations
      if (bar >= 4 && !this.pendingDrop && this.brains.ready) {
        // track switching: every 16 bars the DJs change records
        if (bar % 16 === 0 && s === 0 && bar > 0) {
          const t = this.brains.switchTrack();
          if (t) {
            flywireSim.auditEvent(`TRACK SWITCH → "${t.wire}"`);
            janeliaSim.auditEvent(`TRACK SWITCH → "${t.janelia}"`);
          }
        }
        const counts = this.brains.lastBarSpikeCounts();
        const sync = this.brains.synchrony();
        const note = `bar ${bar}: ${counts.wire}+${counts.janelia} motor spikes, sync ${sync.toFixed(2)}`;
        if (sync > 0.55 && bar - this.lastDropBar >= 8) {
          this.pendingDrop = true;
          this.lastDropBar = bar;
          flywireSim.auditEvent(`${note} → DROP`);
          janeliaSim.auditEvent(`${note} → DROP`);
        } else {
          flywireSim.auditEvent(`${note} — no drop`);
          janeliaSim.auditEvent(`${note} — no drop`);
        }
        this.visualEvents.push({ time: t, type: "reward" });
      } else if (this.brains.ready) {
        const counts = this.brains.lastBarSpikeCounts();
        flywireSim.auditEvent(`bar ${bar}: ${counts.wire} motor spikes (build/roll)`);
        janeliaSim.auditEvent(`bar ${bar}: ${counts.janelia} motor spikes (build/roll)`);
        this.visualEvents.push({ time: t, type: "reward" });
      }
    }
    if (this.lastDropBar >= 0 && bar >= this.lastDropBar + 8 && s === 0) {
      this.visualEvents.push({ time: t, type: "drop-end" });
      this.lastDropBar = -99;
    }

    // ---- THE MUSIC: brain spikes, nothing else ----
    if (this.brains.ready) {
      const { notes, kick, snare } = this.brains.step(step % 32, t);
      if (kick) {
        this.visualEvents.push({ time: t, type: "kick" });
      }
      if (snare) {
        this.visualEvents.push({ time: t, type: "snare" });
      }
      for (const n of notes) {
        switch (n.voice) {
          case "kick":
            this.kick(t, 0.9);
            break;
          case "ghost-kick":
            this.kick(t, 0.4);
            break;
          case "snare":
            this.snare(t, 0.16);
            break;
          case "ghost-snare":
            this.snare(t, 0.08);
            break;
          case "hat":
            this.hat(t, false, n.fly === "janelia" ? 0.09 : 0.12);
            break;
          case "bass": {
            const semi = this.brains.pitchFor(n, step % 32);
            this.bass(t, semi, n.fly === "wire", n.fly === "wire" ? 0.24 : 0.16);
            break;
          }
        }
      }
    }
  }

  private openFilter(t: number, first: boolean) {
    if (!this.ctx) return;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    this.filter.frequency.exponentialRampToValueAtTime(18000, t + 0.08);
    this.crash(t);
    this.horn();
    this.visualEvents.push({ time: t, type: "drop" });
    void first;
  }

  // ---- voices ----
  private kick(t: number, gain = 1) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number, gain = 0.16) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  }

  private hat(t: number, open: boolean, gain = 0.1) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.24 : 0.05));
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }

  private bass(t: number, semi: number, accent: boolean, gain = 0.24) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(55 * Math.pow(2, semi / 12), t);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 9;
    lp.frequency.setValueAtTime(accent ? 2200 : 1400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.22);
  }

  private crash(t: number) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 1.35);
  }
}

export const audioEngine = new AudioEngine();
