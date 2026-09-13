"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGame, statusFor } from "@/lib/game-store";
import { AudioLines, Brain, Bug } from "lucide-react";
import { audioEngine } from "@/lib/audio-engine";
import { flywireSim, janeliaSim, bootNeuralSims } from "@/lib/neural-sim";import { NeuralPanel } from "./neural-panel";
import { FaderPanel } from "./fader-panel";
import { AuditLog } from "./audit-log";

const DjGame = dynamic(() => import("@/components/game/dj-game"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[420px] items-center justify-center bg-[#07070f]">
      <div className="animate-pulse text-center">
        <div className="flex items-center justify-center gap-3">
          <Bug className="h-10 w-10 text-red-400" />
          <AudioLines className="h-10 w-10 text-fuchsia-400" />
          <Brain className="h-10 w-10 text-violet-400" />
        </div>
        <p className="mt-3 font-mono text-sm font-bold tracking-widest text-emerald-300/50 uppercase">
          Waking 139,255 neurons…
        </p>
      </div>
    </div>
  ),
});

function SimClock() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(audioEngine.simTime), 50);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-lg font-bold whitespace-nowrap text-slate-100 tabular-nums md:text-3xl">
      t = {t.toFixed(2)} s
    </span>
  );
}

function TrackNames() {
  const [names, setNames] = useState<{ wire: string; janelia: string } | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNames(audioEngine.brains.trackNames()), 500);
    return () => clearInterval(id);
  }, []);
  if (!names) {
    return (
      <span className="font-mono text-[10px] text-emerald-300/50">DJ FLYWIRE × MC JANELIA · 128 BPM</span>
    );
  }
  return (
    <span className="font-mono text-[10px] text-emerald-300/70">
      ♪ {names.wire} <span className="text-slate-600">×</span> {names.janelia}
    </span>
  );
}

function StatusStrip() {
  const [status, setStatus] = useState({ code: "STANDBY", detail: "", progress: 0 });
  const [telemetry, setTelemetry] = useState("");
    useEffect(() => {
      const id = setInterval(() => {
        const s = useGame.getState();
        setStatus(statusFor(s, audioEngine.bar));
        const tn = audioEngine.brains.trackNames();
        const wd = audioEngine.brains.flyDrive("wire");
        const jd = audioEngine.brains.flyDrive("janelia");
        setTelemetry(
          `FLYWIRE m${Math.round(wd.motor * 100)}/t${Math.round(wd.think * 100)}` +
            ` — JANELIA m${Math.round(jd.motor * 100)}/t${Math.round(jd.think * 100)}` +
            (tn ? ` · ♪ ${tn.wire} × ${tn.janelia}` : "")
        );
      }, 120);
      return () => clearInterval(id);
    }, []);
  return (
    <div className="relative flex items-center justify-between gap-4 border-t border-emerald-400/20 bg-[#071510] px-4 py-3">
      <span className="text-lg font-black tracking-wide text-emerald-300 md:text-xl">{status.code}</span>
      <span className="truncate text-sm text-slate-500">{status.detail}</span>
      <span className="hidden font-mono text-[10px] text-slate-500 lg:inline">{telemetry}</span>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-emerald-950">
        <div
          className="h-full bg-emerald-400 transition-[width] duration-200"
          style={{ width: `${status.progress}%`, boxShadow: "0 0 12px #34d39988" }}
        />
      </div>
    </div>
  );
}

export function FlytapeApp() {
  useEffect(() => {
    bootNeuralSims();
    audioEngine.brains.preload(); // weights in parallel — START stays instant
  }, []);
  return (
    <div className="flex min-h-dvh flex-col bg-[#050a08] text-slate-200 lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      {/* header */}
      <header className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1
                className="flex items-center gap-3 text-2xl font-black tracking-tight text-emerald-300 md:text-3xl"
                style={{ textShadow: "0 0 18px rgba(52,211,153,0.45)" }}
              >
                <img src="/logo.svg" alt="FLYTAPE logo" className="h-11 w-11 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)] md:h-12 md:w-12" />
                FLYTAPE
              </h1>
              <nav className="truncate text-sm font-black tracking-[0.12em] text-slate-100 md:text-lg">
                CONNECTOME <span className="text-slate-600">&gt;</span> FLY{" "}
                <span className="text-slate-600">&gt;</span> DECKS <span className="text-slate-600">&gt;</span>{" "}
                <span className="text-emerald-300">BANGER</span>
              </nav>
            </div>
            <p className="mt-0.5 text-[12px] text-slate-500 md:text-[13px]">
              Neural activity <span className="text-slate-700">|</span> Fader input{" "}
              <span className="text-slate-700">|</span> Beat deployment
            </p>
          </div>
          <SimClock />
        </div>
      </header>

      {/* main grid */}
      <div className="grid min-h-0 flex-1 gap-2 px-2 pb-1 lg:grid-cols-[minmax(0,1fr)_460px] xl:grid-cols-[minmax(0,1fr)_540px]">
        {/* main column — the live set + audit stream */}
        <div className="flex min-h-[480px] flex-col gap-2 lg:min-h-0">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#04100b]">
          <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#071510] px-3 py-2">
            <h2 className="text-[12px] font-black tracking-[0.14em] text-emerald-300">
              DECKS <span className="text-emerald-300/40">/</span> LIVE RHYTHM DEPLOYMENT
            </h2>
            <TrackNames />
          </header>
          <div className="relative min-h-0 flex-1">
            <DjGame />
          </div>
          <StatusStrip />
        </section>
          <AuditLog />
        </div>

        {/* right column — two independent brains + fader input */}
        <div className="flex min-h-0 flex-col gap-2 lg:grid lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <NeuralPanel sim={flywireSim} title="DJ FLYWIRE" accent="#ff5c5c" drive="kick" fly="wire" />
          <NeuralPanel sim={janeliaSim} title="MC JANELIA" accent="#c084fc" drive="treble" fly="janelia" />
          <FaderPanel />
        </div>
      </div>

      {/* footer */}
      <footer className="shrink-0 px-4 pb-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[13px] text-slate-500">
          <span>
            Fly at the decks <span className="text-slate-700">|</span> 128 BPM live synthesis{" "}
            <span className="text-slate-700">|</span> Synchronized neural activity
          </span>
          <span className="font-mono text-[11px] text-slate-600">
            CONNECTOME | FlyWire FAFB v783 proofread (Dorkenwald et al. 2024, Zenodo 10676866) · 139,255 neurons ·
            15,071,499 measured connections · NeuroMorpho.org reconstructions (Bock, Williams labs)
          </span>
          <span className="font-mono text-[11px] text-slate-600">
            OPEN SOURCE |{" "}
            <a
              href="https://github.com/0xtrou/glm-5.3-flash-fruitfly"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 underline decoration-slate-800 transition hover:text-emerald-400"
            >
              github.com/0xtrou/glm-5.3-flash-fruitfly
            </a>{" "}
            · © 2026 <span className="text-slate-500">0xtrou</span> — author & maintainer · built with GLM-5.3-Flash + ZCode
          </span>
        </div>
      </footer>
    </div>
  );
}
