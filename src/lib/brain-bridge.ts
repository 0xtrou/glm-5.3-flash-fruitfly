/**
 * brain-bridge — main-thread handle to the brain worker.
 *
 * The worker owns the brains and all stepping math. This side keeps only
 * cached telemetry (drive EMAs, utilization, spike counters, track names,
 * lastFire snapshots) that UI components read synchronously, and routes
 * step/bar/switch requests. Every response updates the cache, so UI
 * getters never block.
 */
import type { StepMsg, BarMsg, WorkerNote } from "./brain-worker";

export type { WorkerNote };

export interface StepResult {
  notes: WorkerNote[];
  kick: boolean;
  snare: boolean;
}

export interface FlyDrive {
  motor: number;
  think: number;
}

export interface FireSnap {
  lastFire: Float32Array;
  tSub: number;
}

export interface VisualTopo {
  n: number;
  positions: Float32Array;
  adjStart: Uint32Array;
  edgeSample: Uint32Array;
}

class BrainBridge {
  private worker: Worker | null = null;
  ready = false;
  error: string | null = null;
  drive: Record<"wire" | "janelia", FlyDrive> = {
    wire: { motor: 0, think: 0 },
    janelia: { motor: 0, think: 0 },
  };
  spikes = {
    idx: 0,
    wire: { motor: 0, central: 0 },
    janelia: { motor: 0, central: 0 },
  };
  util: Record<"wire" | "janelia", number> = { wire: 0, janelia: 0 };
  barCounts: Record<"wire" | "janelia", number> = { wire: 0, janelia: 0 };
  sync = 0;
  trackNames: Record<"wire" | "janelia", string> = { wire: "", janelia: "" };
  fireSnaps: Record<"wire" | "janelia", FireSnap | null> = { wire: null, janelia: null };
  visualTopo: VisualTopo | null = null;

  private pendingStep: ((r: StepResult) => void) | null = null;
  private pendingBar: ((r: BarMsg) => void) | null = null;
  private pendingSwitch: ((names: Record<"wire" | "janelia", string>) => void) | null = null;
  private readyResolvers: (() => void)[] = [];
  private fireSubs: ((s: FireSnap, fly: "wire" | "janelia") => void)[] = [];

  /** resolves once both brains are built and stepping is possible */
  readyPromise(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.error) return Promise.reject(new Error(this.error));
    return new Promise((resolve, reject) => {
      this.readyResolvers.push(resolve);
      this.errorRejectors.push(reject);
    });
  }
  private errorRejectors: ((e: Error) => void)[] = [];

  start(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL("./brain-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    this.worker.onerror = (e) => {
      this.error = String((e as ErrorEvent).message ?? "worker error");
      for (const r of this.errorRejectors) r(new Error(this.error));
      this.errorRejectors = [];
    };
    this.worker.postMessage({ type: "load" });
  }

  onFire(sub: (s: FireSnap, fly: "wire" | "janelia") => void): void {
    this.fireSubs.push(sub);
  }

  whenReady(fn: () => void): void {
    void this.readyPromise().then(fn);
  }

  private onMessage(msg: Record<string, unknown> & { type: string }): void {
    switch (msg.type) {
      case "ready": {
        this.ready = true;
        this.trackNames = msg.trackNames as Record<"wire" | "janelia", string>;
        this.visualTopo = {
          n: msg.n as number,
          positions: msg.positions as Float32Array,
          adjStart: msg.adjStart as Uint32Array,
          edgeSample: msg.edgeSample as Uint32Array,
        };
        for (const r of this.readyResolvers) r();
        this.readyResolvers = [];
        this.errorRejectors = [];
        break;
      }
      case "step": {
        const m = msg as unknown as StepMsg;
        this.drive = m.drive;
        this.spikes = { idx: this.spikes.idx + 1, wire: m.spikes.wire, janelia: m.spikes.janelia };
        const fn = this.pendingStep;
        this.pendingStep = null;
        fn?.(m);
        break;
      }
      case "bar": {
        const m = msg as unknown as BarMsg;
        this.barCounts = m.counts;
        this.sync = m.sync;
        this.util = { wire: m.utilWire, janelia: m.utilJanelia };
        const fn = this.pendingBar;
        this.pendingBar = null;
        fn?.(m);
        break;
      }
      case "switch": {
        this.trackNames = msg.trackNames as Record<"wire" | "janelia", string>;
        const fn = this.pendingSwitch;
        this.pendingSwitch = null;
        fn?.(this.trackNames);
        break;
      }
      case "fire": {
        const fly = msg.fly as "wire" | "janelia";
        const snap: FireSnap = {
          lastFire: msg.buf as Float32Array,
          tSub: msg.tSub as number,
        };
        this.fireSnaps[fly] = snap;
        for (const sub of this.fireSubs) sub(snap, fly);
        break;
      }
      case "error": {
        this.error = String(msg.message);
        for (const r of this.errorRejectors) r(new Error(this.error));
        this.errorRejectors = [];
        break;
      }
    }
  }

  /** request the next musical 16th from the worker; response schedules voices */
  requestStep(cStep: number): Promise<StepResult> {
    return new Promise((resolve) => {
      this.pendingStep = (r) => resolve({ notes: r.notes, kick: r.kick, snare: r.snare });
      this.worker?.postMessage({ type: "step", cStep });
    });
  }

  requestBar(): Promise<BarMsg> {
    return new Promise((resolve) => {
      this.pendingBar = (r) => resolve(r);
      this.worker?.postMessage({ type: "bar" });
    });
  }

  switchTrack(): void {
    this.worker?.postMessage({ type: "switch" });
  }

  flyDrive(fly: "wire" | "janelia"): FlyDrive {
    return this.drive[fly];
  }

  spikesNow(): {
    idx: number;
    wire: { motor: number; central: number };
    janelia: { motor: number; central: number };
  } {
    return this.spikes;
  }

  participation(): { wire: number; janelia: number } {
    return { wire: this.util.wire, janelia: this.util.janelia };
  }

  fireSnap(fly: "wire" | "janelia"): FireSnap | null {
    return this.fireSnaps[fly] ?? null;
  }
}

export const brainBridge = new BrainBridge();
