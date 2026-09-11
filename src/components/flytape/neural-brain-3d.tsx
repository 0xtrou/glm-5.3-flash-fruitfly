"use client";

/**
 * NeuralBrain3D — a Three.js window into one fly's spiking CNS.
 *
 * The FlyWire-map look: one continuous glowing organ — wide brain band
 * (left optic lobe / central brain / right optic lobe) with the VNC column
 * descending below — built from the sim's REAL cable edges + nodes.
 *
 * Scene graph (built once per dataset, keyed on sim.dataVersion + sim.count):
 *   · Points        — every cable node, custom shader: dim silver-blue structure,
 *                     firing nodes bloom cyan→mint→amber→white with sim.act
 *   · LineSegments  — real parent→child cable edges, silver-blue @ low opacity
 *   · Points        — somata (root node of each reconstructed neuron), larger
 *   · Points        — traveling pulses riding pulseTarget() hops (additive)
 * Post: none — solid colors, no bloom/glow. Cells, cables, vibration via color.
 *
 * Per frame: sim.tick(dt) EXACTLY once (this loop owns the tick while alive),
 * aAct attribute upload, soma glow, pulse integration, slow Y orbit, bloom.
 *
 * WebGL failure (no context / context lost) never crashes the page: the
 * parent is told via onWebgl(false) and keeps the sim ticking itself.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { audioEngine } from "@/lib/audio-engine";
import { fx } from "@/components/game/scene";
import { REGION_CX, REGION_OL, REGION_VNC, type NeuralSim } from "@/lib/neural-sim";
import { NEUROPHILS } from "@/lib/brain/atlas";

interface Props {
  sim: NeuralSim;
  accent: string;
  /** which audio transient drives this brain when the WebGL loop is not running */
  drive: "kick" | "treble";
  /** which trained brain's real firings light the nodes (utilization) */
  fly: "wire" | "janelia";
  /** true once rendering; false when WebGL init failed or the context was lost */
  onWebgl?: (alive: boolean) => void;
}

const MAX_PULSES = 160;
const PULSE_FLOOR = 80; // keep at least this many signals in flight
const CONTENT_SPAN = 10; // largest bbox dimension maps to this many scene units
const DEPTH_SCALE = 0.55; // flatten z into a slab so the organ reads like FlyWire's map
const ORBIT_SPEED = 0; // static camera — user request: no rotation
const ELEVATION = 0.3; // camera height angle
const FOV = 42;

/** Fallback sensory drive — audio transients into the sim when the main DJ
 *  scene's WebGL loop is down. Shared by the 3D loop and the panel's ticker. */
export function driveSensory(
  sim: NeuralSim,
  drive: "kick" | "treble",
  state: { lastDrive: number; lastPulseAt: number },
  now: number,
) {
  if (fx.r3fAlive) return;
  const level = drive === "kick" ? audioEngine.bassLevel() : audioEngine.trebleLevel();
  if (level - state.lastDrive > 0.06 && now - state.lastPulseAt > 340) {
    sim.inject(REGION_OL, 0.45, 120);
    state.lastPulseAt = now;
  }
  state.lastDrive = level;
}

const HUE2RGB = /* glsl */ `
vec3 hue2rgb(float h) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return rgb;
}
`;

const NODE_VERT = /* glsl */ `
attribute float aAct; // sim.act 0..1.6, or -1 = not yet revealed
attribute float aHue; // per-neuron rainbow hue
attribute float aDeg; // normalized synapse degree (thick trunks)
uniform float uRefDist;
uniform float uDpr;
varying float vAct;
varying float vHue;
void main() {
  vAct = aAct;
  vHue = aHue;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float fire = aAct <= 0.0 ? 0.0 : smoothstep(0.15, 1.15, aAct);
  float size = (2.3 + aDeg * 1.1) * (1.0 + fire * 1.8);
  gl_PointSize = clamp(size * uDpr * uRefDist / max(1.0, -mv.z), 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}
`;

const NODE_FRAG = /* glsl */ `
uniform vec3 uTint;
varying float vAct;
varying float vHue;
${HUE2RGB}
void main() {
  if (vAct < 0.0) discard; // hidden until the reveal sweep reaches this node
  float d = length(gl_PointCoord - vec2(0.5));
  float disk = smoothstep(0.5, 0.12, d);
  if (disk < 0.01) discard;
  vec3 hue = hue2rgb(vHue);
  float a = max(vAct, 0.0);
  // default: node carries its neuron's color, solid and calm
  vec3 base = hue * 0.6 + 0.16;
  // active: same node gets brighter — color lifts toward the fire ramp
  vec3 fire = mix(vec3(0.30, 0.95, 1.00), vec3(0.35, 1.00, 0.62), smoothstep(0.15, 0.50, a));
  fire = mix(fire, vec3(1.00, 0.72, 0.28), smoothstep(0.50, 0.85, a));
  fire = mix(fire, vec3(1.00, 0.97, 0.86), smoothstep(0.85, 1.25, a));
  float w = smoothstep(0.35, 0.85, a);
  vec3 col = mix(base, fire * 0.8, w);
  float bright = 0.55 + smoothstep(0.35, 1.1, a) * 0.75;
  gl_FragColor = vec4(col * disk * bright, disk);
}
`;

const SOMA_VERT = /* glsl */ `
attribute float aAct;
attribute float aHue;
uniform float uRefDist;
uniform float uDpr;
varying float vAct;
varying float vHue;
void main() {
  vAct = aAct;
  vHue = aHue;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = 3.4 + smoothstep(0.0, 1.0, max(vAct, 0.0)) * 2.6;
  gl_PointSize = clamp(size * uDpr * uRefDist / max(1.0, -mv.z), 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SOMA_FRAG = /* glsl */ `
varying float vAct;
varying float vHue;
${HUE2RGB}
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float disk = smoothstep(0.5, 0.10, d);
  if (disk < 0.01) discard;
  vec3 hue = hue2rgb(vHue);
  float glow = smoothstep(0.08, 0.9, max(vAct, 0.0));
  // quiet soma: dim tinted cell; firing soma: bright, white-cored
  vec3 col = mix(hue * 0.5 + 0.06, vec3(1.0, 0.98, 0.9), glow);
  gl_FragColor = vec4(col * disk * (0.22 + glow * 0.9), disk * (0.5 + glow * 0.5));
}
`;

const PULSE_VERT = /* glsl */ `
attribute float aAlpha;
uniform float uRefDist;
uniform float uDpr;
varying float vA;
void main() {
  vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = 2.4 + aAlpha * 3.0;
  gl_PointSize = clamp(size * uDpr * uRefDist / max(1.0, -mv.z), 1.0, 6.0);
  gl_Position = projectionMatrix * mv;
}
`;

const PULSE_FRAG = /* glsl */ `
varying float vA;
void main() {
  if (vA <= 0.001) discard;
  float d = length(gl_PointCoord - vec2(0.5));
  float disk = smoothstep(0.5, 0.06, d);
  vec3 col = mix(vec3(0.45, 1.00, 0.90), vec3(0.98, 1.00, 0.96), vA);
  gl_FragColor = vec4(col * disk * vA, disk * vA);
}
`;

export function NeuralBrain3D({ sim, accent, drive, fly, onWebgl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onWebglRef = useRef(onWebgl);
  onWebglRef.current = onWebgl;
  // the effect's render loop reads the LIVE brain each frame — keep it in a
  // ref so a replaced weights instance is picked up without a scene rebuild
  const flyRef = useRef(fly);
  flyRef.current = fly;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- renderer (WebGL failure must never crash the page) ----
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      onWebglRef.current?.(false);
      return;
    }

    // ---- static scene graph ----
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020508);
    const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.1, 200);
    const group = new THREE.Group();
    scene.add(group);

    let gravOff = new Float32Array(0);
    let gravVel = new Float32Array(0);

    const common = {
      transparent: true,
      depthWrite: false,
    } as const;

    const nodeMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: {
        uRefDist: { value: 20 },
        uDpr: { value: 1 },
        uTint: { value: new THREE.Color(accent || "#6f8fd0") },
      },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
    });
    const somaMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { uRefDist: { value: 20 }, uDpr: { value: 1 } },
      vertexShader: SOMA_VERT,
      fragmentShader: SOMA_FRAG,
    });
    const pulseMat = new THREE.ShaderMaterial({
      ...common,
      uniforms: { uRefDist: { value: 20 }, uDpr: { value: 1 } },
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
    });
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x6f8fd0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    let nodeGeo = new THREE.BufferGeometry();
    let somaGeo = new THREE.BufferGeometry();
    let lineGeo = new THREE.BufferGeometry();
    const pulsePos = new Float32Array(MAX_PULSES * 3);
    const pulseAlpha = new Float32Array(MAX_PULSES);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setAttribute("aAlpha", new THREE.BufferAttribute(pulseAlpha, 1));

    const lineObj = new THREE.LineSegments(lineGeo, lineMat);
    const pointsObj = new THREE.Points(nodeGeo, nodeMat);
    const somaObj = new THREE.Points(somaGeo, somaMat);
    const pulseObj = new THREE.Points(pulseGeo, pulseMat);
    pulseObj.frustumCulled = false;
    group.add(lineObj, pointsObj, somaObj, pulseObj);

    // ---- postprocessing: bloom is what makes it read "living brain" ----


    // ---- per-dataset build state ----
    let builtKey = -1;
    let nodeCount = 0;
    let nodePositions = new Float32Array(0);
    let somaMeta: { start: number; count: number }[] = [];
    let radius = 1;
    let camDist = 20;

    const fitCamera = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const aspect = w > 0 && h > 0 ? w / h : 1.6;
      camera.aspect = aspect;
      const vFov = (FOV * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const theta = Math.min(vFov, hFov);
      camDist = Math.min(80, Math.max(3, radius / Math.sin(theta / 2) / 1.0));
      camera.updateProjectionMatrix();
      nodeMat.uniforms.uRefDist.value = camDist;
      somaMat.uniforms.uRefDist.value = camDist;
      pulseMat.uniforms.uRefDist.value = camDist;
    };

    /** Rebuild all static buffers — once per dataset swap (and once at boot). */
    const buildStatic = () => {
      const n = sim.count;
      // bbox over the normalized coords
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (let i = 0; i < n; i++) {
        const xv = sim.x[i];
        const yv = sim.y[i];
        const zv = sim.z[i];
        if (xv < minX) minX = xv;
        if (xv > maxX) maxX = xv;
        if (yv < minY) minY = yv;
        if (yv > maxY) maxY = yv;
        if (zv < minZ) minZ = zv;
        if (zv > maxZ) maxZ = zv;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxY - minY, (maxZ - minZ) * DEPTH_SCALE, 1e-6);
      const S = CONTENT_SPAN / span;
      const px = (i: number) => (sim.x[i] - cx) * S;
      const py = (i: number) => (sim.y[i] - cy) * S; // brain band up top, VNC hangs down
      const pz = (i: number) => (sim.z[i] - cz) * S * DEPTH_SCALE;

      const shown = sim.revealedCount();
      const hasHue = sim.nodeHue.length === n;
      const deg = sim.deg;
      const positions = new Float32Array(n * 3);
      const aHue = new Float32Array(n);
      const aDeg = new Float32Array(n);
      const aAct = new Float32Array(n);
      let ex0 = Infinity,
        ex1 = -Infinity,
        ey0 = Infinity,
        ey1 = -Infinity,
        ez0 = Infinity,
        ez1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const X = px(i);
        const Y = py(i);
        const Z = pz(i);
        positions[i * 3] = X;
        positions[i * 3 + 1] = Y;
        positions[i * 3 + 2] = Z;
        if (X < ex0) ex0 = X;
        if (X > ex1) ex1 = X;
        if (Y < ey0) ey0 = Y;
        if (Y > ey1) ey1 = Y;
        if (Z < ez0) ez0 = Z;
        if (Z > ez1) ez1 = Z;
        aHue[i] = hasHue ? sim.nodeHue[i] : 0.5;
        aDeg[i] = deg.length === n ? Math.min(1, deg[i] / 16) : 0.25;
        aAct[i] = i < shown ? sim.act[i] : -1;
      }
      nodePositions = positions;
      nodeCount = n;
      gravOff = new Float32Array(n * 3);
      gravVel = new Float32Array(n * 3);

      nodeGeo.dispose();
      nodeGeo = new THREE.BufferGeometry();
      nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      nodeGeo.setAttribute("aHue", new THREE.BufferAttribute(aHue, 1));
      nodeGeo.setAttribute("aDeg", new THREE.BufferAttribute(aDeg, 1));
      nodeGeo.setAttribute("aAct", new THREE.BufferAttribute(aAct, 1));
      pointsObj.geometry = nodeGeo;

      // real cable edges — the skeleton that fuses the points into one organ
      lineGeo.dispose();
      const edges = sim.edgeList;
      if (edges && edges.length >= 2) {
        const lp = new Float32Array((edges.length / 2) * 6);
        let e = 0;
        for (let k = 0; k < edges.length; k += 2) {
          const a = edges[k];
          const b = edges[k + 1];
          lp[e++] = px(a);
          lp[e++] = py(a);
          lp[e++] = pz(a);
          lp[e++] = px(b);
          lp[e++] = py(b);
          lp[e++] = pz(b);
        }
        lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3));
        lineObj.visible = true;
      } else {
        lineGeo = new THREE.BufferGeometry(); // procedural atlas — points only
        lineObj.visible = false;
      }
      lineObj.geometry = lineGeo;

      // somata — root node of each reconstructed neuron, slightly larger
      somaGeo.dispose();
      somaMeta = [];
      for (const r of sim.neuronRanges) if (r.start < n) somaMeta.push({ start: r.start, count: r.count });
      const sc = somaMeta.length;
      const cap = Math.max(1, sc);
      const sp = new Float32Array(cap * 3);
      const sh = new Float32Array(cap);
      const sa = new Float32Array(cap);
      for (let s = 0; s < sc; s++) {
        const root = somaMeta[s].start;
        sp[s * 3] = px(root);
        sp[s * 3 + 1] = py(root);
        sp[s * 3 + 2] = pz(root);
        sh[s] = hasHue ? sim.nodeHue[root] : 0.5;
      }
      somaGeo = new THREE.BufferGeometry();
      somaGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
      somaGeo.setAttribute("aHue", new THREE.BufferAttribute(sh, 1));
      somaGeo.setAttribute("aAct", new THREE.BufferAttribute(sa, 1));
      somaGeo.setDrawRange(0, sc);
      somaObj.geometry = somaGeo;

      radius = 0.5 * Math.hypot(ex1 - ex0, ey1 - ey0, ez1 - ez0) || 1;
      fitCamera();
    };

    // ---- traveling pulses (preallocated — zero per-frame allocation) ----
    const pulseT = new Float32Array(MAX_PULSES);
    const pulseSpeed = new Float32Array(MAX_PULSES);
    const pulseHops = new Int32Array(MAX_PULSES);
    const pulseA = new Uint32Array(MAX_PULSES);
    const pulseB = new Uint32Array(MAX_PULSES);
    const freeSlots = new Int32Array(MAX_PULSES);
    let freeTop = 0;
    for (let i = 0; i < MAX_PULSES; i++) freeSlots[freeTop++] = MAX_PULSES - 1 - i;
    const activeSlots = new Int32Array(MAX_PULSES);
    let activeCount = 0;

    const spawnPulse = (i: number) => {
      if (freeTop === 0) return;
      const slot = freeSlots[--freeTop];
      pulseA[slot] = i;
      pulseB[slot] = sim.pulseTarget(i);
      pulseT[slot] = 0;
      pulseSpeed[slot] = 3 + Math.random() * 4;
      pulseHops[slot] = 6 + ((Math.random() * 8) | 0);
      pulseAlpha[slot] = Math.min(1, pulseHops[slot] / 7);
      activeSlots[activeCount++] = slot;
    };

    const updatePulses = (dt: number, shown: number) => {
      const want = activeCount < PULSE_FLOOR ? 6 : 2;
      let spawned = 0;
      for (let tries = 0; tries < 12 && activeCount < MAX_PULSES && spawned < want; tries++) {
        const i = (Math.random() * shown) | 0;
        if (sim.act[i] > 0.6 && sim.degree(i) > 0) {
          spawnPulse(i);
          spawned++;
        }
      }
      for (let k = activeCount - 1; k >= 0; k--) {
        const slot = activeSlots[k];
        pulseT[slot] += pulseSpeed[slot] * dt;
        if (pulseT[slot] >= 1) {
          pulseT[slot] = 0;
          pulseA[slot] = pulseB[slot];
          pulseB[slot] = sim.pulseTarget(pulseA[slot]);
          if (--pulseHops[slot] <= 0) {
            pulseAlpha[slot] = 0;
            activeSlots[k] = activeSlots[--activeCount];
            freeSlots[freeTop++] = slot;
            continue;
          }
          pulseAlpha[slot] = Math.min(1, pulseHops[slot] / 7);
        }
        const a = pulseA[slot];
        const b = pulseB[slot];
        const t = pulseT[slot];
        if (a < nodeCount && b < nodeCount) {
          pulsePos[slot * 3] = nodePositions[a * 3] + (nodePositions[b * 3] - nodePositions[a * 3]) * t;
          pulsePos[slot * 3 + 1] =
            nodePositions[a * 3 + 1] + (nodePositions[b * 3 + 1] - nodePositions[a * 3 + 1]) * t;
          pulsePos[slot * 3 + 2] =
            nodePositions[a * 3 + 2] + (nodePositions[b * 3 + 2] - nodePositions[a * 3 + 2]) * t;
        }
      }
      (pulseGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (pulseGeo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    };

    // ---- dynamic pass: sim.act + TRAINED brain firings -> aAct, soma glow ----
    // The panel's %util reads the trained network's real node firings — the
    // animation must show the same thing. Node indices match 1:1 (both walk
    // the morphology bundle in order). Two visual components per node:
    //   fresh spike (≤24 substeps)  → bright bloom, the rhythm you can see
    //   fired this util window (≤512) → sustained lift, the %util you can count
    const FRESH = 24; // substeps of bright bloom after a spike (~375ms @ 96 BPM)
    const UTIL_WINDOW = 512; // same window the %util metric counts
    const UTIL_LIFT = 0.3; // sustained brightness of a recently-fired node
    const updateDynamic = (dt: number) => {
      const shown = sim.revealedCount();
      const act = sim.act;
      const actAttr = nodeGeo.getAttribute("aAct") as THREE.BufferAttribute;
      const arr = actAttr.array as Float32Array;
      const brain = audioEngine.brains.brainOf(flyRef.current);
      const lastFire = brain?.lastFire;
      const tSub = brain?.clock ?? 0;
      let hot = 0;
      for (let i = 0; i < nodeCount; i++) {
        let v = i < shown ? act[i] : -1;
        if (lastFire && i < nodeCount) {
          const since = tSub - lastFire[i];
          if (since >= 0 && since < UTIL_WINDOW) {
            const bloom = since < FRESH ? (1 - since / FRESH) * 1.3 : 0;
            v = Math.max(v, bloom, UTIL_LIFT);
          }
        }
        arr[i] = v;
        if (v > 0.15) hot++;
      }
      actAttr.needsUpdate = true;
      // cables breathe with population firing
      lineMat.opacity = 0.24 + 0.1 * Math.min(1, hot / 800);

      const somaAttr = somaGeo.getAttribute("aAct") as THREE.BufferAttribute;
      const sArr = somaAttr.array as Float32Array;
      for (let s = 0; s < somaMeta.length; s++) {
        const meta = somaMeta[s];
        const stride = Math.max(1, Math.floor(meta.count / 6));
        let sum = 0;
        let c = 0;
        for (let k = 0; k < meta.count && c < 6; k += stride, c++) sum += act[meta.start + k];
        sArr[s] = c > 0 ? sum / c : 0;
      }
      somaAttr.needsUpdate = true;

      updatePulses(dt, shown);
    };

    // ---- sizing ----
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      const pr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h);
      nodeMat.uniforms.uDpr.value = pr;
      somaMat.uniforms.uDpr.value = pr;
      pulseMat.uniforms.uDpr.value = pr;
      fitCamera();
    };

    // ---- render loop state — owns sim.tick for as long as it is alive ----
    let raf = 0;
    let alive = true;
    let last = performance.now();
    // interactive camera — drag to orbit, wheel to zoom (user-navigable)
    let orbit = 0.35;
    let elev = ELEVATION;
    let userZoom = 1;
    const driveState = { lastDrive: 0, lastPulseAt: 0 };

    // ---- canvas into the panel ----
    const canvas = renderer.domElement;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    container.appendChild(canvas);

    // ---- navigation: wheel zoom + drag orbit ----
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      userZoom = Math.min(4, Math.max(0.35, userZoom * (1 + ev.deltaY * 0.0011)));
    };
    const onDown = (ev: PointerEvent) => {
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      orbit -= (ev.clientX - lastX) * 0.005;
      elev = Math.min(1.35, Math.max(-0.5, elev + (ev.clientY - lastY) * 0.004));
      lastX = ev.clientX;
      lastY = ev.clientY;
    };
    const onUp = (ev: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture?.(ev.pointerId);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.style.touchAction = "pan-y"; // horizontal drag orbits, vertical swipe scrolls the page (mobile)
    const removeNav = () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      alive = false; // render loop exits; the panel's fallback ticker takes over
      onWebglRef.current?.(false);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const loop = (ts: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;

      sim.tick(dt); // this brain ticks exactly here, once per frame
      driveSensory(sim, drive, driveState, ts);

      const key = sim.dataVersion * 4194304 + sim.count;
      if (key !== builtKey) {
        builtKey = key;
        buildStatic();
      }

      updateDynamic(dt);

      const ce = Math.cos(elev);
      camera.position.set(Math.sin(orbit) * camDist * userZoom * ce, Math.sin(elev) * camDist * userZoom, Math.cos(orbit) * camDist * userZoom * ce);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    onWebglRef.current?.(true);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      removeNav();
      renderer.dispose();
      nodeGeo.dispose();
      somaGeo.dispose();
      lineGeo.dispose();
      pulseGeo.dispose();
      nodeMat.dispose();
      somaMat.dispose();
      pulseMat.dispose();
      lineMat.dispose();
      renderer.dispose();
      if (canvas.parentNode === container) container.removeChild(canvas);
    };
  }, [sim, drive, accent]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />;
}
