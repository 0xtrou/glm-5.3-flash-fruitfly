"use client";

import { useEffect, useState } from "react";
import { Brain, Bug, Volume2, VolumeX, Zap, Play, AudioLines, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGame } from "@/lib/game-store";
import { audioEngine } from "@/lib/audio-engine";
import { flywireSim, janeliaSim } from "@/lib/neural-sim";

export function Hud() {
  const phase = useGame((s) => s.phase);
  const dropped = useGame((s) => s.dropped);
  const muted = useGame((s) => s.muted);
  const start = useGame((s) => s.start);
  const toggleMute = useGame((s) => s.toggleMute);

  // assets-ready gate: brains built in the worker AND both CNS panels adopted
  // the real connectome. Beats start only after everything is in memory.
  const [assetsReady, setAssetsReady] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => {
      if (audioEngine.brains.ready && flywireSim.realData && janeliaSim.realData) {
        setAssetsReady(true);
        clearInterval(iv);
      }
    }, 120);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3 md:p-4">
        <div className="rounded-xl border border-white/10 bg-black/55 px-4 py-2.5 backdrop-blur">
          <div className="text-[10px] font-bold tracking-[0.18em] text-white/50 uppercase">Now playing</div>
          <div className="text-sm font-black text-white">
            {dropped ? "Motor synchrony drop" : "Trained neural patterns"}
          </div>
          <div className="mt-0.5 text-[10px] font-bold text-emerald-300">
            100% brain-generated · zero scripted notes
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-400/50 bg-emerald-500/10 text-emerald-300">
            BRAIN-GENERATED
          </Badge>
          <Button
            variant="outline"
            size="icon"
            className="border-white/20 bg-black/50 text-white hover:bg-white/10"
            onClick={() => {
              const m = audioEngine.toggleMute();
              if (m !== muted) toggleMute();
            }}
            aria-label="Toggle sound"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* idle overlay */}
      {phase === "idle" && (
        <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 max-w-md rounded-2xl border border-white/10 bg-[#0d0d17]/95 p-8 text-center shadow-2xl">
            <div className="flex items-center justify-center gap-3">
              <Bug className="h-10 w-10 text-red-400" />
              <AudioLines className="h-10 w-10 text-fuchsia-400" />
              <Brain className="h-10 w-10 text-violet-400" />
            </div>
            <h3 className="mt-3 text-2xl font-black text-white">DJ FLYWIRE × MC JANELIA</h3>
            <p className="mt-1 text-sm font-semibold tracking-wider text-violet-300 uppercase">
              Two trained brains. Zero scripts. Live.
            </p>
            <div className="mt-4 space-y-1.5 text-left text-sm text-white/70">
              <p><Brain className="mr-1.5 inline h-4 w-4 text-violet-400" /> Every sound is a spike from their trained networks.</p>
              <p>
                <Bug className="mr-1.5 inline h-4 w-4 text-red-400" /> Their bodies move with their <b className="text-white">actual brain activity</b> —
                watch the CNS panels mirror the flies.
              </p>
              <p>
                <Zap className="mr-1.5 inline h-4 w-4 text-amber-400" /> When both motor populations synchronize, the{" "}
                <b className="text-white">drop</b> fires on its own.
              </p>
            </div>
            {assetsReady ? (
              <Button
                size="lg"
                className="mt-6 h-11 w-full bg-gradient-to-r from-red-500 via-fuchsia-500 to-violet-500 text-base font-black text-white hover:opacity-90"
                onClick={() => {
                  audioEngine.start();
                  start();
                }}
              >
                START THE SET
                <Play className="ml-1 h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                size="lg"
                disabled
                className="mt-6 h-11 w-full cursor-wait bg-white/10 text-base font-black text-white/60"
              >
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                LOADING BRAIN ASSETS…
              </Button>
            )}
            <p className="mt-3 text-[11px] text-white/40">
              128 BPM carrier · R-STDP trained · 139,255-neuron FlyWire connectome · click a name tag to poke a fly
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
