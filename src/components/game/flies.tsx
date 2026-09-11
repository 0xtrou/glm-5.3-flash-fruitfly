"use client";

import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group, Mesh } from "three";
import { useGame } from "@/lib/game-store";
import { audioEngine } from "@/lib/audio-engine";


const BEAT = 60 / 128;

export interface FlyProps {
  name: string;
  role: string;
  eyeColor: string;
  accent: string;
  bodyColor: string;
  position: [number, number, number];
  side: -1 | 1;
  who: 1 | 2;
  glasses?: boolean;
  chain?: boolean;
  lines: string[];
}

const BUBBLE =
  "absolute max-w-[220px] -translate-x-1/2 rounded-2xl border-2 border-black bg-white px-3 py-2 text-center text-[13px] font-bold leading-snug text-black shadow-[3px_3px_0_rgba(0,0,0,0.9)]";

export function Fly({
  name,
  role,
  eyeColor,
  accent,
  bodyColor,
  position,
  side,
  who,
  glasses,
  chain,
  lines,
}: FlyProps) {
  const bob = useRef<Group>(null);
  const head = useRef<Group>(null);
  const wingL = useRef<Mesh>(null);
  const wingR = useRef<Mesh>(null);
  const armR = useRef<Group>(null);
  const glassesRef = useRef<Group>(null);
  const eyesRef = useRef<Group>(null);
  const antennaeRef = useRef<Group>(null);
  // brain-event animation state — impulses injected by THIS fly's own spikes
  const hopY = useRef(0);
  const hopV = useRef(0);
  const flutter = useRef(0);
  const lastStepIdx = useRef(-1);
  const nextBlink = useRef(2 + Math.random() * 3);
  const blinkUntil = useRef(0);
  const phase = useGame((s) => s.phase);
  const [bubble, setBubble] = useState<string | null>(null);

  // speech bubbles only when the brain actually bursts — thinking gets said out loud
  useEffect(() => {
    if (phase !== "playing") {
      setBubble(null);
      return;
    }
    let i = Math.floor(Math.random() * lines.length);
    const id = setInterval(() => {
      // speak only on a central-brain burst of ITS OWN music brain
      const think = audioEngine.brains.flyDrive(who === 1 ? "wire" : "janelia").think;
      if (think > 0.12) {
        i = (i + 1 + Math.floor(Math.random() * 2)) % lines.length;
        setBubble(lines[i]);
        window.setTimeout(() => setBubble(null), 3800);
      }
    }, 9000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const s = useGame.getState();
    const dropped = s.dropped;
    const beat = t / BEAT;

    // ---- real reflections: read THIS fly's music-generating brain ----
    // these are the EMA'd spike outputs of the exact network making the sound
    const drive = audioEngine.brains.flyDrive(who === 1 ? "wire" : "janelia");
    const motor = drive.motor;
    const think = drive.think;
    const contemplating = think > 0.35 && motor < 0.18;
    const exaggerate = who === 2 ? 1.6 : 1.0;

    // ---- brain EVENTS, not just levels: each 16th, the fly's own raw spike
    // counts kick physical impulses. Motor burst → body pop. Central burst →
    // wing flutter + antenna excitement. Nothing here fires without spikes.
    const sp = audioEngine.brains.spikesNow();
    const mine = who === 1 ? sp.wire : sp.janelia;
    if (sp.idx !== lastStepIdx.current) {
      lastStepIdx.current = sp.idx;
      hopV.current += Math.min(1, mine.motor / 12) * 0.16 * exaggerate;
      flutter.current = Math.min(1.5, flutter.current + mine.central / 60 + (mine.central > 0 ? 0.2 : 0));
    }
    flutter.current *= Math.exp(-dt * 5);
    hopV.current -= hopY.current * 0.35; // spring back to rest
    hopV.current *= 0.82; // damping
    hopY.current += hopV.current;

    // FLYWIRE bounces ON the beat; JANELIA bounces OFF it (phase-shifted half beat)
    const beatPhase = beat + (who === 2 ? 0.5 : 0);
    const amp = 0.025 + motor * 0.13 * exaggerate + (dropped ? 0.04 : 0);

    if (bob.current) {
      bob.current.position.y = Math.abs(Math.sin(Math.PI * beatPhase)) * amp + Math.max(-0.02, hopY.current);
      bob.current.rotation.z = Math.sin(t * (dropped ? 4.2 + motor * 3 : 2.1 + motor * 2)) * (0.02 + motor * 0.05) * side;
      // contemplating → lean in toward the decks
      bob.current.rotation.x = contemplating ? 0.12 : 0;
      if (s.flyPoked === who) {
        const dtP = performance.now() / 1000 - s.pokedAt;
        if (dtP < 0.7) {
          bob.current.position.y += Math.sin((dtP / 0.7) * Math.PI) * 0.35;
          bob.current.rotation.y = (dtP / 0.7) * Math.PI * 2 * side;
        } else bob.current.rotation.y = 0;
      } else bob.current.rotation.y = 0;
    }

    // head nods with its own central firing; contemplation tilts the head
    if (head.current) {
      head.current.rotation.x = Math.sin(Math.PI * beat) * (0.04 + think * 0.14 + (dropped ? 0.05 : 0));
      head.current.rotation.z = Math.sin(t * 0.8 + side) * 0.05 + (contemplating ? 0.18 * side : 0);
    }

    // wings flap at the rate of the fly's own motor cortex, with a burst of
    // extra flutter while its central brain is actively firing
    const flap = Math.sin(t * (85 + motor * 140 + flutter.current * 150 + (dropped ? 40 : 0))) * (0.85 + flutter.current * 0.2);
    if (wingL.current) wingL.current.rotation.y = 0.5 + flap;
    if (wingR.current) wingR.current.rotation.y = -0.5 - flap;

    // antennae twitch with thinking — central spikes keep them restless
    if (antennaeRef.current) {
      antennaeRef.current.rotation.x = -Math.sin(t * (16 + think * 44)) * (0.08 + think * 0.22 + flutter.current * 0.18);
    }

    // arms throw hands with the fly's own motor bursts (JANELIA flails more)
    if (armR.current) {
      const up = Math.min(1, motor * 1.2 * exaggerate);
      armR.current.rotation.x = -0.9 - up * 1.4;
    }

    // blink (biology, not music)
    if (t > nextBlink.current) {
      blinkUntil.current = t + 0.13;
      nextBlink.current = t + 2.2 + Math.random() * 3.5;
    }
    const blinking = t < blinkUntil.current;
    if (eyesRef.current) {
      const sc = blinking ? 0.12 : 1;
      eyesRef.current.scale.y += (sc - eyesRef.current.scale.y) * 0.55;
      // eyes blaze with central-brain activity — you can see it think
      const mat = eyesRef.current.children[0] as Mesh | undefined;
      if (mat) {
        const m = mat.material as unknown as { emissiveIntensity?: number } | undefined;
        if (m && m.emissiveIntensity !== undefined) {
          let target = 0.7 + think * 2.4;
          if (dropped) target += 0.8;
          m.emissiveIntensity += (target - m.emissiveIntensity) * 0.2;
        }
      }
    }

    // deal-with-it glasses descend on drop
    if (glassesRef.current) {
      const targetY = dropped ? 0 : 0.45;
      glassesRef.current.position.y += (targetY - glassesRef.current.position.y) * 0.14;
    }
  });

  return (
    <group position={position} scale={1.7}>
      <Html position={[0, 1.75, 0]} center distanceFactor={5.5} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        {bubble ? <div className={BUBBLE}>{bubble}</div> : null}
      </Html>

      <group ref={bob}>
        {/* wings */}
        <mesh ref={wingL} position={[-0.1, 0.32, -0.16]} rotation={[0, 0.5, 0.35]}>
          <circleGeometry args={[0.3, 24]} />
          <meshBasicMaterial color="#cfe8ff" transparent opacity={0.5} side={2} depthWrite={false} />
        </mesh>
        <mesh ref={wingR} position={[0.1, 0.32, -0.16]} rotation={[0, -0.5, -0.35]}>
          <circleGeometry args={[0.3, 24]} />
          <meshBasicMaterial color="#cfe8ff" transparent opacity={0.5} side={2} depthWrite={false} />
        </mesh>

        {/* abdomen */}
        <mesh position={[0, 0.22, -0.18]} rotation={[0.5, 0, 0]}>
          <capsuleGeometry args={[0.16, 0.22, 6, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.55} metalness={0.15} />
        </mesh>
        {/* thorax */}
        <mesh position={[0, 0.34, -0.02]}>
          <sphereGeometry args={[0.17, 20, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} metalness={0.2} />
        </mesh>

        {/* back legs */}
        {[-1, 1].map((sd) =>
          [0, 1].map((i) => (
            <mesh key={`${sd}-${i}`} position={[sd * 0.16, 0.1 - i * 0.08, -0.22 + i * 0.06]} rotation={[0, 0, sd * (0.9 + i * 0.2)]}>
              <cylinderGeometry args={[0.008, 0.008, 0.2, 6]} />
              <meshStandardMaterial color="#191924" />
            </mesh>
          ))
        )}

        {/* front arms */}
        <group position={[-side * 0.14, 0.3, 0.1]} rotation={[0.9, 0, side * 0.4]}>
          <mesh position={[0, -0.1, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.22, 6]} />
            <meshStandardMaterial color="#191924" />
          </mesh>
        </group>
        <group ref={armR} position={[side * 0.14, 0.3, 0.1]}>
          <mesh position={[0, -0.11, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.24, 6]} />
            <meshStandardMaterial color="#191924" />
          </mesh>
          <mesh position={[0, -0.24, 0]}>
            <sphereGeometry args={[0.028, 10, 8]} />
            <meshStandardMaterial color="#191924" />
          </mesh>
        </group>

        {/* head */}
        <group ref={head} position={[0, 0.52, 0.05]}>
          <mesh>
            <sphereGeometry args={[0.155, 20, 16]} />
            <meshStandardMaterial color={bodyColor} roughness={0.45} metalness={0.2} />
          </mesh>

          <group ref={eyesRef}>
            {[-1, 1].map((sd) => (
              <group key={sd}>
                <mesh position={[sd * 0.085, 0.02, 0.1]} scale={[1, 1, 0.72]}>
                  <sphereGeometry args={[0.085, 16, 14]} />
                  <meshStandardMaterial color={eyeColor} emissive={eyeColor} emissiveIntensity={2.4} roughness={0.2} />
                </mesh>
                <mesh position={[sd * 0.115, 0.06, 0.14]}>
                  <sphereGeometry args={[0.018, 8, 8]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
              </group>
            ))}
          </group>

          {/* antennae — twitch with central-brain spikes */}
          <group ref={antennaeRef}>
            {[-1, 1].map((sd) => (
              <mesh key={sd} position={[sd * 0.04, 0.17, 0.02]} rotation={[0.3, 0, sd * 0.5]}>
                <cylinderGeometry args={[0.006, 0.006, 0.14, 5]} />
                <meshStandardMaterial color="#191924" />
              </mesh>
            ))}
          </group>

          {/* headphones */}
          <group>
            <mesh position={[0, 0.1, -0.01]} rotation={[0.25, 0, 0]}>
              <torusGeometry args={[0.14, 0.016, 8, 24, Math.PI]} />
              <meshStandardMaterial color="#141419" roughness={0.4} />
            </mesh>
            {[-1, 1].map((sd) => (
              <mesh key={sd} position={[sd * 0.145, 0.02, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 1.4]}>
                <cylinderGeometry args={[0.045, 0.045, 0.035, 14]} />
                <meshStandardMaterial color="#f5b301" metalness={0.7} roughness={0.3} emissive="#f5b301" emissiveIntensity={0.45} />
              </mesh>
            ))}
          </group>

          {/* DEAL WITH IT pixel glasses — descend on drop */}
          {glasses ? (
            <group ref={glassesRef} position={[0, 0.45, 0.13]}>
              {[
                [-0.095, 0], [-0.065, 0], [-0.035, 0],
                [0.035, 0], [0.065, 0], [0.095, 0],
                [-0.095, 0.03], [0.095, 0.03],
              ].map(([x, y], i) => (
                <mesh key={i} position={[x, y, 0]}>
                  <boxGeometry args={[0.032, 0.026, 0.01]} />
                  <meshBasicMaterial color="#0a0a0a" />
                </mesh>
              ))}
              <mesh position={[0, 0.005, 0]}>
                <boxGeometry args={[0.075, 0.016, 0.01]} />
                <meshBasicMaterial color="#0a0a0a" />
              </mesh>
            </group>
          ) : null}
        </group>

        {/* gold chain — FLYWIRE drip */}
        {chain ? (
          <group position={[0, 0.4, 0.09]}>
            <mesh rotation={[0.35, 0, 0]}>
              <torusGeometry args={[0.11, 0.012, 8, 20]} />
              <meshStandardMaterial color="#f5b301" metalness={0.85} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.26, 0.05]}>
              <boxGeometry args={[0.05, 0.05, 0.015]} />
              <meshStandardMaterial color="#f5b301" metalness={0.85} roughness={0.25} emissive="#f5b301" emissiveIntensity={0.25} />
            </mesh>
          </group>
        ) : null}
      </group>

      {/* name tag — click to poke (airhorn) */}
      <Html position={[0, -0.12, 0.2]} center distanceFactor={6} zIndexRange={[10, 0]}>
        <button
          onClick={() => {
            audioEngine.horn();
            useGame.getState().pokeFly(who, performance.now() / 1000);
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[11px] font-black tracking-wider whitespace-nowrap text-white uppercase backdrop-blur transition hover:scale-105"
          style={{ boxShadow: `0 0 14px ${accent}55` }}
        >
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent }} />
          {name}
          <span className="font-medium text-white/50 normal-case">{role}</span>
        </button>
      </Html>
    </group>
  );
}

const FLYWIRE_LINES = [
  "BZZT. Perfect. Obviously.",
  "I survived Beat Saber hell for THIS crowd?",
  "Scratching with 4 legs. 2 are for vibes.",
  "That combo? 140,000 neurons agreed on it.",
  "Request denied. I only play bangers.",
];

const JANELIA_LINES = [
  "PUT YOUR TRUNKS UP!! WAIT. WRONG SPECIES.",
  "51.7 MILLION SYNAPSES SAID THROW IT BACK",
  "BZZZZZZZT!! LET'S GOOO",
  "I'm not saying it's a simulation. I'm saying DANCE like it is.",
  "Hype me and I drop the glasses. Deal with it.",
];

export function TheCrew() {
  return (
    <group>
      <Fly
        name="DJ FLYWIRE"
        role="turntablist"
        eyeColor="#ff2d2d"
        accent="#ff5c5c"
        bodyColor="#2b2b3d"
        position={[-1.22, 0, -1.45]}
        side={-1}
        who={1}
        chain
        lines={FLYWIRE_LINES}
      />
      <Fly
        name="MC JANELIA"
        role="hypeman"
        eyeColor="#a855f7"
        accent="#c084fc"
        bodyColor="#322950"
        position={[1.22, 0, -1.45]}
        side={1}
        who={2}
        glasses
        lines={JANELIA_LINES}
      />
    </group>
  );
}
