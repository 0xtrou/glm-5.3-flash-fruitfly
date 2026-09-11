"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { flywireSim, janeliaSim } from "@/lib/neural-sim";

interface LogLine {
  key: number;
  fly: "wire" | "janelia";
  t: number;
  msg: string;
}

let lineKey = 0;

/** parse leading "[12.3s] " timestamp for chronological merge */
function parse(entries: string[], fly: "wire" | "janelia"): LogLine[] {
  return entries.map((e) => {
    const m = e.match(/^\[(\d+(?:\.\d+)?)s\]\s?/);
    return { key: lineKey++, fly, t: m ? parseFloat(m[1]) : 0, msg: m ? e.slice(m[0].length) : e };
  });
}

/**
 * AUDIT LOG — live stream of both brains' recorded activity:
 * sensory injections, motor bursts, bar summaries, synchrony drops.
 * Chronologically merged, newest at the bottom, auto-scrolls.
 */
export function AuditLog() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const merged = [
        ...parse(flywireSim.audit, "wire"),
        ...parse(janeliaSim.audit, "janelia"),
      ].sort((a, b) => a.t - b.t);
      setLines(merged.slice(-60));
    }, 300);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className="flex h-40 shrink-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#04100b] lg:h-44">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#071510] px-3 py-1.5">
        <h2 className="flex items-center gap-1.5 text-[11px] font-black tracking-[0.14em] text-emerald-300">
          <Terminal className="h-3.5 w-3.5" />
          AUDIT LOG <span className="text-emerald-300/40">/</span> BRAIN ACTIVITIES
        </h2>
        <span className="font-mono text-[9px] text-emerald-300/50">live · last 60 events</span>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-slate-600">— no activity yet. start the set —</p>
        ) : (
          lines.map((l) => (
            <p key={l.key} className="whitespace-nowrap">
              <span className="text-slate-600">[{l.t.toFixed(1)}s]</span>{" "}
              <span className={l.fly === "wire" ? "font-bold text-red-400" : "font-bold text-violet-400"}>
                {l.fly === "wire" ? "WIRE" : "JANE"}
              </span>{" "}
              <span className="text-emerald-300/80">{l.msg}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}
