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
    let buildKey = "";
    let fiberPath: Path2D | null = null; // smooth curved neurites, all neurons
    let haloPath: Path2D | null = null;
    let webPath: Path2D | null = null; // inter-neuron synapse web
    let tissueCanvas: HTMLCanvasElement | null = null;
    let tissueKey = "";
    let lastDrive = 0;
    let lastPulseAt = 0;

    const refs = { buildKey: "", tissueKey: "" };
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

    // traveling pulses on real cables
    const pulses: { a: number; b: number; t: number; speed: number; hops: number }[] = [];

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      sim.tick(dt); // this brain ticks on its own clock

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
      ctx.fillStyle = "#020508";
      ctx.fillRect(0, 0, w, h);

      const pad = 8;
      const X = (i: number) => pad + sim.x[i] * (w - pad * 2);
      const Y = (i: number) => pad + sim.y[i] * (h - pad * 2);

      const shown = sim.revealedCount();
      const { act } = sim;

      // ---- rebuild geometry when the dataset / size changes ----
      const edges = sim.edgeList;
      const buildKey = `${sim.dataVersion}-${edges?.length ?? 0}-${w}x${h}`;
      if (refs.buildKey !== buildKey) {
        refs.buildKey = buildKey;
        fiberPath = new Path2D();
        haloPath = new Path2D();
        webPath = new Path2D();
        const n = sim.count;
        // group nodes per neuron (contiguous ranges) → smooth curved arbors
        for (const r of sim.neuronRanges) {
          const seq: number[] = [];
          for (let k = r.start; k < Math.min(r.start + r.count, shownMax(n)); k++) seq.push(k);
          if (seq.length < 2) continue;
          // smooth quadratic chain through the arbor
          haloPath.moveTo(X(seq[0]), Y(seq[0]));
          fiberPath.moveTo(X(seq[0]), Y(seq[0]));
          for (let i = 1; i < seq.length; i++) {
            const px = X(seq[i]);
            const py = Y(seq[i]);
            const mx = (X(seq[i - 1]) + px) / 2;
            const my = (Y(seq[i - 1]) + py) / 2;
            fiberPath.quadraticCurveTo(mx, my, px, py);
            haloPath.lineTo(px, py);
          }
        }
        // synapse web between neurons
        const syn = sim.synapseList;
        if (syn) {
          // local synapses only — real connections are short; long random
          // links read as fake diagonals across the organ
          for (let k = 0; k < syn.length; k += 2) {
            const a = syn[k];
            const b = syn[k + 1];
            const dx = sim.x[a] - sim.x[b];
            const dy = sim.y[a] - sim.y[b];
            if (dx * dx + dy * dy > 0.02) continue;
            webPath.moveTo(X(a), Y(a));
            webPath.lineTo(X(b), Y(b));
          }
        }
      }

      // ---- organ bodies: filled lobes + VNC column (the "brain" mass) ----
      const organ = (nx: number, ny: number, rx: number, ry: number, rim: number) => {
        const cx = pad + nx * (w - pad * 2);
        const cy = pad + ny * (h - pad * 2);
        const rxp = rx * w;
        const ryp = ry * h;
        const g = ctx.createRadialGradient(cx, cy - ryp * 0.2, 0, cx, cy, Math.max(rxp, ryp));
        g.addColorStop(0, "#0e1a38");
        g.addColorStop(0.7, "#081026");
        g.addColorStop(1, "#04070f");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxp, ryp, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(110,140,220,${rim})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      };
      organ(0.235, 0.275, 0.155, 0.24, 0.14); // left optic lobe
      organ(0.765, 0.275, 0.155, 0.24, 0.14); // right optic lobe
      organ(0.5, 0.25, 0.17, 0.21, 0.12); // central brain
      organ(0.5, 0.7, 0.1, 0.24, 0.12); // VNC column

      // ---- fibers: smooth curved neurites over the organ bodies ----
      if (webPath) {
        ctx.strokeStyle = "rgba(110,140,220,0.05)";
        ctx.lineWidth = 0.5;
        ctx.stroke(webPath);
      }
      if (haloPath) {
        ctx.strokeStyle = "rgba(120,150,230,0.09)";
        ctx.lineWidth = 3.2;
        ctx.stroke(haloPath);
      }
      if (fiberPath) {
        ctx.strokeStyle = "rgba(165,185,240,0.4)";
        ctx.lineWidth = 1.05;
        ctx.stroke(fiberPath);
      }

      // ---- somata: bright cell bodies at each neuron root ----
      for (const r of sim.neuronRanges) {
        if (r.start >= shown) continue;
        const px = X(r.start);
        const py = Y(r.start);
        ctx.fillStyle = "rgba(200,215,255,0.8)";
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- firing: pulses riding real cables + blooming nodes ----
      ctx.globalCompositeOperation = "lighter";
      let spawns = 0;
      for (let tries = 0; tries < 12 && pulses.length < 160 && spawns < 5; tries++) {
        const i = (Math.random() * shown) | 0;
        if (sim.act[i] > 0.6 && sim.degree(i) > 0) {
          pulses.push({ a: i, b: sim.pulseTarget(i), t: 0, speed: 3 + Math.random() * 4, hops: 6 + ((Math.random() * 8) | 0) });
          spawns++;
        }
      }
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pl = pulses[p];
        pl.t += pl.speed * dt;
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
        ctx.drawImage(spriteCyan, px - 5, py - 5, 10, 10);
      }
      for (let i = 0; i < shown; i++) {
        const a = sim.act[i];
        if (a <= 0.15) continue;
        const px = X(i);
        const py = Y(i);
        const spr = a > 0.85 ? spriteHot : a > 0.45 ? spriteMint : spriteCyan;
        const size = 6 + a * 8;
        ctx.globalAlpha = Math.min(1, 0.3 + a * 0.6);
        ctx.drawImage(spr, px - size / 2, py - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sim, drive]);

  function shownMax(n: number) {
    return n;
  }

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
