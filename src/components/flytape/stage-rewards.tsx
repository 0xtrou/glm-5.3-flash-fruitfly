"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Bug, Zap, Sparkles, Disc3, AudioLines } from "lucide-react";
import { flywireSim, janeliaSim } from "@/lib/neural-sim";

/**
 * TIKTOK-STYLE REWARD ANIMATIONS — every audit event floats an icon up
 * from the stage: sensory = Brain, motor burst = Zap, drop = Sparkles,
 * track switch = Disc3. WIRE events red-tinted, JANELIA violet-tinted.
 */

type Kind = "brain" | "zap" | "sparkles" | "disc" | "audio";
interface Float {
  id: number;
  fly: "wire" | "janelia";
  kind: Kind;
  x: number;
  drift: number;
  scale: number;
}

const ICONS: Record<Kind, typeof Brain> = {
  brain: Brain,
  zap: Zap,
  sparkles: Sparkles,
  disc: Disc3,
  audio: AudioLines,
};
const COLORS: Record<"wire" | "janelia", string> = { wire: "#ff6b6b", janelia: "#c084fc" };

function classify(msg: string): Kind {
  if (msg.includes("DROP") || msg.includes("synchrony")) return "sparkles";
  if (msg.includes("TRACK SWITCH")) return "disc";
  if (msg.includes("motor burst") || msg.includes("motor spikes")) return "zap";
  if (msg.includes("sensory stimulus")) return "brain";
  return "audio";
}

export function StageRewards() {
  const [floats, setFloats] = useState<Float[]>([]);
  const seen = useRef({ wire: 0, janelia: 0 });
  const idRef = useRef(0);

  useEffect(() => {
    const spawn = (fly: "wire" | "janelia", msg: string) => {
      const kind = classify(msg);
      const big = kind === "sparkles" || kind === "disc";
      setFloats((cur) => [
        ...cur.slice(-14),
        {
          id: idRef.current++,
          fly,
          kind,
          x: 12 + Math.random() * 76,
          drift: (Math.random() - 0.5) * 90,
          scale: big ? 1.7 : 1 + Math.random() * 0.5,
        },
      ]);
    };

    const id = setInterval(() => {
      const w = flywireSim.audit;
      const j = janeliaSim.audit;
      const fresh: (() => void)[] = [];
      while (seen.current.wire < w.length) {
        const msg = w[seen.current.wire];
        fresh.push(() => spawn("wire", msg));
        seen.current.wire++;
      }
      while (seen.current.janelia < j.length) {
        const msg = j[seen.current.janelia];
        fresh.push(() => spawn("janelia", msg));
        seen.current.janelia++;
      }
      // cap burst: max 4 icons per tick
      fresh.slice(0, 4).forEach((fn, i) => window.setTimeout(fn, i * 160));
      if (fresh.length > 400) seen.current = { wire: w.length, janelia: j.length };
    }, 280);
    return () => clearInterval(id);
  }, []);

  // garbage-collect finished floats
  useEffect(() => {
    if (!floats.length) return;
    const t = setTimeout(() => setFloats((cur) => cur.slice(floats.length - 12 > 0 ? floats.length - 12 : 0)), 2600);
    return () => clearTimeout(t);
  }, [floats]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {floats.map((f) => {
        const Icon = ICONS[f.kind];
        return (
          <span
            key={f.id}
            className="animate-reward-float absolute"
            style={{
              left: `${f.x}%`,
              bottom: "18%",
              color: COLORS[f.fly],
              transform: `scale(${f.scale})`,
              ["--drift" as string]: `${f.drift}px`,
            }}
          >
            <Icon
              style={{
                width: 26 * f.scale,
                height: 26 * f.scale,
                filter: `drop-shadow(0 0 8px ${COLORS[f.fly]})`,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}
