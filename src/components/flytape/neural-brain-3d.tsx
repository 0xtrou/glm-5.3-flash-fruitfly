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
 * Post: EffectComposer + RenderPass + UnrealBloomPass + OutputPass (the glow).
 *
 * Per frame: sim.tick(dt) EXACTLY once (this loop owns the tick while alive),
 * aAct attribute upload, soma glow, pulse integration, slow Y orbit, bloom.
 *
 * WebGL failure (no context / context lost) never crashes the page: the
 * parent is told via onWebgl(false) and keeps the sim ticking itself.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { audioEngine } from "@/lib/audio-engine";
import { fx } from "@/components/game/scene";
import { REGION_CX, REGION_OL, REGION_VNC, type NeuralSim } from "@/lib/neural-sim";

interface Props {
  sim: NeuralSim;
  accent: string;
  /** which audio transient drives this brain when the WebGL loop is not running */
  drive: "kick" | "treble";
  /** true once rendering; false when WebGL init failed or the context was lost */
  onWebgl?: (alive: boolean) => void;
}

const MAX_PULSES = 160;
const PULSE_FLOOR = 80; // keep at least this many signals in flight
const CONTENT_SPAN = 10; // largest bbox dimension maps to this many scene units
const DEPTH_SCALE = 0.55; // flatten z into a slab so the organ reads like FlyWire's map
const ORBIT_SPEED = 0.05; // rad/s around Y
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
  gl_PointSize = clamp(size * uDpr * uRefDist / max(1.0, -mv.z), 1.0, 30.0);
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
  // idle structure: dim silver-blue with a hint of panel tint + neuron hue
  vec3 dim = mix(vec3(0.16, 0.22, 0.38), uTint * 0.55 + 0.10, 0.30);
  dim = mix(dim, hue * 0.5 + 0.12, 0.35);
  // fire ramp: cyan -> mint -> amber -> white as act climbs
  float a = max(vAct, 0.0);
  vec3 fire = mix(vec3(0.30, 0.95, 1.00), vec3(0.35, 1.00, 0.62), smoothstep(0.15, 0.50, a));
  fire = mix(fire, vec3(1.00, 0.72, 0.28), smoothstep(0.50, 0.85, a));
  fire = mix(fire, vec3(1.00, 0.97, 0.86), smoothstep(0.85, 1.25, a));
  float w = smoothstep(0.15, 0.40, a); // below 0.15 = dim structure only
  vec3 col = mix(dim, fire * (0.75 + a * 0.70), w);
  gl_FragColor = vec4(col * disk, disk);
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
  gl_PointSize = clamp(size * uDpr * uRefDist / max(1.0, -mv.z), 1.0, 30.0);
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
  float glow = smoothstep(0.05, 1.0, max(vAct, 0.0));
  vec3 col = mix(hue * 0.45 + 0.42, vec3(1.00, 0.97, 0.88), glow * 0.85);
  gl_FragColor = vec4(col * disk * (0.75 + glow * 1.1), disk);
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
  gl_PointSize = clamp(size * uDpr * uRefDist / max(1.0, -mv.z), 1.0, 22.0);
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

export function NeuralBrain3D({ sim, accent, drive, onWebgl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onWebglRef = useRef(onWebgl);
  onWebglRef.current = onWebgl;

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

    const common = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
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
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.0, 0.55, 0);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

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
      camDist = Math.min(80, Math.max(8, radius / Math.sin(theta / 2) / 0.85));
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
      const py = (i: number) => (cy - sim.y[i]) * S; // flip: dataset y grows downward
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
        aHue[i] = hasHue
          ? sim.nodeHue[i]
          : sim.region[i] === REGION_VNC
            ? 0.09
            : sim.region[i] === REGION_CX
              ? 0.38
              : 0.58;
        aDeg[i] = deg.length === n ? Math.min(1, deg[i] / 16) : 0.25;
        aAct[i] = i < shown ? sim.act[i] : -1;
      }
      nodePositions = positions;
      nodeCount = n;

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

    // ---- dynamic pass: sim.act -> aAct, soma glow, line reactivity ----
    const updateDynamic = (dt: number) => {
      const shown = sim.revealedCount();
      const act = sim.act;
      const actAttr = nodeGeo.getAttribute("aAct") as THREE.BufferAttribute;
      const arr = actAttr.array as Float32Array;
      let hot = 0;
      for (let i = 0; i < nodeCount; i++) {
        const v = i < shown ? act[i] : -1;
        arr[i] = v;
        if (v > 0.15) hot++;
      }
      actAttr.needsUpdate = true;
      // cables breathe with population firing
      lineMat.opacity = 0.13 + 0.08 * Math.min(1, hot / 800);

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
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      nodeMat.uniforms.uDpr.value = pr;
      somaMat.uniforms.uDpr.value = pr;
      pulseMat.uniforms.uDpr.value = pr;
      fitCamera();
    };

    // ---- render loop state — owns sim.tick for as long as it is alive ----
    let raf = 0;
    let alive = true;
    let last = performance.now();
    let orbit = 0.6;
    const driveState = { lastDrive: 0, lastPulseAt: 0 };

    // ---- canvas into the panel ----
    const canvas = renderer.domElement;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    container.appendChild(canvas);

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

      orbit += dt * ORBIT_SPEED;
      const ce = Math.cos(ELEVATION);
      camera.position.set(Math.sin(orbit) * camDist * ce, Math.sin(ELEVATION) * camDist, Math.cos(orbit) * camDist * ce);
      camera.lookAt(0, 0, 0);

      composer.render();
    };
    raf = requestAnimationFrame(loop);
    onWebglRef.current?.(true);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      composer.dispose();
      bloomPass.dispose();
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
