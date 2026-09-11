"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { StageScene } from "./scene";
import { Hud } from "./hud";

export default function DjGame() {
  // never touch WebGL from the server — a WebGL rejection there kills the node process
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden bg-[#07070f]">
      {mounted ? (
        <Canvas
          camera={{ position: [0, 1.75, 6.4], fov: 55 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
        >
          <StageScene />
        </Canvas>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="animate-pulse font-mono text-sm font-bold tracking-widest text-emerald-300/40 uppercase">
            spinning up the club…
          </p>
        </div>
      )}
      <Hud />
    </div>
  );
}
