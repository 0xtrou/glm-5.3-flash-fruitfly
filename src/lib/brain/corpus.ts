/** Corpora: the music each brain grows up on. 32 steps = 2 bars of 16ths. */

export interface Corpus {
  style: string;
  channels: number; // 4: 0=kick 1=snare 2=hat 3=bass/lead
  /** per channel, sorted onset steps in [0,32) */
  onsets: number[][];
  /** pitches per channel per onset (scale degrees) — bass/lead channels only */
  pitches?: (number[] | undefined)[];
}

// A minor pentatonic degrees, low → high
export const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17];

export const FLYWIRE_CORPUS: Corpus = {
  style: "straight 4/4 techno",
  channels: 4,
  onsets: [
    [0, 8, 16, 24, 31], // kick — four on the floor + ghost
    [8, 24], // snare
    [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], // hats — eighths
    [0, 3, 6, 10, 12, 16, 19, 22, 26, 28], // bass
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [0, 0, 3, 3, 5, 0, 0, 3, 7, 5],
  ],
};

export const JANELIA_CORPUS: Corpus = {
  style: "syncopated breaks",
  channels: 4,
  onsets: [
    [0, 10, 16, 22, 26], // kick — broken
    [4, 12, 20, 28], // snare — backbeat
    [2, 6, 7, 10, 14, 15, 18, 22, 23, 26, 30, 31], // hats — 16th stutter
    [2, 7, 11, 14, 18, 23, 27, 30], // lead
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [5, 7, 10, 7, 5, 3, 5, 0],
  ],
};

export const CHANNEL_STYLES = ["kick", "snare", "hat", "melodic"];


// ---- extra tracks: the DJs switch records mid-set ----

export const FLYWIRE_TRACK_B: Corpus = {
  style: "hard techno",
  channels: 4,
  onsets: [
    [0, 4, 8, 12, 16, 20, 24, 28],
    [4, 12, 20, 28],
    [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
    [2, 6, 10, 14, 18, 22, 26, 30],
  ],
  pitches: [undefined, undefined, undefined, [0, 0, 3, 5, 3, 0, 7, 5]],
};

export const FLYWIRE_TRACK_C: Corpus = {
  style: "deep 4/4",
  channels: 4,
  onsets: [
    [0, 8, 16, 24],
    [8, 24],
    [2, 6, 10, 14, 18, 22, 26, 30],
    [0, 5, 8, 13, 16, 21, 24, 29],
  ],
  pitches: [undefined, undefined, undefined, [0, 5, 3, 3, 7, 5, 0, 0]],
};

export const JANELIA_TRACK_B: Corpus = {
  style: "jungle breaks",
  channels: 4,
  onsets: [
    [0, 10, 16, 26],
    [4, 12, 20, 28],
    [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
    [0, 6, 10, 16, 22, 26],
  ],
  pitches: [undefined, undefined, undefined, [7, 5, 10, 7, 12, 10, 7, 5]],
};

export const JANELIA_TRACK_C: Corpus = {
  style: "melodic dub",
  channels: 4,
  onsets: [
    [0, 6, 16, 22],
    [8, 24],
    [4, 12, 20, 28],
    [2, 5, 9, 12, 18, 21, 25, 28],
  ],
  pitches: [undefined, undefined, undefined, [0, 3, 7, 10, 12, 10, 7, 5]],
};
