"use client";

/**
 * NeuralBrain3D — a Three.js window into one fly's spiking CNS.
 *
 * The FlyWire-map look: one continuous glowing organ — wide brain band
 * (left optic lobe / central brain / right optic lobe) with the VNC column
 * descending below — built from the sim's REAL cable edges + nodes.
 *
 * Scene graph (built once per dataset, keyed on sim.dataVersion + sim.count):
 *   · Points        — every real neuron, custom shader. TWO states only:
 *                     DEFAULT = area color at low brightness (amber/teal/
 *                     violet brain areas), ACTIVE = highlighted flash of
 *                     the same area color when the brain drives it.
 * NO connection lines are drawn (user call): wiring stays in the sim.
 * ONE unified activity animation: the worker's per-spike flash.
 *
 * ALL per-node compute lives in the Web Worker: it samples the trained
 * brains at 10 Hz and transfers the glow buffer; this component only
 * swaps the GPU attribute and draws. Per-frame JS over 139k nodes: zero.
 *
 * WebGL failure (no context / context lost) never crashes the page: the
 * parent is told via onWebgl(false).
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

const CONTENT_SPAN = 10; // largest bbox dimension maps to this many scene units
const DEPTH_SCALE = 0.55; // flatten z into a slab so the organ reads like FlyWire's map
const ORBIT_SPEED = 0; // static camera — user request: no rotation
const ELEVATION = 0.3; // camera height angle
const FOV = 42;

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
  // two states only: DEFAULT (area color, low brightness) and ACTIVE
  // (highlighted). Size is static structure — brightness is the signal.
  float size = 2.3 + aDeg * 1.1;
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
  // EXACTLY TWO STATES:
  // DEFAULT — the node shows its brain-area color at low brightness
  // ACTIVE  — the brain drove this neuron: same area color, highlighted
  vec3 base = hue * 0.55 + 0.14;
  vec3 lit = hue * 0.85 + 0.30;
  float w = smoothstep(0.05, 0.85, a);
  vec3 col = mix(base, lit, w);
  float bright = 0.55 + smoothstep(0.10, 1.2, a) * 0.75;
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
    let nodeGeo = new THREE.BufferGeometry();
    let somaGeo = new THREE.BufferGeometry();

    // connection lines are intentionally NOT rendered (user call): the
    // wiring stays in the simulation — only neurons are drawn
    const pointsObj = new THREE.Points(nodeGeo, nodeMat);
    const somaObj = new THREE.Points(somaGeo, somaMat);
    group.add(pointsObj, somaObj);

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
      // brain areas carry distinct hues — idle AND active (optic lobe amber,
      // central brain teal, nerve cord violet)
      const AREA_HUES = [0.09, 0.52, 0.87];
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
      let bad = 0;
      for (let i = 0; i < n; i++) {
        let X = px(i);
        let Y = py(i);
        let Z = pz(i);
        if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(Z)) {
          bad++;
          if (bad === 1) console.warn(`NeuralBrain3D: ${fly} node ${i} had non-finite position — zeroed`);
          X = 0; Y = 0; Z = 0;
        }
        positions[i * 3] = X;
        positions[i * 3 + 1] = Y;
        positions[i * 3 + 2] = Z;
        if (X < ex0) ex0 = X;
        if (X > ex1) ex1 = X;
        if (Y < ey0) ey0 = Y;
        if (Y > ey1) ey1 = Y;
        if (Z < ez0) ez0 = Z;
        if (Z > ez1) ez1 = Z;
        aHue[i] = AREA_HUES[sim.region[i]] ?? (hasHue ? sim.nodeHue[i] : 0.5);
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
      nodeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CONTENT_SPAN * 4);
      pointsObj.geometry = nodeGeo;
      if (bad > 0) console.warn(`NeuralBrain3D: ${fly} — ${bad} non-finite positions zeroed total`);

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
        sh[s] = AREA_HUES[sim.region[root]] ?? (hasHue ? sim.nodeHue[root] : 0.5);
      }
      somaGeo = new THREE.BufferGeometry();
      somaGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
      somaGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CONTENT_SPAN * 4);
      somaGeo.setAttribute("aHue", new THREE.BufferAttribute(sh, 1));
      somaGeo.setAttribute("aAct", new THREE.BufferAttribute(sa, 1));
      somaGeo.setDrawRange(0, sc);
      somaObj.geometry = somaGeo;

      radius = 0.5 * Math.hypot(ex1 - ex0, ey1 - ey0, ez1 - ez0) || 1;
      fitCamera();
    };

    // ---- dynamic pass: 100% worker-computed, ONE unified animation ----
    // The worker owns ALL per-node compute: it samples its trained brains at
    // 10 Hz and builds the single activity visual — a ~1s smooth flash per
    // real spike (rise, plateau, release), dark otherwise — then transfers
    // the buffer. The main thread NEVER loops over the 139k nodes.
    let appliedGfxVersion = -1;
    const updateDynamic = () => {
      const snap = audioEngine.brains.glowSnap(flyRef.current);
      if (!snap || snap.version === appliedGfxVersion) return;
      appliedGfxVersion = snap.version;
      nodeGeo.setAttribute("aAct", new THREE.BufferAttribute(snap.glow, 1));;
      if (somaMeta.length) {
        const somaAttr = somaGeo.getAttribute("aAct") as THREE.BufferAttribute;
        const sArr = somaAttr.array as Float32Array;
        const glow = snap.glow;
        for (let s = 0; s < somaMeta.length; s++) {
          const meta = somaMeta[s];
          const stride = Math.max(1, Math.floor(meta.count / 6));
          let sum = 0;
          let c = 0;
          for (let k = 0; k < meta.count && c < 6; k += stride, c++) sum += glow[meta.start + k];
          sArr[s] = c > 0 ? sum / c : 0;
        }
        somaAttr.needsUpdate = true;
      }
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

      const key = sim.dataVersion * 4194304 + sim.count;
      if (key !== builtKey) {
        builtKey = key;
        buildStatic();
      }

      updateDynamic();

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
      nodeMat.dispose();
      somaMat.dispose();
      renderer.dispose();
      if (canvas.parentNode === container) container.removeChild(canvas);
    };
  }, [sim, drive, accent]);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />;
}
