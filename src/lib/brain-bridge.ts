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

/** worker bar reply — switchNames present when a track switch was requested */
export interface BarResult extends BarMsg {
  switchNames?: Record<"wire" | "janelia", string> | null;
}

export interface FlyDrive {
  motor: number;
  think: number;
}

export interface GfxSnap {
  version: number;
  tSub: number;
  glow: Float32Array;
  pulsePos: Float32Array;
  pulseAlpha: Float32Array;
}

export interface VisualTopo {
  n: number;
  positions: Float32Array;
  regions: Uint8Array;
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
  gfxSnaps: Record<"wire" | "janelia", GfxSnap | null> = { wire: null, janelia: null };
  private gfxVersion = 0;
  visualTopo: Record<"wire" | "janelia", VisualTopo | null> = { wire: null, janelia: null };

  private pendingStep: ((r: StepResult) => void) | null = null;
  private pendingBar: ((r: BarResult) => void) | null = null;
  private pendingSwitch: ((names: Record<"wire" | "janelia", string>) => void) | null = null;
  private readyResolvers: (() => void)[] = [];
  private fireSubs: ((s: GfxSnap, fly: "wire" | "janelia") => void)[] = [];

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

  onFire(sub: (s: GfxSnap, fly: "wire" | "janelia") => void): void {
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
        const n = msg.n as number;
        const adjStart = msg.adjStart as Uint32Array;
        const edgeSample = msg.edgeSample as Uint32Array;
        this.visualTopo = {
          wire: {
            n,
            positions: msg.wirePositions as Float32Array,
            regions: msg.wireRegions as Uint8Array,
            adjStart,
            edgeSample,
          },
          janelia: {
            n,
            positions: msg.janeliaPositions as Float32Array,
            regions: msg.janeliaRegions as Uint8Array,
            adjStart,
            edgeSample,
          },
        };
        for (const r of this.readyResolvers) r();
        this.readyResolvers = [];
        this.errorRejectors = [];
        break;
      }
      case "step": {
        const m = msg as unknown as StepMsg & { dbg?: Record<string, number> };
        if (m.dbg) (window as unknown as Record<string, unknown>).__brainStepDbg = m.dbg;
        this.drive = m.drive;
        this.spikes = { idx: this.spikes.idx + 1, wire: m.spikes.wire, janelia: m.spikes.janelia };
        const fn = this.pendingStep;
        this.pendingStep = null;
        fn?.(m);
        break;
      }
      case "bar": {
        const m = msg as unknown as BarMsg & { dbg?: Record<string, number> };
        if (m.dbg) (window as unknown as Record<string, unknown>).__brainDbg = m.dbg;
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
      case "gfx": {
        const fly = msg.fly as "wire" | "janelia";
        const snap: GfxSnap = {
          version: ++this.gfxVersion,
          tSub: msg.tSub as number,
          glow: msg.glow as Float32Array,
          pulsePos: msg.pulsePos as Float32Array,
          pulseAlpha: msg.pulseAlpha as Float32Array,
        };
        this.gfxSnaps[fly] = snap;
        for (const sub of this.fireSubs) sub(snap, fly);
        break;
      }
      case "error": {
        this.error = String(msg.message);
        console.error("[brain-bridge] worker error:", this.error);
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

  requestBar(wantSwitch = false): Promise<BarResult> {
    return new Promise((resolve) => {
      this.pendingBar = (r) => resolve(r);
      this.worker?.postMessage({ type: "bar", switch: wantSwitch });
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

  glowSnap(fly: "wire" | "janelia"): GfxSnap | null {
    return this.gfxSnaps[fly] ?? null;
  }
}

export const brainBridge = new BrainBridge();

// debug handle (read-only use from devtools)
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__brainBridge = brainBridge;
}
