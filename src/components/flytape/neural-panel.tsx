"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NeuralSim } from "@/lib/neural-sim";
import { TOTAL_SOMATA } from "@/lib/neural-sim";
import { audioEngine } from "@/lib/audio-engine";
import { NeuralBrain3D, driveSensory } from "./neural-brain-3d";

interface Props {
  sim: NeuralSim;
  title: string;
  accent: string;
  /** which audio transient drives this brain when the WebGL loop is not running */
  drive: "kick" | "treble";
  /** which trained brain this panel belongs to — util % reads ITS nodes */
  fly: "wire" | "janelia";
}

/**
 * CNS / NEURAL ACTIVITY — one panel per fly, fully independent:
 * own dataset (real NeuroMorpho reconstructions), own spiking dynamics,
 * own sensory drive. FLYWIRE rides kicks, JANELIA rides snare/hat energy.
 * Colors: dim = idle skeleton, mint = firing (+rate), amber = saturating.
 * Rendering is a dedicated Three.js scene (see neural-brain-3d.tsx); while
 * WebGL is unavailable this panel keeps the sim alive with a bare ticker.
 */
export function NeuralPanel({ sim, title, accent, drive, fly }: Props) {
  const [mounted, setMounted] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const webglRef = useRef(false);
  const [loadPct, setLoadPct] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const [isFs, setIsFs] = useState(false);

  const toggleFullscreen = () => {
    const el = sectionRef.current;
    if (!el) return;
    const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => void };
    const doc = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element | null };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else if (anyEl.requestFullscreen) {
      void anyEl.requestFullscreen().catch(() => {});
    } else {
      anyEl.webkitRequestFullscreen?.();
    }
  };

  useEffect(() => {
    const onFs = () =>
      setIsFs(Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  const [levels, setLevels] = useState({ motor: 0, central: 0 });
  const [util, setUtil] = useState(0);
  const [info, setInfo] = useState({ real: false, neurons: 0, points: 0, archives: [] as string[] });

  useEffect(() => setMounted(true), []);

  const handleWebgl = useCallback((alive: boolean) => {
    webglRef.current = alive;
    setWebglFailed(!alive);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setLoadPct(Math.round(sim.loadProgress * 100));
      setLevels({ motor: sim.motorLevel(), central: sim.centralLevel() });
      // real node utilization of THIS fly's trained brain (last 4 bars)
      setUtil(audioEngine.brains.participation(512)[fly]);
      if (sim.realData) {
        setInfo({
          real: true,
          neurons: sim.info.neurons,
          points: sim.info.points,
          archives: sim.info.archives,
        });
      }
    }, 150);
    return () => clearInterval(iv);
  }, [sim]);

  // Fallback ticker — while the 3D render loop is NOT alive (boot, WebGL
  // failure, context loss) it owns sim.tick so the brain stays live; the
  // moment the 3D loop reports alive it goes idle. Exactly one ticker at a time.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const driveState = { lastDrive: 0, lastPulseAt: 0 };
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop); // stays warm so it can resume after a context loss
      if (webglRef.current) return;
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      sim.tick(dt);
      driveSensory(sim, drive, driveState, ts);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim, drive]);

  const loading = loadPct < 100;
  const fetching = loadPct < 50;

  return (
    <section
      ref={sectionRef}
      className={`flex h-52 min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-[#04100b] lg:h-auto lg:min-h-[150px] lg:shrink ${isFs ? "fixed inset-0 z-50 h-dvh w-screen rounded-none border-0" : ""}`}
      style={{ borderColor: isFs ? `${accent}88` : `${accent}33` }}
    >
      <header className="flex items-center justify-between border-b border-white/10 bg-[#071510] px-3 py-1.5">
        <h2 className="text-[11px] font-black tracking-[0.14em]" style={{ color: accent }}>
          CNS <span className="opacity-40">/</span> {title}
        </h2>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-emerald-300/50">FlyWire FAFB v783 · real connectome</span>
          <button
            onClick={toggleFullscreen}
            className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/60 transition hover:border-white/40 hover:text-white"
            aria-label={isFs ? "Exit fullscreen" : "Fullscreen brain"}
            title={isFs ? "Exit fullscreen" : "Fullscreen brain"}
          >
            {isFs ? "⤡" : "⛶"}
          </button>
        </span>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {mounted && <NeuralBrain3D sim={sim} accent={accent} drive={drive} fly={fly} onWebgl={handleWebgl} />}
        {webglFailed && (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 62% 48% at 50% 30%, rgba(30,48,92,0.5), rgba(4,16,11,0) 70%)," +
                "radial-gradient(ellipse 24% 46% at 50% 72%, rgba(30,48,92,0.35), rgba(4,16,11,0) 70%)",
            }}
          />
        )}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#04100b]/80">
            <span className="font-mono text-[11px] font-bold" style={{ color: accent }}>
              {fetching ? "LOADING FLYWIRE FAFB v783" : `LOADING — ${info.neurons || 139255} real neurons`}
            </span>
            <div className="h-1 w-40 overflow-hidden rounded bg-emerald-950">
              <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${loadPct}%` }} />
            </div>
            <span className="font-mono text-[9px] text-emerald-300/50">
              {fetching ? "proofread connectome · Dorkenwald et al. 2024" : `${info.points || 139255} real neurons`}
            </span>
          </div>
        )}
      </div>

      <footer className="grid grid-cols-4 items-end gap-1.5 border-t border-white/10 bg-[#071510] px-2.5 py-1.5 text-[10px] leading-tight">
        <div>
          <span className="font-bold text-slate-200">Brain</span>
          <span className="ml-1 text-slate-500">
            {info.real ? `${info.neurons} real · ${info.archives.join("+")}` : loadPct >= 100 ? "procedural atlas (offline)" : "loading…"}
          </span>
        </div>
        <div className="text-center">
          <span
            className="font-bold"
            style={{ color: util >= 0.8 ? "#34d399" : "#fbbf24" }}
            title="nodes fired within the last 4 bars (target ≥ 80%)"
          >
            {Math.round(util * 100)}%
          </span>
          <span className="ml-1 text-slate-500">util</span>
        </div>
        <div className="text-center font-mono text-[9px] text-slate-500">
          <span className="text-emerald-400">+rate</span> · <span className="text-sky-400">-rate</span> · motor{" "}
          {(levels.motor * 100).toFixed(0)}
        </div>
        <div className="text-right">
          <span className="font-bold text-slate-200">VNC</span>
          <span className="ml-1 text-slate-500">{info.real ? "real neurons" : "model"} · {TOTAL_SOMATA.toLocaleString()} connectome</span>
        </div>
      </footer>
    </section>
  );
}
