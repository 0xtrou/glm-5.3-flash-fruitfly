"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sparkles, Html } from "@react-three/drei";
import type { Group, Mesh, PointLight, InstancedMesh } from "three";
import { Object3D } from "three";
import { audioEngine } from "@/lib/audio-engine";
import { useGame } from "@/lib/game-store";
import { flywireSim, janeliaSim, REGION_OL, REGION_CX, REGION_VNC } from "@/lib/neural-sim";
import { TheCrew } from "./flies";

export const LANE_X = [-1.5, -0.62, 0.62, 1.5] as const;
export const LANE_COLORS = ["#ff4646", "#ff9f45", "#a855f7", "#ec4899"] as const;
const HIT_Z = 2.4;
const SPAWN_Z = -10;
const TRAVEL = 1.7;
const NOTE_Y = 0.95;
const PERFECT_W = 0.075;
const GOOD_W = 0.14;

// cross-component frame FX signals
export const fx = { shakeUntil: 0, dropUntil: 0, r3fAlive: false };

interface NoteData {
  id: number;
  lane: 0 | 1 | 2 | 3;
  hitTime: number;
  status: "active" | "hit" | "missed";
}

/* ---------------- stage & props ---------------- */

function Deck({ x, color }: { x: number; color: string }) {
  const vinyl = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (vinyl.current && useGame.getState().phase === "playing") {
      vinyl.current.rotation.y -= dt * (useGame.getState().dropped ? 7 : 4.5);
    }
  });
  return (
    <group position={[x, 0.26, -0.9]}>
      <mesh>
        <boxGeometry args={[1.05, 0.1, 0.75]} />
        <meshStandardMaterial color="#14141d" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -0.02, 0.39]}>
        <boxGeometry args={[1.05, 0.03, 0.02]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} />
      </mesh>
      <mesh ref={vinyl} position={[x < 0 ? -0.22 : 0.22, 0.075, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.03, 28]} />
        <meshStandardMaterial color="#0a0a0e" roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[x < 0 ? -0.22 : 0.22, 0.092, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.032, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

function Mixer() {
  const faders = useRef<Mesh[]>([]);
  useFrame(() => {
    const bass = audioEngine.bassLevel();
    faders.current.forEach((f, i) => {
      if (f) f.scale.y = 0.5 + bass * (1 + i * 0.35);
    });
  });
  return (
    <group position={[0, 0.26, -0.9]}>
      <mesh>
        <boxGeometry args={[0.7, 0.12, 0.7]} />
        <meshStandardMaterial color="#181822" roughness={0.35} metalness={0.6} />
      </mesh>
      {[-0.21, -0.07, 0.07, 0.21].map((x, i) => (
        <mesh
          key={x}
          ref={(m) => {
            if (m) faders.current[i] = m;
          }}
          position={[x, 0.1, 0.1]}
        >
          <boxGeometry args={[0.06, 0.16, 0.05]} />
          <meshStandardMaterial color={LANE_COLORS[i]} emissive={LANE_COLORS[i]} emissiveIntensity={1.6} />
        </mesh>
      ))}
    </group>
  );
}

function Stage() {
  const ring = useRef<Mesh>(null);
  useFrame(() => {
    if (ring.current) {
      const m = ring.current.material as unknown as { emissiveIntensity: number };
      m.emissiveIntensity = 0.6 + audioEngine.bassLevel() * 2.4;
    }
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 1]}>
        <circleGeometry args={[14, 48]} />
        <meshStandardMaterial color="#0b0b16" roughness={0.35} metalness={0.7} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0.6]}>
        <ringGeometry args={[3.4, 3.7, 64]} />
        <meshStandardMaterial color="#4f46e5" emissive="#6366f1" emissiveIntensity={1} side={2} />
      </mesh>
      <mesh position={[0, -0.21, -1.6]}>
        <boxGeometry args={[7, 0.42, 3.2]} />
        <meshStandardMaterial color="#101019" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[-1.7, 0.0, -0.02]}>
        <boxGeometry args={[3.1, 0.05, 0.04]} />
        <meshStandardMaterial color="#ff4646" emissive="#ff4646" emissiveIntensity={2} />
      </mesh>
      <mesh position={[1.7, 0.0, -0.02]}>
        <boxGeometry args={[3.1, 0.05, 0.04]} />
        <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={2} />
      </mesh>
      <Deck x={-1.05} color="#ff4646" />
      <Deck x={1.05} color="#a855f7" />
      <Mixer />
    </group>
  );
}

function Crowd({ count = 64 }: { count?: number }) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useRef(new Object3D()).current;
  const data = useRef(
    Array.from({ length: count }, (_, i) => ({
      x: -4.4 + ((i * 7.3) % 8.8) + Math.sin(i * 12.9) * 0.3,
      z: 1.4 + ((i * 3.7) % 10) * 0.34,
      phase: (i * 1.618) % (Math.PI * 2),
      speed: ((Math.PI * 2) / (60 / 128)) * (0.9 + ((i * 0.37) % 0.25)),
    }))
  );

  useEffect(() => {
    data.current.forEach((c, i) => {
      dummy.position.set(c.x, 0, c.z);
      dummy.rotation.set(0, Math.sin(i) * 0.4, 0);
      dummy.scale.setScalar(0.85 + ((i * 0.29) % 0.4));
      dummy.updateMatrix();
      ref.current?.setMatrixAt(i, dummy.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    const s = useGame.getState();
    const bass = audioEngine.bassLevel();
    const amp = 0.05 + bass * (s.dropped ? 0.5 : 0.22);
    data.current.forEach((c, i) => {
      dummy.position.set(c.x, Math.abs(Math.sin(t * c.speed * 0.5 + c.phase)) * amp - 0.1, c.z);
      dummy.updateMatrix();
      ref.current?.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <capsuleGeometry args={[0.09, 0.18, 4, 8]} />
      <meshStandardMaterial color="#11111e" roughness={0.85} />
    </instancedMesh>
  );
}

const LASER_COLORS = ["#ff4646", "#a855f7", "#ff9f45", "#ec4899", "#38bdf8", "#facc15"];

function Lasers() {
  const group = useRef<Group>(null);
  const mats = useRef<{ m: { opacity: number }; c: string }[]>([]);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    const burst = performance.now() / 1000 < fx.dropUntil;
    const speed = useGame.getState().dropped ? 1.6 : 0.7;
    group.current.children.forEach((child, i) => {
      child.rotation.z = Math.sin(t * speed * (burst ? 2.2 : 1) + i * 1.1) * (burst ? 0.8 : 0.55);
      child.rotation.x = Math.cos(t * speed * 0.7 + i * 0.7) * 0.25;
    });
    group.current.children.forEach((child, i) => {
      const mesh = (child as Group).children[0] as Mesh | undefined;
      if (!mesh) return;
      const m = mesh.material as unknown as { opacity: number };
      m.opacity = burst ? 0.85 : 0.5;
      void mats;
    });
  });
  return (
    <group ref={group} position={[0, 5.6, -3.5]}>
      {LASER_COLORS.map((c, i) => (
        <group key={c} position={[(i - 2.5) * 0.9, 0, 0]}>
          <mesh position={[0, -3.4, 0]}>
            <boxGeometry args={[0.045, 6.8, 0.045]} />
            <meshBasicMaterial color={c} transparent opacity={0.5} blending={2} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DiscoBall() {
  const ball = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ball.current) ball.current.rotation.y = t * 0.5;
    if (light.current) {
      const bass = audioEngine.bassLevel();
      light.current.intensity = 26 + bass * 70;
    }
  });
  return (
    <group position={[0, 4.3, -1.4]}>
      <mesh ref={ball}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshStandardMaterial color="#9fb0e8" metalness={1} roughness={0.12} emissive="#4c5a99" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.5, 6]} />
        <meshBasicMaterial color="#33334a" />
      </mesh>
      <pointLight ref={light} position={[0, 0.2, 0.4]} color="#cdd6ff" intensity={30} distance={12} />
      <Sparkles count={70} scale={5} size={2.5} speed={0.5} color="#dfe6ff" position={[0, -0.4, 0.6]} />
    </group>
  );
}

/* ---------------- lights & fx ---------------- */

function EventConsumer() {
  const strobe = useRef<PointLight>(null);
  const flash = useRef<Mesh>(null);

  useFrame((_, dt) => {
    const now = audioEngine.time;
    while (audioEngine.visualEvents.length && audioEngine.visualEvents[0].time <= now) {
      const ev = audioEngine.visualEvents.shift();
      if (!ev) break;
      if (ev.type === "kick") {
        if (strobe.current) strobe.current.intensity += 5.5;
        // kicks hit FLYWIRE's brain — he rides the low end
        flywireSim.inject(REGION_OL, 0.5, 60);
      }
      if (ev.type === "snare") {
        // snares drive MC JANELIA — the hype side
        janeliaSim.inject(REGION_CX, 0.5, 60);
        janeliaSim.inject(REGION_OL, 0.25, 40);
      }
      if (ev.type === "drop") {
        fx.shakeUntil = performance.now() / 1000 + 0.9;
        fx.dropUntil = performance.now() / 1000 + 2.2;
        flywireSim.cascade(1.2);
        janeliaSim.cascade(1.2);
        if (strobe.current) strobe.current.intensity += 14;
        if (flash.current) {
          const m = flash.current.material as unknown as { opacity: number };
          m.opacity = 0.85;
        }
      }
      if (ev.type === "drop") {
        const s = useGame.getState();
        if (s.phase === "playing") s.brainsDrop();
      }
      if (ev.type === "drop-end") {
        useGame.getState().brainsDropEnd();
      }
    }
    if (strobe.current) strobe.current.intensity *= Math.exp(-dt * 9);
    if (flash.current) {
      const m = flash.current.material as unknown as { opacity: number };
      m.opacity *= Math.exp(-dt * 4.5);
    }
  });

  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#25254a", "#050508", 0.5]} />
      <spotLight position={[-1.2, 4.5, 2]} angle={0.55} penumbra={0.7} intensity={70} color="#ff5c5c" distance={14} />
      <spotLight position={[1.2, 4.5, 2]} angle={0.55} penumbra={0.7} intensity={70} color="#b47cff" distance={14} />
      <pointLight ref={strobe} position={[0, 3.2, 1.2]} color="#ffffff" intensity={0} distance={16} />
      <mesh ref={flash} position={[0, 0, -6]} scale={40} renderOrder={999}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} side={1} depthWrite={false} depthTest={false} />
      </mesh>
    </>
  );
}

function CameraRig() {
  const { camera } = useThree();
  const look = useRef({ x: 0, y: 0.95, z: -1 });

  useFrame(({ clock }) => {
    fx.r3fAlive = true;
    const t = clock.elapsedTime;
    const s = useGame.getState();
    const now = performance.now() / 1000;
    const shake = now < fx.shakeUntil ? 0.075 : 0;
    camera.position.x +=
      (Math.sin(t * 0.4) * 0.25 + (Math.random() - 0.5) * shake * 2 - camera.position.x) * 0.08;
    camera.position.y +=
      (1.75 + audioEngine.bassLevel() * 0.1 + (Math.random() - 0.5) * shake - camera.position.y) * 0.08;
    camera.position.z += ((s.dropped ? 5.9 : 6.4) - camera.position.z) * 0.03;
    camera.lookAt(look.current.x, look.current.y, look.current.z);
  });
  return null;
}

/* ---------------- root ---------------- */

export function StageScene() {
  return (
    <>
      <color attach="background" args={["#07070f"]} />
      <fog attach="fog" args={["#07070f", 10, 24]} />
      <CameraRig />
      <EventConsumer />
      <Stage />
      <TheCrew />
      <Crowd />
      <Lasers />
      <DiscoBall />
      <Sparkles count={60} scale={[14, 8, 10]} size={1.6} speed={0.3} color="#8f9dff" position={[0, 3, 0]} opacity={0.5} />
    </>
  );
}
