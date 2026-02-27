"use client";

import { useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ─── Constants ────────────────────────────────────────────────
const TABLE_W  = 6;
const TABLE_D  = 10;
const TABLE_H  = 0.15;
const PADDLE_W = 1.2;
const PADDLE_D = 0.25;
const PADDLE_H = 0.1;
const BALL_R   = 0.15;
const WIN_SCORE = 7;
const PLAYER_Z  = TABLE_D / 2 - 0.5;
const AI_Z      = -TABLE_D / 2 + 0.5;

type Difficulty = "easy" | "medium" | "hard" | "very_hard";
type Phase      = "start" | "rules" | "difficulty" | "playing" | "between" | "won";

const BALL_LAUNCH_SPEED = 3.5;

// Difficulty shifted up — easy = old medium, very_hard = near-impossible
const DIFF: Record<Difficulty, { lerp: number; speedInit: number; speedMax: number }> = {
  easy:      { lerp: 0.038, speedInit: 8,  speedMax: 18 },
  medium:    { lerp: 0.075, speedInit: 10, speedMax: 24 },
  hard:      { lerp: 0.14,  speedInit: 13, speedMax: 30 },
  very_hard: { lerp: 0.55,  speedInit: 16, speedMax: 38 }, // near-perfect AI
};

function beep(freq = 440, dur = 0.08) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = freq; o.type = "sine";
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch {}
}

// ─── Table ───────────────────────────────────────────────────
function Table() {
  return (
    <group>
      <mesh receiveShadow>
        <boxGeometry args={[TABLE_W, TABLE_H, TABLE_D]} />
        <meshLambertMaterial color="#1a6b1a" />
      </mesh>
      <mesh position={[0, TABLE_H / 2 + 0.001, 0]}>
        <boxGeometry args={[TABLE_W, 0.002, 0.05]} />
        <meshLambertMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, TABLE_H / 2 + 0.13, 0]}>
        <boxGeometry args={[TABLE_W, 0.24, 0.03]} />
        <meshLambertMaterial color="#cccccc" transparent opacity={0.75} />
      </mesh>
      {([-1, 1] as const).map(s => (
        <mesh key={s} position={[s * (TABLE_W / 2 + 0.075), TABLE_H / 2 + 0.2, 0]}>
          <boxGeometry args={[0.15, 0.4, TABLE_D + 0.3]} />
          <meshLambertMaterial color="#3d2b1f" />
        </mesh>
      ))}
      {([-1, 1] as const).map(s => (
        <mesh key={s} position={[0, TABLE_H / 2 + 0.2, s * (TABLE_D / 2 + 0.075)]}>
          <boxGeometry args={[TABLE_W + 0.3, 0.4, 0.15]} />
          <meshLambertMaterial color="#3d2b1f" />
        </mesh>
      ))}
      {([-1, 1] as const).flatMap(x =>
        ([-1, 1] as const).map(z => (
          <mesh key={`${x}${z}`} position={[x * (TABLE_W / 2 - 0.3), -1.5, z * (TABLE_D / 2 - 0.3)]}>
            <boxGeometry args={[0.15, 3, 0.15]} />
            <meshLambertMaterial color="#3d2b1f" />
          </mesh>
        ))
      )}
    </group>
  );
}

// ─── Finger Segment ──────────────────────────────────────────
function Seg({ len, r0, r1, color }: { len: number; r0: number; r1: number; color: string }) {
  return (
    <mesh position={[0, -len / 2, 0]}>
      <cylinderGeometry args={[r1, r0, len, 10]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

// One finger: 3 segments chained via nested groups
// Each group rotates its child relative to its own frame
function Finger({
  basePos, baseRotX, baseRotZ,
  seg1, seg2, seg3, color,
}: {
  basePos: [number, number, number];
  baseRotX: number; baseRotZ: number;
  seg1: { len: number; r0: number; r1: number; bx: number };
  seg2: { len: number; r0: number; r1: number; bx: number };
  seg3: { len: number; r0: number; r1: number };
  color: string;
}) {
  return (
    <group position={basePos} rotation={[baseRotX, 0, baseRotZ]}>
      <Seg len={seg1.len} r0={seg1.r0} r1={seg1.r1} color={color} />
      {/* joint sphere */}
      <mesh position={[0, -seg1.len, 0]}>
        <sphereGeometry args={[seg1.r1 * 1.05, 8, 8]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <group position={[0, -seg1.len, 0]} rotation={[seg1.bx, 0, 0]}>
        <Seg len={seg2.len} r0={seg2.r0} r1={seg2.r1} color={color} />
        <mesh position={[0, -seg2.len, 0]}>
          <sphereGeometry args={[seg2.r1 * 1.05, 8, 8]} />
          <meshLambertMaterial color={color} />
        </mesh>
        <group position={[0, -seg2.len, 0]} rotation={[seg2.bx, 0, 0]}>
          <Seg len={seg3.len} r0={seg3.r0} r1={seg3.r1} color={color} />
          {/* fingertip cap */}
          <mesh position={[0, -seg3.len, 0]}>
            <sphereGeometry args={[seg3.r1 * 0.9, 8, 8]} />
            <meshLambertMaterial color={color} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// Thumb: 2 segments
function Thumb({ basePos, baseRotX, baseRotZ, color }: {
  basePos: [number, number, number];
  baseRotX: number; baseRotZ: number; color: string;
}) {
  const r0 = 0.062, r1 = 0.055, r2 = 0.046;
  const l0 = 0.22, l1 = 0.17;
  return (
    <group position={basePos} rotation={[baseRotX, 0, baseRotZ]}>
      <Seg len={l0} r0={r0} r1={r1} color={color} />
      <mesh position={[0, -l0, 0]}>
        <sphereGeometry args={[r1 * 1.05, 8, 8]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <group position={[0, -l0, 0]} rotation={[0.4, 0, 0]}>
        <Seg len={l1} r0={r1} r1={r2} color={color} />
        <mesh position={[0, -l1, 0]}>
          <sphereGeometry args={[r2 * 0.9, 8, 8]} />
          <meshLambertMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

// ─── Floating Hand ────────────────────────────────────────────
// The hand floats above the paddle with fingers curling down around it.
// dir=1 → player side (camera facing), dir=-1 → AI side
function FloatingHand({ x, isPlayer, color }: { x: number; isPlayer: boolean; color: string }) {
  const dir    = isPlayer ? 1 : -1;
  const baseZ  = isPlayer ? PLAYER_Z : AI_Z;
  // Palm hovers above paddle, slightly toward player
  const palmY  = TABLE_H / 2 + PADDLE_H + 0.28;
  const palmZ  = baseZ + dir * 0.05;

  // Palm tilts slightly toward net (fingers point netward)
  const palmTiltX = dir * 0.18; // tilt forward

  // Finger colors — slightly lighter for highlight
  const skin = color;

  // Finger layout: index, middle, ring, pinky
  // Positions relative to palm center, spread across width
  // All fingers hang down and curl toward the paddle/net
  // baseRotX = angle from vertical (downward), more = more forward tilt
  // For player: fingers point in -z (toward net), for AI: +z
  const fingerFwd = -dir * Math.PI * 0.42; // tilt fingers forward toward net

  const fingers = [
    // index
    { bx: -0.30, bz:  0.04, spreadZ: 0.0,  rotZ: -0.08 },
    // middle
    { bx: -0.10, bz:  0.0,  spreadZ: 0.02, rotZ: -0.03 },
    // ring
    { bx:  0.10, bz:  0.0,  spreadZ: 0.02, rotZ:  0.03 },
    // pinky
    { bx:  0.28, bz: -0.02, spreadZ: 0.0,  rotZ:  0.1  },
  ];

  // Proximal segment dims (thicker at base, taper toward tip)
  const s1 = { len: 0.30, r0: 0.068, r1: 0.060, bx: 0.45 };
  const s2 = { len: 0.24, r0: 0.060, r1: 0.052, bx: 0.55 };
  const s3 = { len: 0.17, r0: 0.052, r1: 0.040 };
  const pS = { len: 0.27, r0: 0.064, r1: 0.057, bx: 0.42 }; // pinky slightly smaller
  const pS2 = { len: 0.20, r0: 0.057, r1: 0.049, bx: 0.52 };
  const pS3 = { len: 0.14, r0: 0.049, r1: 0.037 };

  return (
    <group position={[x, palmY, palmZ]} rotation={[palmTiltX, 0, 0]}>

      {/* ── Palm ── */}
      <mesh position={[0, 0, dir * 0.05]} castShadow>
        <boxGeometry args={[0.78, 0.12, 0.52]} />
        <meshLambertMaterial color={skin} />
      </mesh>
      {/* Palm back (slightly domed) */}
      <mesh position={[0, 0.05, dir * 0.05]}>
        <boxGeometry args={[0.72, 0.06, 0.44]} />
        <meshLambertMaterial color={skin} />
      </mesh>

      {/* ── 4 Fingers ── */}
      {fingers.map((f, i) => {
        const isP = i === 3; // pinky
        return (
          <Finger
            key={i}
            basePos={[f.bx, -0.06, dir * (-0.22 + f.spreadZ)]}
            baseRotX={fingerFwd}
            baseRotZ={f.rotZ}
            seg1={isP ? pS  : s1}
            seg2={isP ? pS2 : s2}
            seg3={isP ? pS3 : s3}
            color={skin}
          />
        );
      })}

      {/* ── Thumb ── */}
      {/* Thumb base is on the index-finger side, angled outward & down */}
      <Thumb
        basePos={[-0.44, -0.04, dir * 0.12]}
        baseRotX={dir * 0.3}
        baseRotZ={-dir * 0.7}
        color={skin}
      />

      {/* ── Knuckle row bumps ── */}
      {[-0.30, -0.10, 0.10, 0.28].map((kx, i) => (
        <mesh key={i} position={[kx, -0.03, dir * (-0.24)]}>
          <sphereGeometry args={[0.065, 8, 8]} />
          <meshLambertMaterial color={skin} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Ball ────────────────────────────────────────────────────
function Ball({ pos }: { pos: THREE.Vector3 }) {
  return (
    <mesh position={pos} castShadow>
      <sphereGeometry args={[BALL_R, 20, 20]} />
      <meshLambertMaterial color="#ffffff" />
    </mesh>
  );
}

// ─── Paddle (thin, under the hand) ───────────────────────────
function Paddle({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <mesh position={[x, TABLE_H / 2 + PADDLE_H / 2 + 0.01, z]} castShadow>
      <boxGeometry args={[PADDLE_W, PADDLE_H, PADDLE_D]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

// ─── Game Scene ──────────────────────────────────────────────
function GameScene({ phase, difficulty, onScore, ndcRef, ballRef, velRef, playerXRef, aiXRef, firstHitRef }: {
  phase: Phase; difficulty: Difficulty; onScore: (s: "player" | "ai") => void;
  ndcRef: React.MutableRefObject<{ x: number; y: number }>;
  ballRef: React.MutableRefObject<THREE.Vector3>;
  velRef:  React.MutableRefObject<THREE.Vector3>;
  playerXRef:  React.MutableRefObject<number>;
  aiXRef:      React.MutableRefObject<number>;
  firstHitRef: React.MutableRefObject<boolean>;
}) {
  useThree(); // keep hook for potential future use
  const [ballPos, setBallPos] = useState(() => ballRef.current.clone());
  const [playerX, setPlayerX] = useState(0);
  const [aiX,     setAiX]     = useState(0);
  const scoredRef = useRef(false);
  const prevPhase = useRef(phase);

  if (prevPhase.current !== phase) {
    if (phase === "playing") scoredRef.current = false;
    prevPhase.current = phase;
  }

  const { lerp, speedMax } = DIFF[difficulty];
  const maxPX = TABLE_W / 2 - PADDLE_W / 2;

  useFrame((_, delta) => {
    if (phase !== "playing" || scoredRef.current) return;
    const dt  = Math.min(delta, 0.05);
    const vel = velRef.current;
    const pos = ballRef.current;

    // Direct NDC x → world x mapping (ndcRef.x is -1..1 across screen)
    // Amplify slightly so full paddle range is reachable without edge-to-edge mouse travel
    playerXRef.current = Math.max(-maxPX, Math.min(maxPX, ndcRef.current.x * (TABLE_W / 2) * 1.1));

    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    const wallX = TABLE_W / 2 - BALL_R;
    if (pos.x >  wallX) { pos.x =  wallX; vel.x = -Math.abs(vel.x); beep(300, 0.05); }
    if (pos.x < -wallX) { pos.x = -wallX; vel.x =  Math.abs(vel.x); beep(300, 0.05); }

    const maxAX = TABLE_W / 2 - PADDLE_W / 2;
    aiXRef.current += (pos.x - aiXRef.current) * lerp;
    aiXRef.current  = Math.max(-maxAX, Math.min(maxAX, aiXRef.current));

    // Player hit
    if (vel.z > 0
      && pos.z >= PLAYER_Z - PADDLE_D / 2 - BALL_R
      && pos.z <= PLAYER_Z + PADDLE_D / 2 + BALL_R
      && Math.abs(pos.x - playerXRef.current) < PADDLE_W / 2 + BALL_R) {
      vel.z = -Math.abs(vel.z);
      vel.x += ((pos.x - playerXRef.current) / (PADDLE_W / 2)) * 3;
      // First hit: snap to full game speed
      if (!firstHitRef.current) {
        firstHitRef.current = true;
        const dir = vel.clone().normalize();
        vel.copy(dir.multiplyScalar(DIFF[difficulty].speedInit));
      } else if (vel.length() < speedMax) {
        vel.multiplyScalar(1.05);
      }
      pos.z = PLAYER_Z - PADDLE_D / 2 - BALL_R;
      beep(640, 0.09);
    }

    // AI hit
    if (vel.z < 0
      && pos.z <= AI_Z + PADDLE_D / 2 + BALL_R
      && pos.z >= AI_Z - PADDLE_D / 2 - BALL_R
      && Math.abs(pos.x - aiXRef.current) < PADDLE_W / 2 + BALL_R) {
      vel.z = Math.abs(vel.z);
      vel.x += ((pos.x - aiXRef.current) / (PADDLE_W / 2)) * 2;
      if (!firstHitRef.current) {
        firstHitRef.current = true;
        const dir = vel.clone().normalize();
        vel.copy(dir.multiplyScalar(DIFF[difficulty].speedInit));
      } else if (vel.length() < speedMax) {
        vel.multiplyScalar(1.03);
      }
      pos.z = AI_Z + PADDLE_D / 2 + BALL_R;
      beep(520, 0.09);
    }

    if (pos.z >  TABLE_D / 2 + 0.5) { scoredRef.current = true; onScore("ai");     return; }
    if (pos.z < -TABLE_D / 2 - 0.5) { scoredRef.current = true; onScore("player"); return; }

    setBallPos(pos.clone());
    setPlayerX(playerXRef.current);
    setAiX(aiXRef.current);
  });

  return (
    <>
      <Table />
      <Ball pos={ballPos} />
      <Paddle x={playerX} z={PLAYER_Z} color="#00c8e0" />
      <Paddle x={aiX}     z={AI_Z}     color="#cc3333" />
      <FloatingHand x={playerX} isPlayer={true}  color="#00c8e0" />
      <FloatingHand x={aiX}     isPlayer={false} color="#cc3333" />
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────
function doReset(
  ballRef:       React.MutableRefObject<THREE.Vector3>,
  velRef:        React.MutableRefObject<THREE.Vector3>,
  firstHitRef:   React.MutableRefObject<boolean>,
  diff: Difficulty, towardPlayer: boolean
) {
  const a = (Math.random() - 0.5) * 0.5;
  ballRef.current.set(0, TABLE_H / 2 + BALL_R + 0.01, 0);
  // Always launch slow — ramps to full speed on first paddle hit
  velRef.current.set(
    Math.sin(a) * BALL_LAUNCH_SPEED,
    0,
    (towardPlayer ? 1 : -1) * Math.cos(a) * BALL_LAUNCH_SPEED
  );
  firstHitRef.current = false; // reset flag
}

// ─── Root ────────────────────────────────────────────────────
export default function Game() {
  const [phase,      setPhase]      = useState<Phase>("start");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [scores,     setScores]     = useState({ player: 0, ai: 0 });
  const [winner,     setWinner]     = useState<"Player" | "AI" | null>(null);

  const ndcRef      = useRef({ x: 0, y: 0 });
  const ballRef     = useRef(new THREE.Vector3(0, TABLE_H / 2 + BALL_R + 0.01, 0));
  const velRef      = useRef(new THREE.Vector3(0, 0, BALL_LAUNCH_SPEED));
  const playerXRef  = useRef(0);
  const aiXRef      = useRef(0);
  const firstHitRef = useRef(false);

  const startGame = useCallback((diff: Difficulty) => {
    setScores({ player: 0, ai: 0 });
    setWinner(null);
    setDifficulty(diff);
    doReset(ballRef, velRef, firstHitRef, diff, true);
    setPhase("playing");
  }, []);

  const handleScore = useCallback((scorer: "player" | "ai") => {
    setScores(prev => {
      const next = {
        player: scorer === "player" ? prev.player + 1 : prev.player,
        ai:     scorer === "ai"     ? prev.ai + 1     : prev.ai,
      };
      if (next.player >= WIN_SCORE)      { setWinner("Player"); setPhase("won"); }
      else if (next.ai >= WIN_SCORE)     { setWinner("AI");     setPhase("won"); }
      else {
        setPhase("between");
        setTimeout(() => {
          doReset(ballRef, velRef, firstHitRef, difficulty, scorer === "ai");
          setPhase("playing");
        }, 1200);
      }
      return next;
    });
  }, [difficulty]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    ndcRef.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndcRef.current.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }, []);

  // Touch: use first touch point, map X directly — no preventDefault needed on passive
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    const r = e.currentTarget.getBoundingClientRect();
    ndcRef.current.x = ((touch.clientX - r.left) / r.width) * 2 - 1;
    ndcRef.current.y = -((touch.clientY - r.top) / r.height) * 2 + 1;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    const r = e.currentTarget.getBoundingClientRect();
    ndcRef.current.x = ((touch.clientX - r.left) / r.width) * 2 - 1;
    ndcRef.current.y = -((touch.clientY - r.top) / r.height) * 2 + 1;
  }, []);

  const ov = (extra?: React.CSSProperties): React.CSSProperties => ({
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.74)", zIndex: 20, fontFamily: "monospace",
    ...extra,
  });

  const btn = (col = "#00e5ff", extra?: React.CSSProperties): React.CSSProperties => ({
    padding: "16px 56px", border: `2px solid ${col}`, borderRadius: 6,
    color: col, fontSize: 18, fontWeight: 700, cursor: "pointer",
    letterSpacing: 2, textShadow: `0 0 10px ${col}`,
    boxShadow: `0 0 28px ${col}44`, background: "transparent", ...extra,
  });

  const diffMeta = {
    easy:      { label: "EASY",      sub: "Fair · Good starting point",         col: "#00ff88" },
    medium:    { label: "MEDIUM",    sub: "Challenging · Bring focus",           col: "#00e5ff" },
    hard:      { label: "HARD",      sub: "Fast AI · Reflexes required",         col: "#ffaa00" },
    very_hard: { label: "VERY HARD", sub: "Near-perfect AI · Nearly impossible", col: "#ff4444" },
  } as const;

  return (
    <div
      style={{ width: "100vw", height: "100vh", position: "relative", background: "#050510", cursor: "none", touchAction: "none" }}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
    >
      {/* HUD */}
      <div style={{ position:"absolute", top:20, left:0, right:0, display:"flex", justifyContent:"center", gap:48, zIndex:10, pointerEvents:"none" }}>
        <span style={{ fontFamily:"monospace", color:"#00e5ff", fontSize:32, textShadow:"0 0 12px #00e5ff" }}>YOU: {scores.player}</span>
        <span style={{ fontFamily:"monospace", color:"#444", fontSize:22, alignSelf:"center" }}>vs</span>
        <span style={{ fontFamily:"monospace", color:"#ff4444", fontSize:32, textShadow:"0 0 12px #ff4444" }}>AI: {scores.ai}</span>
      </div>
      <div style={{ position:"absolute", top:66, left:0, right:0, textAlign:"center", fontFamily:"monospace", color:"#00e5ff", fontSize:11, letterSpacing:6, opacity:0.35, pointerEvents:"none", zIndex:10 }}>
        MPIRE PING PONG
      </div>

      {/* In-game menu button */}
      {(phase === "playing" || phase === "between") && (
        <div
          onClick={() => setPhase("start")}
          style={{
            position:"absolute", top:18, right:20, zIndex:20,
            fontFamily:"monospace", fontSize:12, letterSpacing:2,
            color:"rgba(255,255,255,0.3)", cursor:"pointer",
            border:"1px solid rgba(255,255,255,0.12)",
            padding:"6px 14px", borderRadius:4,
            transition:"all 0.2s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
        >
          ← MENU
        </div>
      )}

      {/* 3D Canvas */}
      <Canvas camera={{ position: [0, 8, 12], fov: 50 }} shadows style={{ width:"100%", height:"100%" }}>
        <ambientLight intensity={0.45} />
        <directionalLight position={[5, 10, 5]} intensity={0.9} castShadow />
        <pointLight position={[0, 6, 0]} intensity={0.5} color="#00e5ff" />
        <GameScene
          phase={phase} difficulty={difficulty} onScore={handleScore}
          ndcRef={ndcRef} ballRef={ballRef} velRef={velRef}
          playerXRef={playerXRef} aiXRef={aiXRef}
          firstHitRef={firstHitRef}
        />
      </Canvas>

      {/* Start */}
      {phase === "start" && (
        <div style={ov()}>
          <div style={{ color:"#00e5ff", fontSize:46, textShadow:"0 0 28px #00e5ff", letterSpacing:6, textAlign:"center" }}>MPIRE PING PONG</div>
          <div style={{ marginTop:10, color:"#555", fontSize:13, letterSpacing:2 }}>First to {WIN_SCORE} wins</div>
          <div style={{ display:"flex", gap:16, marginTop:48 }}>
            <div onClick={() => setPhase("rules")} onTouchEnd={() => setPhase("rules")} style={btn("#888")}>HOW TO PLAY</div>
            <div onClick={() => setPhase("difficulty")} onTouchEnd={() => setPhase("difficulty")} style={btn()}>PLAY</div>
          </div>
        </div>
      )}

      {/* Rules */}
      {phase === "rules" && (
        <div style={ov()}>
          <div style={{ color:"#00e5ff", fontSize:28, letterSpacing:4, marginBottom:32 }}>HOW TO PLAY</div>
          <div style={{ display:"flex", flexDirection:"column", gap:18, maxWidth:480, textAlign:"left" }}>
            {[
              { icon:"🖱️", title:"Controls", body:"Move your mouse (or slide your finger on mobile) left and right to move the cyan paddle." },
              { icon:"🏓", title:"Objective", body:`Rally the ball past the AI's paddle. First player to score ${WIN_SCORE} points wins the match.` },
              { icon:"⚡", title:"Speed Up", body:"Every time a paddle makes contact the ball speeds up slightly. React faster as the rally goes on." },
              { icon:"📐", title:"Angles", body:"Hit the ball off-center to change its angle. The further from center you hit, the sharper the deflection." },
              { icon:"🚀", title:"Serve", body:"Each point starts with a slow serve — gives you time to get in position before the real rally begins." },
            ].map(r => (
              <div key={r.title} style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                <span style={{ fontSize:22, flexShrink:0 }}>{r.icon}</span>
                <div>
                  <div style={{ color:"#fff", fontSize:14, fontWeight:700, marginBottom:3, letterSpacing:1 }}>{r.title}</div>
                  <div style={{ color:"#777", fontSize:13, lineHeight:1.6 }}>{r.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", gap:16, marginTop:44 }}>
            <div onClick={() => setPhase("start")} style={btn("#555")}>← BACK</div>
            <div onClick={() => setPhase("difficulty")} style={btn()}>SELECT DIFFICULTY</div>
          </div>
        </div>
      )}

      {/* Difficulty */}
      {phase === "difficulty" && (
        <div style={ov()}>
          <div style={{ color:"#fff", fontSize:28, letterSpacing:4, marginBottom:8 }}>SELECT DIFFICULTY</div>
          <div style={{ color:"#555", fontSize:13, marginBottom:44 }}>How hard do you want the AI?</div>
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {(["easy","medium","hard","very_hard"] as Difficulty[]).map(d => {
              const m = diffMeta[d];
              return (
                <div key={d} onClick={() => startGame(d)} style={{
                  ...btn(m.col),
                  display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                  minWidth:340, padding:"18px 52px",
                }}>
                  <span style={{ fontSize:20, letterSpacing:3 }}>{m.label}</span>
                  <span style={{ fontSize:12, opacity:0.6, letterSpacing:1, fontWeight:400 }}>{m.sub}</span>
                </div>
              );
            })}
          </div>
          <div onClick={() => setPhase("start")} style={{ ...btn("#555"), marginTop:28 }}>← BACK</div>
        </div>
      )}

      {/* Between points */}
      {phase === "between" && (
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", zIndex:15, pointerEvents:"none" }}>
          <div style={{ fontFamily:"monospace", color:"#fff", fontSize:26, opacity:0.75, textShadow:"0 0 10px #fff" }}>Get ready...</div>
        </div>
      )}

      {/* Win */}
      {phase === "won" && winner && (
        <div style={ov()}>
          <div style={{ fontSize:54, color: winner==="Player" ? "#00e5ff" : "#ff4444", textShadow:`0 0 32px ${winner==="Player"?"#00e5ff":"#ff4444"}`, letterSpacing:4 }}>
            {winner === "Player" ? "YOU WIN!" : "AI WINS!"}
          </div>
          <div style={{ marginTop:14, color:"#666", fontSize:22, fontFamily:"monospace" }}>{scores.player} — {scores.ai}</div>
          <div style={{ display:"flex", gap:20, marginTop:52 }}>
            <div onClick={() => setPhase("difficulty")} style={btn()}>PLAY AGAIN</div>
            <div onClick={() => setPhase("start")} style={btn("#888")}>MENU</div>
          </div>
        </div>
      )}
    </div>
  );
}
