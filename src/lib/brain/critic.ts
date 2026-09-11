import type { Corpus } from "./corpus";

/**
 * Critic — the dopamine stand-in. Judges motor spikes AFTER they happen.
 * reward(step, channelSpikes) ∈ [-1, 1]; aggregated per step by the trainer.
 */

export class Critic {
  private tolerance: number;
  private windowSkew = 0;
  constructor(private corpus: Corpus, tolerance = 1) {
    this.tolerance = tolerance;
  }

  /** expected onset mask per channel */
  isOnset(step: number, channel: number): boolean {
    const on = this.corpus.onsets[channel % this.corpus.onsets.length];
    if (!on) return false;
    for (const o of on) {
      const d = Math.abs(this.wrapped(step) - o);
      if (d <= this.tolerance) return true;
    }
    return false;
  }

  pitchAt(step: number, channel: number): number {
    const on = this.corpus.onsets[channel];
    const pit = this.corpus.pitches?.[channel];
    if (!pit) return 0;
    let best = on[0];
    let bestD = 99;
    for (const o of on) {
      const d = Math.abs(this.wrapped(step) - o);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return pit[on.indexOf(best) % pit.length];
  }

  private wrapped(step: number): number {
    const T = 32;
    return ((step + this.windowSkew) % T + T) % T;
  }

  /** score one 16th step given spike counts per motor channel. */
  reward(step: number, channelCounts: Map<number, number>): number {
    let r = 0;
    for (let ch = 0; ch < this.corpus.onsets.length; ch++) {
      const count = channelCounts.get(ch) ?? 0;
      const on = this.isOnset(step, ch);
      if (count > 0) {
        if (on) r += Math.min(0.5, 0.2 + count / 20); // earned the beat
        else r -= 1.0; // spamming costs more than hitting pays
      } else if (on && this.wrapped(step) % 8 === 0) {
        r -= 0.5; // strong onset dropped
      }
    }
    return Math.max(-1, Math.min(1, r));
  }
}
