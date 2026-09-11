/** Corpora: the music each brain grows up on. 32 steps = 2 bars of 16ths. */

export interface Corpus {
  style: string;
  channels: number; // 4: 0=kick 1=snare 2=hat 3=bass/lead
  /** per channel, sorted onset steps in [0,32) */
  onsets: number[][];
  /** pitches per channel per onset (scale degrees) — bass/lead channels only */
  pitches?: (number[] | undefined)[];
  /** semitone lookup for pitch degrees; defaults to A-minor pentatonic.
   *  Melodic corpora use the chromatic scale so real melodies survive. */
  scale?: number[];
}

/** all twelve semitones — lets a corpus spell real melodies */
export const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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

// ---- the classical records (public domain compositions, our patterns) ----

/** Beethoven, Für Elise (1810) — opening theme, A minor, register 12–24 */
export const JANELIA_TRACK_D: Corpus = {
  style: "für elise (A minor)",
  channels: 4,
  onsets: [
    [0, 16], // ghost kick — downbeats
    [8, 24], // ghost snare
    [2, 6, 10, 14, 18, 22, 26, 30], // offbeat hats
    [0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], // the theme
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [7, 6, 7, 6, 7, 2, 5, 3, 0, 3, 7, 0, 2, 7, 11, 2, 3],
  ],
  scale: CHROMATIC,
};

/** Satie, Gymnopédie No. 1 (1888) — slow, floating, sparse */
export const JANELIA_TRACK_E: Corpus = {
  style: "gymnopédie (Satie)",
  channels: 4,
  onsets: [
    [0, 16],
    [12, 28],
    [4, 20],
    [0, 6, 12, 16, 22, 28],
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [7, 4, 2, 0, 2, 7],
  ],
  scale: CHROMATIC,
};

/** Beethoven, Moonlight Sonata mvt. 1 (1801) — triplet arpeggio texture */
export const FLYWIRE_TRACK_D: Corpus = {
  style: "moonlight arpeggio",
  channels: 4,
  onsets: [
    [0, 12, 16, 28], // deep slow kick
    [8, 24], // soft snare
    [2, 6, 10, 14, 18, 22, 26, 30], // triplet-feel hats
    [0, 3, 6, 8, 11, 14, 16, 19, 22, 24, 27, 30], // rolling arpeggio
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [4, 11, 7, 4, 11, 7, 0, 7, 4, 2, 9, 6],
  ],
  scale: CHROMATIC,
};

/** Satie-adjacent slow groove for the rhythm brain */
export const FLYWIRE_TRACK_E: Corpus = {
  style: "gymnopédie pulse",
  channels: 4,
  onsets: [
    [0, 16],
    [],
    [4, 12, 20, 28],
    [0, 6, 16, 22],
  ],
  pitches: [undefined, undefined, undefined, [0, 7, 4, 11]],
  scale: CHROMATIC,
};

/** ORIGINAL composition (no external melody) — emotional arpeggio ballad in
 *  the style of romantic piano pieces; A-minor pent, register 12–24 */
export const JANELIA_TRACK_F: Corpus = {
  style: "river of lights (original)",
  channels: 4,
  onsets: [
    [0, 16],
    [8, 24],
    [2, 10, 18, 26],
    [0, 2, 4, 7, 9, 11, 14, 16, 18, 20, 23, 25, 27, 30],
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [0, 3, 7, 12, 10, 7, 3, 0, 10, 3, 7, 12, 10, 7],
  ],
};

// ---- the IDM records — classical themes cut into glitched breaks ----

/** Beethoven's Symphony No. 5 fate motif over glitched breaks */
export const FLYWIRE_TRACK_F: Corpus = {
  style: "beethoven 5 (idm)",
  channels: 4,
  onsets: [
    [0, 3, 6, 8, 11, 14, 16, 19, 22, 24, 27, 30], // irregular kick clusters
    [4, 12, 20, 28, 6, 14, 22, 30], // backbeat + ghost snare
    [0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29], // stutter hats
    [0, 2, 4, 8, 12, 14, 16, 20, 24, 26, 28], // da-da-da-DUM
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [0, 0, 0, 8, 5, 5, 5, 3, 0, 0, 8],
  ],
  scale: CHROMATIC,
};

/** Beethoven, Ode to Joy (1824) — the theme over glitch breaks */
export const JANELIA_TRACK_G: Corpus = {
  style: "ode to idm (beethoven)",
  channels: 4,
  onsets: [
    [0, 8, 16, 24],
    [],
    [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31], // ticking frame
    [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], // the theme
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [7, 7, 9, 11, 11, 9, 7, 5, 3, 3, 5, 7, 7, 5, 5, 5],
  ],
  scale: CHROMATIC,
};

/** Für Elise theme, stuttered and cut */
export const JANELIA_TRACK_H: Corpus = {
  style: "für elise (idm cut)",
  channels: 4,
  onsets: [
    [0, 16],
    [12, 28],
    [5, 9, 13, 15, 21, 25, 27, 31], // off-grid ghosts
    [0, 1, 2, 3, 4, 6, 7, 8, 10, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 30],
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [7, 6, 7, 6, 7, 2, 7, 5, 3, 0, 3, 0, 7, 0, 2, 7, 11, 2, 3, 7],
  ],
  scale: CHROMATIC,
};

/** the original ballad, glitched */
export const JANELIA_TRACK_I: Corpus = {
  style: "river of lights (idm)",
  channels: 4,
  onsets: [
    [0, 7, 16, 23],
    [10, 26],
    [3, 9, 13, 19, 25, 29, 31],
    [0, 1, 3, 4, 7, 9, 10, 12, 15, 16, 17, 19, 20, 23, 25, 26, 28, 31],
  ],
  pitches: [
    undefined,
    undefined,
    undefined,
    [0, 3, 7, 12, 10, 7, 3, 0, 10, 3, 7, 12, 10, 7, 3, 0, 3, 7],
  ],
};
