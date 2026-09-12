import { brainBridge } from "./brain-bridge";
import {
  FLYWIRE_CORPUS,
  FLYWIRE_TRACK_B,
  FLYWIRE_TRACK_C,
  FLYWIRE_TRACK_D,
  FLYWIRE_TRACK_E,
  FLYWIRE_TRACK_F,
  JANELIA_CORPUS,
  JANELIA_TRACK_B,
  JANELIA_TRACK_C,
  JANELIA_TRACK_D,
  JANELIA_TRACK_E,
  JANELIA_TRACK_G,
  JANELIA_TRACK_H,
  JANELIA_TRACK_I,
  PENTATONIC,
} from "./brain/corpus";
import { DATA_VERSION, flywireSim, janeliaSim } from "./neural-sim";

export type Lane = 0 | 1 | 2 | 3; // kept for API compat

export interface VisualEvent {
  time: number;
  type: "kick" | "snare" | "bar" | "drop" | "drop-end" | "reward";
}

/** playback tempo — single source of truth for every BPM display */
export const BPM = 96;
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
  const scale = corpus.scale ?? PENTATONIC;
  const deg = pit[bestIdx % pit.length] ?? 0;
  return scale[deg % scale.length] ?? 0;
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

class BrainModeController {
  loaded = false;
  loading = false;
  /** voiced-burst bookkeeping happens worker-side; these are the last bar's counts */
  private lastBarCounts = { wire: 0, janelia: 0 };
  private pendingSwitch = false;

  get ready(): boolean {
    return brainBridge.ready;
  }

  /** preload without enabling — called on app mount so START is instant */
  preload(): void {
    brainBridge.start();
    brainBridge.whenReady(() => {
      this.loaded = true;
    });
  }

  async load(): Promise<void> {
    this.preload();
    if (brainBridge.error) throw new Error(brainBridge.error);
    await new Promise<void>((resolve) => {
      const check = () => (brainBridge.ready ? resolve() : setTimeout(check, 50));
      check();
    });
  }

  /** live readout of the actual music-generating brain — one per fly */
  flyDrive(fly: "wire" | "janelia"): { motor: number; think: number } {
    return brainBridge.flyDrive(fly);
  }

  /** lastFire snapshots from the worker — the 3D renders read utilization */
  lastFireSnap(fly: "wire" | "janelia"): { lastFire: Float32Array; tSub: number } | null {
    return brainBridge.fireSnap(fly);
  }

  /** raw unsmoothed spike output of the most recent 16th, with a step index
   *  so consumers can detect brain events (new idx = brain just stepped) */
  spikesNow(): {
    idx: number;
    wire: { motor: number; central: number };
    janelia: { motor: number; central: number };
  } {
    return brainBridge.spikesNow();
  }

  lastBarSpikeCounts() {
    return this.lastBarCounts;
  }

  /** fraction of nodes that fired within the last 4 bars — worker-computed */
  participation(_windowSubsteps = 256): { wire: number; janelia: number } {
    return brainBridge.participation();
  }

  trackNames(): { wire: string; janelia: string } | null {
    return brainBridge.ready ? brainBridge.trackNames : null;
  }

  /** per-bar synchrony now computed worker-side; main thread only reads */
  synchrony(): number {
    this.lastBarCounts = { ...brainBridge.barCounts };
    return brainBridge.sync;
  }

  switchTrack(): { wire: string; janelia: string } | null {
    brainBridge.switchTrack();
    return brainBridge.ready ? brainBridge.trackNames : null;
  }

  requestStep(cStep: number): Promise<import("./brain-bridge").StepResult> {
    return brainBridge.requestStep(cStep);
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
        // synchrony() snapshots the bar's spike counts before resetting them —
        // read counts AFTER it so the log line shows the bar it describes
        const sync = this.brains.synchrony();
        const counts = this.brains.lastBarSpikeCounts();
        const util = this.brains.participation(512); // nodes fired in last 4 bars — matches calibration
        const note =
          `bar ${bar}: ${counts.wire}+${counts.janelia} motor spikes, ` +
          `util ${(util.wire * 100).toFixed(0)}%+${(util.janelia * 100).toFixed(0)}%, sync ${sync.toFixed(2)}`;
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
        const util = this.brains.participation(512);
        flywireSim.auditEvent(
          `bar ${bar}: ${counts.wire} motor spikes, util ${(util.wire * 100).toFixed(0)}% (build/roll)`
        );
        janeliaSim.auditEvent(
          `bar ${bar}: ${counts.janelia} motor spikes, util ${(util.janelia * 100).toFixed(0)}% (build/roll)`
        );
        this.visualEvents.push({ time: t, type: "reward" });
      }
    }
    if (this.lastDropBar >= 0 && bar >= this.lastDropBar + 8 && s === 0) {
      this.visualEvents.push({ time: t, type: "drop-end" });
      this.lastDropBar = -99;
    }

    // ---- THE MUSIC: brain spikes, nothing else ----
    // stepping happens in the worker; voices schedule from the response,
    // targeted at this step's audio time (response arrives inside the
    // 150 ms lookahead; late responses play immediately instead)
    if (this.brains.ready) {
      this.brains
        .requestStep(step % 32)
        .then((res) => {
          if (res.kick) {
            this.visualEvents.push({ time: t, type: "kick" });
          }
          if (res.snare) {
            this.visualEvents.push({ time: t, type: "snare" });
          }
          for (const n of res.notes) {
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
                this.bass(t, n.pitch, n.fly === "wire", n.fly === "wire" ? 0.24 : 0.16);
                break;
              }
            }
          }
        })
        .catch(() => {});
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
