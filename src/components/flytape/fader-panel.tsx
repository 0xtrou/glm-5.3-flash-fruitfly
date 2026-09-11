"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/lib/game-store";
import { flywireSim, janeliaSim } from "@/lib/neural-sim";

/**
 * FLY / BRAIN ACTIVITY — FLYTAPE panel.
 * The two operators with live brain bars: magenta = motor (VNC) firing,
 * blue = central-brain firing. Their body animation tracks these same signals.
 */
export function FaderPanel() {
  const phase = useGame((s) => s.phase);
  const dropped = useGame((s) => s.dropped);
  const [levels, setLevels] = useState({ wm: 0, wt: 0, jm: 0, jt: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      setLevels({
        wm: flywireSim.motorRate(),
        wt: flywireSim.thinkRate(),
        jm: janeliaSim.motorRate(),
        jt: janeliaSim.thinkRate(),
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  const active = phase === "playing";
  const state = !active ? "AWAITING SET" : dropped ? "DROP LIVE" : "GROOVING";
  const detail = !active
    ? "Brains idle"
    : dropped
      ? "Motor synchrony — full energy"
      : "Listening to their own wiring";

  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#04100b]">
      <header className="flex items-center justify-between border-b border-white/10 bg-[#071510] px-3 py-1.5">
        <h2 className="text-[11px] font-black tracking-[0.14em] text-emerald-300">
          FLY <span className="text-emerald-300/40">/</span> BRAIN ACTIVITY
        </h2>
        <span className="font-mono text-[9px] text-emerald-300/50">6 legs · 2 brains · 0 scripts</span>
      </header>

      <div className="flex items-center justify-center gap-8 px-4 py-3">
        {[
          { name: "FLYWIRE", m: levels.wm, t: levels.wt, accent: "#ff5c5c" },
          { name: "JANELIA", m: levels.jm, t: levels.jt, accent: "#c084fc" },
        ].map((f) => (
          <div key={f.name} className="flex items-center gap-2.5">
            <svg width="38" height="40" viewBox="0 0 34 34" aria-hidden>
              <ellipse cx="17" cy="22" rx="7" ry="9" fill="#262636" />
              <circle cx="17" cy="10" r="6" fill="#262636" />
              <circle cx="14" cy="9" r="3.2" fill={f.accent} />
              <circle cx="20" cy="9" r="3.2" fill={f.accent} />
            </svg>
            <div className="flex flex-col gap-1">
              <div className="flex items-end gap-1" title={`motor ${Math.round(f.m * 100)} · think ${Math.round(f.t * 100)}`}>
                <span
                  className="w-2 rounded-sm bg-fuchsia-400/80 transition-[height] duration-200"
                  style={{ height: `${8 + f.m * 26}px` }}
                />
                <span
                  className="w-2 rounded-sm bg-sky-400/80 transition-[height] duration-200"
                  style={{ height: `${8 + f.t * 26}px` }}
                />
              </div>
              <span className="text-[9px] font-black tracking-wider text-white/50">{f.name}</span>
            </div>
          </div>
        ))}
        <div className="ml-2 flex flex-col gap-1 font-mono text-[9px] text-slate-500">
          <span>
            <span className="text-fuchsia-400">▮</span> motor (VNC)
          </span>
          <span>
            <span className="text-sky-400">▮</span> central brain
          </span>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#071510] px-3 py-2">
        <span className="text-[13px] font-black tracking-wide text-emerald-300">{state}</span>
        <button
          onClick={() => {
            const payload = {
              exportedAt: new Date().toISOString(),
              flywire: flywireSim.audit,
              janelia: janeliaSim.audit,
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "flytape-audit.json";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          className="rounded border border-white/15 px-2 py-0.5 font-mono text-[10px] text-white/60 transition hover:border-white/40 hover:text-white"
          aria-label="Export brain activity audit log"
        >
          ⬇ audit log
        </button>
        <span className="hidden text-[12px] text-slate-500 sm:inline">{detail}</span>
      </footer>
    </section>
  );
}
