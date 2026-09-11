/**
 * Drosophila neuropil atlas — scientific layout for the brain panels.
 *
 * Positions are normalized, atlas-style coordinates derived from the standard
 * adult fly brain anatomy as published in the JRC2018 unisex template space
 * (Bogovic et al., PLOS ONE 2020) and the FlyWire 783 release visuals
 * (Schlegel et al., Nature 2024). Values are approximations of the true
 * neuropil bounding boxes — correct relative arrangement, simplified volumes.
 *
 * Frontal view convention: -x = left hemisphere, +x = right hemisphere,
 * -y = ventral (down), +y = dorsal (up), z = anterior(-) / posterior(+).
 * Rendering maps y → screen up, x → screen right.
 */

export interface Neuropil {
  name: string;
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
}

export const NEUROPHILS: Neuropil[] = [
  // ---- optic lobes (lateral, large) ----
  { name: "Medulla L", cx: -0.46, cy: 0.05, cz: 0.05, rx: 0.19, ry: 0.28, rz: 0.16 },
  { name: "Medulla R", cx: 0.46, cy: 0.05, cz: 0.05, rx: 0.19, ry: 0.28, rz: 0.16 },
  { name: "Lobula L", cx: -0.6, cy: -0.18, cz: -0.05, rx: 0.1, ry: 0.14, rz: 0.12 },
  { name: "Lobula R", cx: 0.6, cy: -0.18, cz: -0.05, rx: 0.1, ry: 0.14, rz: 0.12 },
  { name: "Lobula plate L", cx: -0.68, cy: 0.02, cz: -0.12, rx: 0.07, ry: 0.12, rz: 0.09 },
  { name: "Lobula plate R", cx: 0.68, cy: 0.02, cz: -0.12, rx: 0.07, ry: 0.12, rz: 0.09 },

  // ---- central brain ----
  { name: "Antennal lobe L", cx: -0.18, cy: -0.42, cz: 0.28, rx: 0.1, ry: 0.09, rz: 0.08 },
  { name: "Antennal lobe R", cx: 0.18, cy: -0.42, cz: 0.28, rx: 0.1, ry: 0.09, rz: 0.08 },
  { name: "Mushroom body calyx L", cx: -0.24, cy: 0.18, cz: 0.1, rx: 0.09, ry: 0.09, rz: 0.08 },
  { name: "Mushroom body calyx R", cx: 0.24, cy: 0.18, cz: 0.1, rx: 0.09, ry: 0.09, rz: 0.08 },
  { name: "Mushroom body lobe L", cx: -0.22, cy: -0.1, cz: 0.12, rx: 0.06, ry: 0.14, rz: 0.06 },
  { name: "Mushroom body lobe R", cx: 0.22, cy: -0.1, cz: 0.12, rx: 0.06, ry: 0.14, rz: 0.06 },
  { name: "Fan-shaped body", cx: 0, cy: 0.16, cz: 0.02, rx: 0.1, ry: 0.06, rz: 0.06 },
  { name: "Ellipsoid body", cx: 0, cy: 0.06, cz: 0.04, rx: 0.09, ry: 0.05, rz: 0.05 },
  { name: "Noduli L", cx: -0.08, cy: 0.02, cz: -0.04, rx: 0.05, ry: 0.05, rz: 0.05 },
  { name: "Noduli R", cx: 0.08, cy: 0.02, cz: -0.04, rx: 0.05, ry: 0.05, rz: 0.05 },
  { name: "Superior protocerebrum L", cx: -0.24, cy: 0.34, cz: 0.05, rx: 0.12, ry: 0.1, rz: 0.09 },
  { name: "Superior protocerebrum R", cx: 0.24, cy: 0.34, cz: 0.05, rx: 0.12, ry: 0.1, rz: 0.09 },
  { name: "Gnathal ganglia", cx: 0, cy: -0.58, cz: 0.05, rx: 0.1, ry: 0.08, rz: 0.08 },

  // ---- ventral nerve cord (thoracic + abdominal neuromeres) ----
  { name: "Prothoracic neuromere T1", cx: 0, cy: -0.74, cz: 0, rx: 0.1, ry: 0.07, rz: 0.07 },
  { name: "Mesothoracic neuromere T2", cx: 0, cy: -0.86, cz: 0, rx: 0.11, ry: 0.07, rz: 0.07 },
  { name: "Metathoracic neuromere T3", cx: 0, cy: -0.97, cz: 0, rx: 0.1, ry: 0.06, rz: 0.07 },
  { name: "Abdominal neuromeres", cx: 0, cy: -1.08, cz: 0, rx: 0.08, ry: 0.08, rz: 0.06 },
];

/**
 * Assignment plan: which neuropils the sampled neurons of each brain populate.
 * Balanced so every major mass has cells. brainNeurons / vncNeurons = counts.
 */
export function assignNeuropils(brainNeurons: number, vncNeurons: number, seed: number): string[] {
  const brainOrder = [
    "Medulla L", "Medulla R", "Medulla L", "Medulla R",
    "Lobula L", "Lobula R",
    "Mushroom body calyx L", "Mushroom body calyx R",
    "Fan-shaped body", "Ellipsoid body",
    "Antennal lobe L", "Antennal lobe R",
    "Superior protocerebrum L", "Superior protocerebrum R",
    "Lobula plate L", "Lobula plate R",
    "Mushroom body lobe L", "Mushroom body lobe R",
    "Noduli L", "Noduli R",
    "Gnathal ganglia",
  ];
  const vncOrder = [
    "Prothoracic neuromere T1", "Mesothoracic neuromere T2",
    "Metathoracic neuromere T3", "Abdominal neuromeres",
  ];
  // deterministic shuffle for variety between brains (seeded)
  let a = seed >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (order: string[], need: number, pool: string[]): string[] => {
    const out: string[] = [];
    let i = 0;
    while (out.length < need) {
      if (i < order.length) {
        out.push(order[i]);
        i++;
      } else {
        out.push(pool[(rand() * pool.length) | 0]);
      }
    }
    return out;
  }
  const brainPool = NEUROPHILS.slice(0, 21).map((np) => np.name);
  const vncPool = NEUROPHILS.slice(21).map((np) => np.name);
  return [...pick(brainOrder, brainNeurons, brainPool), ...pick(vncOrder, vncNeurons, vncPool)];
}

/** neuropil lookup by name */
export function neuropilByName(name: string): Neuropil {
  return NEUROPHILS.find((np) => np.name === name) ?? NEUROPHILS[8];
}
