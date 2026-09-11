"use client";

import { useEffect, useRef, useState } from "react";
import type { NeuralSim } from "@/lib/neural-sim";
import { TOTAL_SOMATA } from "@/lib/neural-sim";
import { audioEngine } from "@/lib/audio-engine";
import { fx } from "@/components/game/scene";

interface Props {
  sim: NeuralSim;
  title: string;
  accent: string;
  /** which audio transient drives this brain when the WebGL loop is not running */
  drive: "kick" | "treble";
}

/**
 * CNS / NEURAL ACTIVITY — one panel per fly, fully independent:
 * own dataset (real NeuroMorpho reconstructions), own spiking dynamics,
 * own sensory drive. FLYWIRE rides kicks, JANELIA rides snare/hat energy.
 * Colors: dim = idle skeleton, mint = firing (+rate), amber = saturating.
 */
export function NeuralPanel({ sim, title, accent, drive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadPct, setLoadPct] = useState(0);
  const [levels, setLevels] = useState({ motor: 0, central: 0 });
  const [info, setInfo] = useState({ real: false, neurons: 0, points: 0, archives: [] as string[] });

  useEffect(() => {
    const iv = setInterval(() => {
      setLoadPct(Math.round(sim.loadProgress * 100));
      setLevels({ motor: sim.motorLevel(), central: sim.centralLevel() });
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastTs = performance.now();
    let lastDrive = 0;
    let lastPulseAt = 0;
    let skeletonPath: Path2D | null = null;
    let skeletonKey = "";

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      // this brain ticks on its own clock — independent of the other fly
      sim.tick(dt);

      // fallback sensory drive when the WebGL loop is not running
      if (!fx.r3fAlive) {
        const level = drive === "kick" ? audioEngine.bassLevel() : audioEngine.trebleLevel();
        if (level - lastDrive > 0.06 && now - lastPulseAt > 340) {
          sim.inject(0, 0.45, 120);
          lastPulseAt = now;
        }
        lastDrive = level;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#04100b";
      ctx.fillRect(0, 0, w, h);

      const shown = sim.revealedCount();
      const { x, y, z, act } = sim;
      const pad = 10;

      // cable skeletons — the real reconstructions' neurites
      const edges = sim.edgeList;
      if (edges && edges.length) {
        const key = `${edges.length}-${w}x${h}`;
        if (skeletonKey !== key) {
          skeletonKey = key;
          const path = new Path2D();
          for (let k = 0; k < edges.length; k += 2) {
            const a = edges[k];
            const b = edges[k + 1];
            path.moveTo(pad + x[a] * (w - pad * 2), pad + y[a] * (h - pad * 2));
            path.lineTo(pad + x[b] * (w - pad * 2), pad + y[b] * (h - pad * 2));
          }
          skeletonPath = path;
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(90,145,230,0.4)";
        ctx.stroke(skeletonPath!);
      }

      // vibration — additive glow so firing cables bloom
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < shown; i++) {
        const a = act[i];
        if (a <= 0.08) continue; // idle carried by skeleton strokes
        const depth = 0.45 + z[i] * 0.55;
        const px = pad + x[i] * (w - pad * 2);
        const py = pad + y[i] * (h - pad * 2);
        let color: string;
        let size = 1.3 + depth;
        if (a > 0.85) color = `rgba(253,230,138,${depth})`; // saturating
        else if (a > 0.22) color = `rgba(52,211,153,${depth})`; // firing (+ rate)
        else color = `rgba(13,148,136,${depth * 0.8})`;
        ctx.fillStyle = color;
        if (a > 0.22) size += 1.1;
        ctx.fillRect(px, py, size, size);
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sim, drive]);

  const loading = loadPct < 100;
  const fetching = loadPct < 50;

  return (
    <section
      className="flex h-52 min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-[#04100b] lg:h-auto lg:min-h-[150px] lg:shrink"
      style={{ borderColor: `${accent}33` }}
    >
      <header className="flex items-center justify-between border-b border-white/10 bg-[#071510] px-3 py-1.5">
        <h2 className="text-[11px] font-black tracking-[0.14em]" style={{ color: accent }}>
          CNS <span className="opacity-40">/</span> {title}
        </h2>
        <span className="font-mono text-[9px] text-emerald-300/50">independent sim · NeuroMorpho.org</span>
      </header>

      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#04100b]/80">
            <span className="font-mono text-[11px] font-bold" style={{ color: accent }}>
              {fetching ? "FETCHING REAL NEURONS — NeuroMorpho.org" : `LOADING — ${info.neurons || 36} real neurons`}
            </span>
            <div className="h-1 w-40 overflow-hidden rounded bg-emerald-950">
              <div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${loadPct}%` }} />
            </div>
            <span className="font-mono text-[9px] text-emerald-300/50">
              {fetching ? "SWC reconstructions · Bock & Williams labs" : `${info.points || 14000} cable nodes · real neurites`}
            </span>
          </div>
        )}
      </div>

      <footer className="grid grid-cols-3 items-end gap-1.5 border-t border-white/10 bg-[#071510] px-2.5 py-1.5 text-[10px] leading-tight">
        <div>
          <span className="font-bold text-slate-200">Brain</span>
          <span className="ml-1 text-slate-500">
            {info.real ? `${info.neurons} real · ${info.archives.join("+")}` : loadPct >= 100 ? "procedural atlas (offline)" : "loading…"}
          </span>
        </div>
        <div className="text-center font-mono text-[9px] text-slate-500">
          <span className="text-emerald-400">+rate</span> · <span className="text-sky-400">-rate</span> · motor{" "}
          {(levels.motor * 100).toFixed(0)}
        </div>
        <div className="text-right">
          <span className="font-bold text-slate-200">VNC</span>
          <span className="ml-1 text-slate-500">{info.real ? "real neurons" : "model"} · {TOTAL_SOMATA.toLocaleString()} model</span>
        </div>
      </footer>
    </section>
  );
}
