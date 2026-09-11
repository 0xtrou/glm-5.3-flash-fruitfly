"use client";

import { create } from "zustand";

export type Phase = "idle" | "playing";

export interface FlytapeStatus {
  code: string; // mint headline, e.g. "GROOVING"
  detail: string; // right-side detail
  progress: number; // 0..100 mint progress bar
}

interface GameState {
  phase: Phase;
  dropped: boolean; // brains reached synchrony → the set dropped
  dropsCount: number;
  muted: boolean;
  flyPoked: 0 | 1 | 2;
  pokedAt: number;

  start: () => void;
  brainsDrop: () => void;
  brainsDropEnd: () => void;
  toggleMute: () => void;
  pokeFly: (who: 1 | 2, now: number) => void;
}

export const useGame = create<GameState>((set) => ({
  phase: "idle",
  dropped: false,
  dropsCount: 0,
  muted: false,
  flyPoked: 0,
  pokedAt: 0,

  start: () => set({ phase: "playing" }),

  // the brains decide this — synchrony between both motor populations
  brainsDrop: () =>
    set((s) => (s.dropped ? s : { dropped: true, dropsCount: s.dropsCount + 1 })),
  brainsDropEnd: () => set({ dropped: false }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),

  pokeFly: (who, t) => set({ flyPoked: who, pokedAt: t }),
}));

/** FLYTAPE-style mint status strip — pure brain-state reporting. */
export function statusFor(s: GameState, bar: number): FlytapeStatus {
  if (s.phase === "idle") {
    return { code: "STANDBY", detail: "Neural uplink idle — press START THE SET", progress: 0 };
  }
  if (bar < 4) {
    return {
      code: "BUILDING",
      detail: `Filter tight — full spectrum in ${Math.max(1, 4 - bar)} bar${4 - bar === 1 ? "" : "s"}`,
      progress: (bar / 4) * 100,
    };
  }
  if (s.dropped) {
    return {
      code: "DROPPED",
      detail: `Motor synchrony detected — drop ${s.dropsCount} live, ×2 energy`,
      progress: 100,
    };
  }
  return {
    code: "GROOVING",
    detail: "Brains generating — waiting on motor synchrony for the next drop",
    progress: 45,
  };
}
