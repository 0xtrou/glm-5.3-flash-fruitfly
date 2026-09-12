"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Bug, Zap, Sparkles, Disc3, AudioLines } from "lucide-react";
import { flywireSim, janeliaSim } from "@/lib/neural-sim";

/**
 * TIKTOK-STYLE REWARD ANIMATIONS — audit events float an icon up from the
 * stage: sensory = Brain, motor burst = Zap, drop = Sparkles, track switch
 * = Disc3. WIRE events red-tinted, JANELIA violet-tinted.
 * Reads only the TAIL of each audit ring buffer (index tracking breaks once
 * the ring shifts) and every float expires by age — nothing freezes.
 */

type Kind = "brain" | "zap" | "sparkles" | "disc" | "audio";
interface Float {
  id: number;
  fly: "wire" | "janelia";
  kind: Kind;
  x: number;
  drift: number;
  scale: number;
  born: number;
}

const ICONS: Record<Kind, typeof Brain> = {
  brain: Brain,
  zap: Zap,
  sparkles: Sparkles,
  disc: Disc3,
  audio: AudioLines,
};
const COLORS: Record<"wire" | "janelia", string> = { wire: "#ff6b6b", janelia: "#c084fc" };
const FLOAT_LIFE_MS = 2400;
const MAX_FLOATS = 16;

function classify(msg: string): Kind {
  if (msg.includes("DROP") || msg.includes("synchrony")) return "sparkles";
  if (msg.includes("TRACK SWITCH")) return "disc";
  if (msg.includes("motor burst") || msg.includes("motor spikes")) return "zap";
  if (msg.includes("sensory stimulus")) return "brain";
  return "audio";
}

export function StageRewards() {
  const [floats, setFloats] = useState<Float[]>([]);
  const lastSeen = useRef({ wire: "", janelia: "" });
  const idRef = useRef(0);

  useEffect(() => {
    const spawn = (fly: "wire" | "janelia", msg: string) => {
      const kind = classify(msg);
      const big = kind === "sparkles" || kind === "disc";
      setFloats((cur) => [
        ...cur.slice(-(MAX_FLOATS - 1)),
        {
          id: idRef.current++,
          fly,
          kind,
          x: 12 + Math.random() * 76,
          drift: (Math.random() - 0.5) * 90,
          scale: big ? 1.7 : 1 + Math.random() * 0.5,
          born: Date.now(),
        },
      ]);
    };

    const id = setInterval(() => {
      // tail-poll: only each buffer's newest line matters (bars repeat)
      const w = flywireSim.audit;
      const j = janeliaSim.audit;
      const wNew = w.length ? w[w.length - 1] : "";
      const jNew = j.length ? j[j.length - 1] : "";
      if (wNew && wNew !== lastSeen.current.wire) {
        lastSeen.current.wire = wNew;
        spawn("wire", wNew);
      }
      if (jNew && jNew !== lastSeen.current.janelia) {
        lastSeen.current.janelia = jNew;
        spawn("janelia", jNew);
      }
      // age out finished floats so nothing ever freezes on screen
      const now = Date.now();
      setFloats((cur) => (cur.some((f) => now - f.born > FLOAT_LIFE_MS) ? cur.filter((f) => now - f.born <= FLOAT_LIFE_MS) : cur));
    }, 280);
    return () => clearInterval(id);
  }, []);

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
