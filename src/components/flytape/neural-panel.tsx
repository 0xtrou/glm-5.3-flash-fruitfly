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
    let lastBass = 0;
    let lastKickAt = 0;
    let lastDrive = 0;
    let lastPulseAt = 0;
    let skeletonKey = "";
    let trunkPath: Path2D | null = null;
    let branchPath: Path2D | null = null;
    let haloPath: Path2D | null = null;

    // pre-rendered glow sprites — radial gradients are too slow per-node
    const makeSprite = (r: number, g: number, b: number) => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const x = c.getContext("2d")!;
      const grad = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, 32, 32);
      return c;
    };
    const spriteMint = makeSprite(52, 211, 153);
    const spriteAmber = makeSprite(253, 224, 120);
    const spriteHot = makeSprite(255, 241, 210);
    const spriteCyan = makeSprite(103, 232, 249);

    // traveling pulses — ride real cable edges (a → b, t ∈ [0,1))
    const pulses: { a: number; b: number; t: number; speed: number; hops: number; hue: 0 | 1 }[] = [];

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      // the CNS ticks on its own clock — independent of the WebGL scene
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
      ctx.fillStyle = "#03080f";
      ctx.fillRect(0, 0, w, h);

      const pad = 10;
      const X = (i: number) => pad + sim.x[i] * (w - pad * 2);
      const Y = (i: number) => pad + sim.y[i] * (h - pad * 2);

      // ---- organ silhouettes: soft glows where the brain / VNC sit ----
      const brainCx = pad + 0.5 * (w - pad * 2);
      const brainCy = pad + 0.22 * (h - pad * 2);
      const g1 = ctx.createRadialGradient(brainCx, brainCy, 0, brainCx, brainCy, w * 0.34);
      g1.addColorStop(0, "rgba(43,84,166,0.22)");
      g1.addColorStop(1, "rgba(43,84,166,0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h * 0.55);
      const vncCx = pad + 0.68 * (w - pad * 2);
      const vncCy = pad + 0.68 * (h - pad * 2);
      const g2 = ctx.createRadialGradient(vncCx, vncCy, 0, vncCx, vncCy, w * 0.22);
      g2.addColorStop(0, "rgba(30,110,130,0.16)");
      g2.addColorStop(1, "rgba(30,110,130,0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, h * 0.4, w, h * 0.6);

      const shown = sim.revealedCount();
      const { act, deg } = sim;

      // ---- cable skeletons: halo + trunk + branch layers ----
      const edges = sim.edgeList;
      if (edges && edges.length) {
        const key = `${edges.length}-${w}x${h}`;
        if (skeletonKey !== key) {
          skeletonKey = key;
          trunkPath = new Path2D();
          branchPath = new Path2D();
          haloPath = new Path2D();
          for (let k = 0; k < edges.length; k += 2) {
            const a = edges[k];
            const b = edges[k + 1];
            const ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
            haloPath.moveTo(ax, ay);
            haloPath.lineTo(bx, by);
            if ((deg[a] ?? 0) >= 4 && (deg[b] ?? 0) >= 4) {
              trunkPath.moveTo(ax, ay);
              trunkPath.lineTo(bx, by);
            } else {
              branchPath.moveTo(ax, ay);
              branchPath.lineTo(bx, by);
            }
          }
        }
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(90,130,225,0.10)";
        ctx.lineWidth = 4.5;
        ctx.stroke(haloPath!);
        ctx.strokeStyle = "rgba(105,150,235,0.34)";
        ctx.lineWidth = 1.5;
        ctx.stroke(trunkPath!);
        ctx.strokeStyle = "rgba(120,160,240,0.20)";
        ctx.lineWidth = 0.8;
        ctx.stroke(branchPath!);
      }

      // ---- somata (real cell bodies at each neuron's root) ----
      ctx.fillStyle = "rgba(170,190,255,0.55)";
      for (const r of sim.neuronRanges) {
        if (r.start >= shown) continue;
        const px = X(r.start);
        const py = Y(r.start);
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- firing: traveling pulses riding real cables + glowing nodes ----
      ctx.globalCompositeOperation = "lighter";

      // spawn pulses at hot nodes
      let spawns = 0;
      for (let tries = 0; tries < 12 && pulses.length < 160 && spawns < 5; tries++) {
        const i = (Math.random() * shown) | 0;
        if (sim.act[i] > 0.6 && sim.degree(i) > 0) {
          pulses.push({ a: i, b: sim.pulseTarget(i), t: 0, speed: 3 + Math.random() * 4, hops: 6 + ((Math.random() * 8) | 0), hue: sim.region[i] === 2 ? 1 : 0 });
          spawns++;
        }
      }
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pl = pulses[p];
        pl.t += pl.speed * dt;
        const spr = pl.hue === 1 ? spriteCyan : spriteMint;
        if (pl.t >= 1) {
          pl.a = pl.b;
          pl.b = sim.pulseTarget(pl.a);
          pl.t = 0;
          if (--pl.hops <= 0) {
            pulses.splice(p, 1);
            continue;
          }
        }
        const px = X(pl.a) + (X(pl.b) - X(pl.a)) * pl.t;
        const py = Y(pl.a) + (Y(pl.b) - Y(pl.a)) * pl.t;
        ctx.drawImage(spr, px - 5, py - 5, 10, 10);
      }

      // active nodes bloom over the skeleton
      for (let i = 0; i < shown; i++) {
        const a = sim.act[i];
        if (a <= 0.15) continue;
        const px = X(i);
        const py = Y(i);
        const spr = a > 0.85 ? spriteHot : a > 0.45 ? spriteMint : spriteCyan;
        const size = 6 + a * 6;
        ctx.globalAlpha = Math.min(1, 0.35 + a * 0.5);
        ctx.drawImage(spr, px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
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
