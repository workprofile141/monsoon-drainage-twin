/**
 * Immersive 3D digital twin of one mine sump (cutaway through the sump centre).
 * Every dynamic element is driven by the hydraulic feed:
 *  water body ← level from volume via the sump prismoid  ·  rain density ← intensity
 *  runoff particles ← calculated runoff  ·  suction/discharge particles ← each running pump's capacity
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { MineModel } from '../engine/mine';
import { surfaceAt } from '../engine/geometry';

export const S = 0.1; // scene units per metre (horizontal)

export interface FeedPump { id: string; label: string; tag: string; status: string; running: boolean; eff: number; rated: number }
export interface TwinFeed {
  V: number; levelM: number; cap: number;
  intensity: number; qRunoff: number; qIn: number;
  capEff: number; pumpedRate: number; overflowing: boolean; powerOn: boolean;
  pumps: FeedPump[];
  levels: { warnM: number; dangerM: number; critM: number; spillM: number; rimM: number };
}

const PUMP_COLOR: Record<string, string> = { ON: '#22a356', OFF: '#7b8494', STANDBY: '#3b7dd8', MAINTENANCE: '#e0a800', FAILED: '#e5383b' };

function hash(x: number, z: number) { const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return h - Math.floor(h); }
function noisy(c: THREE.Color, x: number, z: number, amt = 0.08) {
  const n = (hash(x, z) - 0.5) * amt + (hash(Math.floor(x / 9), Math.floor(z / 9)) - 0.5) * amt;
  return new THREE.Color(Math.min(1, Math.max(0, c.r + n)), Math.min(1, Math.max(0, c.g + n)), Math.min(1, Math.max(0, c.b + n * 0.8)));
}

export function MineScene({ m, feed, labels, onPumpClick }: { m: MineModel; feed: TwinFeed; labels: boolean; onPumpClick?: (id: string) => void }) {
  const VE = m.tc.verticalExaggeration;
  const Y = (e: number) => e * S * VE;
  const pumpXs = useMemo(() => feed.pumps.map((_, i) => (-m.topL / 2 + ((i + 1) / (feed.pumps.length + 1)) * m.topL) * 0.8), [feed.pumps.length, m.topL]);
  return (
    <>
      <color attach="background" args={['#dfeaf7']} />
      <fog attach="fog" args={['#dfeaf7', 260, 620]} />
      <hemisphereLight args={['#f4f8ff', '#8a7a62', 0.9]} />
      <directionalLight position={[-80, 140, 90]} intensity={1.35} />
      <directionalLight position={[120, 60, -60]} intensity={0.35} />
      <Terrain m={m} />
      <Sections m={m} />
      <Water m={m} feed={feed} />
      <LevelMarks m={m} feed={feed} labels={labels} />
      <Rain m={m} intensity={feed.intensity} />
      <Runoff m={m} q={feed.qRunoff} />
      <DischargeChannel m={m} flowing={feed.pumpedRate > 0} />
      {feed.pumps.map((p, i) => <PumpUnit key={p.id} m={m} p={p} x={pumpXs[i]} feed={feed} labels={labels} onClick={onPumpClick} />)}
      {feed.overflowing && <Html position={[0, Y(m.pitFloorE) + 3, -m.topW * S / 2]} center><div className="tag3d" style={{ background: '#e5383b', color: '#fff', fontWeight: 700 }}>⚠ OVERFLOW — water leaving the sump onto the pit floor</div></Html>}
      <OrbitControls makeDefault target={[0, Y(m.pitFloorE) - 1, -m.topW * S * 0.25]} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.02} minDistance={8} maxDistance={520} />
    </>
  );
}

// ---------------------------------------------------------------------------- terrain (back half, z ≤ 0)
function Terrain({ m }: { m: MineModel }) {
  const geom = useMemo(() => {
    const cell = 4;
    const nx = Math.ceil((2 * m.X) / cell), nz = Math.ceil(m.Z / cell);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const VE = m.tc.verticalExaggeration;
    const layerCols = m.tc.layers.map((l) => new THREE.Color(l.color));
    const grass = new THREE.Color('#8fa36a'), dumpC = new THREE.Color('#a8906c'), floorC = new THREE.Color('#5b5148');
    let k = 0;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = -m.X + (i / nx) * 2 * m.X, z = -m.Z + (j / nz) * m.Z;
      const e = m.elevation(x, z);
      pos[k * 3] = x * S; pos[k * 3 + 1] = e * S * VE; pos[k * 3 + 2] = z * S;
      let c: THREE.Color;
      const inPit = Math.abs(x) < m.pitL / 2 && Math.abs(z) < m.pitW / 2;
      if (!inPit && e > 0.5) c = noisy(dumpC, x, z, 0.1);
      else if (!inPit || e > -0.5) c = noisy(grass, x, z, 0.12);
      else if (e <= m.pitFloorE + 0.6 + (m.tc.floorGradePct / 100) * 400) c = noisy(floorC.clone().lerp(layerCols[m.layerAt(-e)], 0.35), x, z, 0.06);
      else c = noisy(layerCols[m.layerAt(-e)], x, z, 0.09);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      k++;
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [m]);
  return <mesh geometry={geom}><meshStandardMaterial vertexColors roughness={0.95} metalness={0} side={THREE.DoubleSide} /></mesh>;
}

// ---------------------------------------------------------------------------- stratigraphic section faces
function sectionGeometry(m: MineModel, profile: (u: number) => number, u0: number, u1: number, place: (u: number, e: number) => [number, number, number]) {
  const n = Math.ceil((u1 - u0) / 3);
  const pos: number[] = [], col: number[] = [];
  const cols = m.tc.layers.map((l) => new THREE.Color(l.color));
  const push = (u: number, e: number, c: THREE.Color) => { const p = place(u, e); pos.push(...p); const cc = noisy(c, u * 0.7, e * 3, 0.07); col.push(cc.r, cc.g, cc.b); };
  for (let li = 0; li < m.tc.layers.length; li++) {
    const top = -m.layerTops[li];
    const bot = li === m.tc.layers.length - 1 ? m.bottomE : -(m.layerTops[li] + m.tc.layers[li].thicknessM);
    const b = Math.max(bot, m.bottomE);
    if (top <= b) continue;
    for (let i = 0; i < n; i++) {
      const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
      const ta = Math.min(top, profile(ua)), tb = Math.min(top, profile(ub));
      if (ta <= b && tb <= b) continue;
      const c = cols[li];
      push(ua, b, c); push(ua, Math.max(ta, b), c); push(ub, Math.max(tb, b), c);
      push(ua, b, c); push(ub, Math.max(tb, b), c); push(ub, b, c);
    }
  }
  // dump material above ground
  const dc = new THREE.Color('#a8906c');
  for (let i = 0; i < n; i++) {
    const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
    const ta = profile(ua), tb = profile(ub);
    if (ta <= 0.01 && tb <= 0.01) continue;
    push(ua, 0, dc); push(ua, Math.max(0, ta), dc); push(ub, Math.max(0, tb), dc);
    push(ua, 0, dc); push(ub, Math.max(0, tb), dc); push(ub, 0, dc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function Sections({ m }: { m: MineModel }) {
  const VE = m.tc.verticalExaggeration;
  const faces = useMemo(() => {
    const P = (x: number, e: number, z: number): [number, number, number] => [x * S, e * S * VE, z * S];
    return [
      sectionGeometry(m, (x) => m.elevation(x, 0), -m.X, m.X, (x, e) => P(x, e, 0)), // cutaway through the sump
      sectionGeometry(m, (x) => m.elevation(x, -m.Z), -m.X, m.X, (x, e) => P(x, e, -m.Z)),
      sectionGeometry(m, (z) => m.elevation(-m.X, z), -m.Z, 0, (z, e) => P(-m.X, e, z)),
      sectionGeometry(m, (z) => m.elevation(m.X, z), -m.Z, 0, (z, e) => P(m.X, e, z)),
    ];
  }, [m, VE]);
  const bounds = useMemo(() => m.layerTops.slice(1).map((d) => -d).filter((e) => e > m.bottomE), [m]);
  return (
    <group>
      {faces.map((g, i) => <mesh key={i} geometry={g}><meshStandardMaterial vertexColors roughness={1} side={THREE.DoubleSide} /></mesh>)}
      {/* layer contacts on the cutaway face */}
      {bounds.map((e) => {
        const pts: [number, number, number][] = [];
        for (let x = -m.X; x <= m.X; x += 6) { const s = m.elevation(x, 0); if (s > e + 0.2) pts.push([x * S, e * S * VE, 0.02]); else if (pts.length) break; }
        return pts.length > 1 ? <Line key={e} points={pts} color="#3a3128" lineWidth={1} transparent opacity={0.6} /> : null;
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------- water body (exact prismoid, back half + section face)
function halfPrismoid(Lb: number, Wb: number, Lt: number, Wt: number, h: number, segX = 24, segZ = 12) {
  // bottom rectangle [−Lb/2, Lb/2] × [−Wb/2, 0], top [−Lt/2, Lt/2] × [−Wt/2, 0] at height h; top surface subdivided for waves
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const B = [[-Lb / 2, 0, -Wb / 2], [Lb / 2, 0, -Wb / 2], [Lb / 2, 0, 0], [-Lb / 2, 0, 0]];
  const T = [[-Lt / 2, h, -Wt / 2], [Lt / 2, h, -Wt / 2], [Lt / 2, h, 0], [-Lt / 2, h, 0]];
  quad(B[0], B[1], T[1], T[0]); // back wall
  quad(B[1], B[2], T[2], T[1]); // right
  quad(B[3], B[0], T[0], T[3]); // left
  quad(B[0], B[3], B[2], B[1]); // floor
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.computeVertexNormals();
  const section = new THREE.BufferGeometry();
  section.setAttribute('position', new THREE.Float32BufferAttribute([...B[3], ...B[2], ...T[2], ...B[3], ...T[2], ...T[3]], 3));
  section.computeVertexNormals();
  const top = new THREE.PlaneGeometry(Lt, Wt / 2, segX, segZ);
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, -Wt / 4);
  return { side, section, top };
}

function Water({ m, feed }: { m: MineModel; feed: TwinFeed }) {
  const VE = m.tc.verticalExaggeration;
  const h = Math.max(0, feed.levelM);
  const surf = surfaceAt(m.dims, h);
  const key = h.toFixed(3);
  const g = useMemo(() => (h > 0.005 ? halfPrismoid(m.dims.L * S, m.dims.W * S, surf.length * S, surf.width * S, h * S * VE) : null), [key, m]); // eslint-disable-line
  const topRef = useRef<THREE.Mesh>(null);
  const base = useMemo(() => (g ? Float32Array.from(g.top.attributes.position.array as Float32Array) : null), [g]);
  const ripples = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (topRef.current && base) {
      const p = topRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const amp = 0.025 + Math.min(0.08, feed.intensity / 900);
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        p.setY(i, base[i * 3 + 1] + Math.sin(x * 0.9 + t * 1.6) * amp + Math.cos(z * 1.3 + t * 1.1) * amp * 0.7);
      }
      p.needsUpdate = true;
    }
    if (ripples.current) {
      ripples.current.children.forEach((c, i) => {
        const life = (t * 0.9 + i * 0.37) % 1;
        if (life < 0.03) c.position.set((hash(i, Math.floor(t)) - 0.5) * surf.length * S * 0.85, 0.06, -hash(Math.floor(t), i) * surf.width * S * 0.45);
        const sc = 0.2 + life * 1.6;
        c.scale.set(sc, sc, sc);
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = feed.intensity > 0 ? (1 - life) * 0.55 : 0;
      });
    }
  });
  if (!g) return null;
  const y0 = m.sumpFloorE * S * VE;
  const color = feed.overflowing ? '#c0392b' : '#2378c9';
  return (
    <group position={[0, y0, 0]}>
      <mesh geometry={g.side}><meshStandardMaterial color="#1f5f9e" transparent opacity={0.55} roughness={0.3} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={g.section}><meshStandardMaterial color={feed.overflowing ? '#a83224' : '#1b5fa6'} transparent opacity={0.82} roughness={0.2} side={THREE.DoubleSide} /></mesh>
      <mesh ref={topRef} geometry={g.top}><meshStandardMaterial color={color} transparent opacity={0.8} roughness={0.08} metalness={0.25} emissive="#0d3a6e" emissiveIntensity={0.25} side={THREE.DoubleSide} /></mesh>
      <group ref={ripples} position={[0, h * S * VE, 0]}>
        {Array.from({ length: 18 }, (_, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.35, 0.45, 24]} /><meshBasicMaterial color="#e9f4ff" transparent opacity={0} depthWrite={false} /></mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------- level rings + staff gauge
function LevelMarks({ m, feed, labels }: { m: MineModel; feed: TwinFeed; labels: boolean }) {
  const VE = m.tc.verticalExaggeration;
  const y = (lvl: number) => (m.sumpFloorE + lvl) * S * VE;
  const ring = (lvl: number): [number, number, number][] => {
    const s = surfaceAt(m.dims, lvl);
    const L = (s.length / 2) * S, W = (s.width / 2) * S, yy = y(lvl) + 0.03;
    return [[-L, yy, 0], [-L, yy, -W], [L, yy, -W], [L, yy, 0]];
  };
  const marks = [
    { k: 'Warning', lvl: feed.levels.warnM, c: '#e0a800' },
    { k: 'Danger', lvl: feed.levels.dangerM, c: '#f07b1a' },
    { k: 'Critical', lvl: feed.levels.critM, c: '#e5383b' },
    { k: 'Overflow (spill)', lvl: feed.levels.spillM, c: '#8b0000' },
  ];
  const gx = (m.dims.L / 2) * 0.55 * S, gz = -0.6;
  const height = m.sumpDepthM * S * VE;
  return (
    <group>
      {marks.map((mk) => <Line key={mk.k} points={ring(mk.lvl)} color={mk.c} lineWidth={2} dashed={mk.k.startsWith('Overflow')} dashSize={0.6} gapSize={0.35} />)}
      {/* staff gauge */}
      <mesh position={[gx, y(0) + height / 2, gz]}><boxGeometry args={[0.25, height, 0.25]} /><meshStandardMaterial color="#f5f5f0" /></mesh>
      {Array.from({ length: Math.floor(m.sumpDepthM) + 1 }, (_, i) => (
        <mesh key={i} position={[gx + 0.18, y(i), gz]}><boxGeometry args={[i % 5 === 0 ? 0.35 : 0.2, 0.05, 0.05]} /><meshStandardMaterial color="#222" /></mesh>
      ))}
      {marks.map((mk) => <mesh key={'g' + mk.k} position={[gx - 0.16, y(mk.lvl), gz]}><boxGeometry args={[0.12, 0.12, 0.3]} /><meshStandardMaterial color={mk.c} /></mesh>)}
      {labels && marks.map((mk) => (
        <Html key={'l' + mk.k} position={[gx + 0.45, y(mk.lvl), gz]} style={{ pointerEvents: 'none' }}><div className="tag3d" style={{ color: mk.c, fontWeight: 600, padding: '1px 6px' }}>{mk.k} {mk.lvl.toFixed(2)} m</div></Html>
      ))}
      <Html position={[gx - 0.5, y(feed.levelM), gz]} style={{ pointerEvents: 'none', transform: 'translateX(-100%)' }}>
        <div className="tag3d" style={{ background: '#0a7aff', color: '#fff', fontWeight: 700 }}>Water {feed.levelM.toFixed(2)} m</div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------- generic particles along a curve
function Flow({ curve, max, active, speed, color, size }: { curve: THREE.Curve<THREE.Vector3>; max: number; active: number; speed: number; color: string; size: number }) {
  const ref = useRef<THREE.Points>(null);
  const phases = useMemo(() => Float32Array.from({ length: max }, (_, i) => (i * 0.61803) % 1), [max]);
  const positions = useMemo(() => new Float32Array(max * 3), [max]);
  const len = useMemo(() => curve.getLength(), [curve]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const p = ref.current; if (!p) return;
    const n = Math.round(Math.max(0, Math.min(1, active)) * max);
    p.geometry.setDrawRange(0, n);
    if (!n) return;
    const du = (speed * Math.min(dt, 0.1)) / Math.max(1e-3, len);
    for (let i = 0; i < n; i++) { phases[i] = (phases[i] + du) % 1; curve.getPointAt(phases[i], v); positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z; }
    (p.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial color={color} size={size} sizeAttenuation transparent opacity={0.95} depthWrite={false} />
    </points>
  );
}

function groundPath(m: MineModel, pts: [number, number][], lift = 1.2, samples = 60) {
  const VE = m.tc.verticalExaggeration;
  const out: THREE.Vector3[] = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, z0] = pts[s], [x1, z1] = pts[s + 1];
    for (let i = 0; i <= samples; i++) {
      if (s > 0 && i === 0) continue;
      const f = i / samples, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
      out.push(new THREE.Vector3(x * S, (m.elevation(x, z) + lift) * S * VE, z * S));
    }
  }
  return new THREE.CatmullRomCurve3(out);
}

// ---------------------------------------------------------------------------- rain + runoff
function Rain({ m, intensity }: { m: MineModel; intensity: number }) {
  const N = 9000;
  const ref = useRef<THREE.LineSegments>(null);
  const H = 70;
  const pos = useMemo(() => {
    const a = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() * 2 - 1) * m.X * S, z = -Math.random() * m.Z * S, y = Math.random() * H - 10;
      a.set([x, y, z, x + 0.05, y - 0.9, z], i * 6);
    }
    return a;
  }, [m]);
  useFrame((_, dt) => {
    const l = ref.current; if (!l) return;
    const n = intensity <= 0 ? 0 : Math.round(Math.min(1, 0.05 + intensity / 70) * N);
    l.geometry.setDrawRange(0, n * 2);
    const v = (45 + intensity * 0.5) * Math.min(dt, 0.1);
    for (let i = 0; i < n; i++) {
      pos[i * 6 + 1] -= v; pos[i * 6 + 4] -= v;
      if (pos[i * 6 + 1] < -14) { pos[i * 6 + 1] += H; pos[i * 6 + 4] += H; }
    }
    (l.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  return (
    <lineSegments ref={ref} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <lineBasicMaterial color="#6f8fb5" transparent opacity={0.45} />
    </lineSegments>
  );
}

function Runoff({ m, q }: { m: MineModel; q: number }) {
  const curves = useMemo(() => {
    const out: THREE.CatmullRomCurve3[] = [];
    const L = m.pitL / 2 - 5, W = m.pitW / 2 - 5;
    const starts: [number, number][] = [[-L, -W * 0.2], [-L * 0.6, -W], [-L * 0.1, -W], [L * 0.35, -W], [L * 0.8, -W], [L, -W * 0.5], [-L, -W * 0.7], [m.dump.x0 + 20, -W * 0.4]];
    for (const [x, z] of starts) {
      const tx = Math.max(-m.topL / 2, Math.min(m.topL / 2, x * 0.15)), tz = -m.topW / 3;
      out.push(groundPath(m, [[x, z], [x * 0.55, z * 0.55], [tx, tz]], 0.8, 40));
    }
    return out;
  }, [m]);
  const act = Math.min(1, q / 25000);
  return <group>{curves.map((c, i) => <Flow key={i} curve={c} max={110} active={act} speed={14 + Math.min(30, q / 1500)} color="#3d7fd0" size={0.55} />)}</group>;
}

// ---------------------------------------------------------------------------- pumps, suction, discharge pipelines
function DischargeChannel({ m, flowing }: { m: MineModel; flowing: boolean }) {
  const z = -m.Z + 45;
  const curve = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(-m.X * S, 0.25, z * S), new THREE.Vector3(m.X * S, 0.25, z * S)), [m, z]);
  return (
    <group>
      <mesh position={[0, 0.08, z * S]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2 * m.X * S, 2.2]} /><meshStandardMaterial color="#5f9fe0" emissive="#1d5a96" emissiveIntensity={0.2} /></mesh>
      <Flow curve={curve} max={150} active={flowing ? 1 : 0.25} speed={9} color="#1f6fd0" size={0.5} />
      <Html position={[m.X * S * 0.72, 1.6, z * S]} center style={{ pointerEvents: 'none' }}><div className="tag3d">Surface discharge drain → settling pond (conceptual)</div></Html>
    </group>
  );
}

function PumpUnit({ m, p, x, feed, labels, onClick }: { m: MineModel; p: FeedPump; x: number; feed: TwinFeed; labels: boolean; onClick?: (id: string) => void }) {
  const VE = m.tc.verticalExaggeration;
  const z = -m.topW / 2 - 10;
  const eRim = m.elevation(x, z);
  const pos: [number, number, number] = [x * S, eRim * S * VE, z * S];
  const fan = useRef<THREE.Mesh>(null);
  const bodyMat = useRef<THREE.MeshStandardMaterial>(null);
  const pumpedFrac = p.running ? (feed.V > 1 ? 1 : feed.capEff > 0 ? Math.min(1, feed.qIn / feed.capEff) : 0) : 0;
  useFrame((_, dt) => {
    if (fan.current && p.running) fan.current.rotation.y += dt * (4 + p.eff / 150) * Math.max(0.2, pumpedFrac);
    if (bodyMat.current && p.status === 'FAILED') bodyMat.current.emissiveIntensity = 0.45 + 0.45 * Math.sin(performance.now() / 180);
  });
  // suction: from the pump to just below the current water surface (or the floor when dry)
  const lvl = Math.max(0.6, feed.levelM - 0.8);
  const sw = surfaceAt(m.dims, lvl).width;
  const suction = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(x * S, (eRim + 1) * S * VE, z * S),
    new THREE.Vector3(x * S, (m.pitFloorE + 0.5) * S * VE, (-m.topW / 2 + 2) * S),
    new THREE.Vector3(x * S, (m.sumpFloorE + lvl) * S * VE, (-sw / 2 + 6) * S),
  ]), [x, z, eRim, lvl.toFixed(1), m]); // eslint-disable-line
  const discharge = useMemo(() => groundPath(m, [[x, z], [x, -m.pitW / 2 - 15], [x * 0.9 + 30, -m.Z + 45]], 2.0, 50), [m, x, z]);
  const color = !feed.powerOn && p.status === 'ON' ? '#a07c2a' : PUMP_COLOR[p.status] ?? '#888';
  const flowAct = p.running ? Math.max(0.12, Math.min(1, p.eff / 900)) * pumpedFrac : 0;
  return (
    <group>
      <group position={pos} onClick={(e) => { e.stopPropagation(); onClick?.(p.id); }}>
        <mesh position={[0, 0.25, 0]}><boxGeometry args={[3.2, 0.5, 2.2]} /><meshStandardMaterial color="#3e4651" /></mesh>
        <mesh position={[0, 1.15, 0]}><boxGeometry args={[2.2, 1.3, 1.5]} /><meshStandardMaterial ref={bodyMat} color={color} emissive={p.status === 'FAILED' ? '#ff1e1e' : p.running ? '#0d4a24' : '#000'} emissiveIntensity={0.5} roughness={0.5} metalness={0.3} /></mesh>
        <mesh ref={fan} position={[0, 1.95, 0]}><cylinderGeometry args={[0.55, 0.55, 0.18, 8]} /><meshStandardMaterial color={p.running ? '#d8ffe6' : '#666'} /></mesh>
        <mesh position={[0, 2.5, 0]}><sphereGeometry args={[0.2, 10, 10]} /><meshBasicMaterial color={p.running ? '#35e07a' : p.status === 'FAILED' ? '#ff2a2a' : '#9aa3ae'} /></mesh>
        {labels && (
          <Html position={[0, 3.6, 0]} center>
            <div className="tag3d" style={{ pointerEvents: 'auto', cursor: onClick ? 'pointer' : 'default', borderColor: color, color: '#111' }} onClick={() => onClick?.(p.id)}>
              <b style={{ color }}>{p.label}</b> · {p.running ? `${Math.round(p.eff)} m³/hr ▶` : p.status === 'FAILED' ? 'FAILED ✕' : p.status === 'ON' ? 'no power / idle' : p.status.toLowerCase()}
            </div>
          </Html>
        )}
      </group>
      <mesh><tubeGeometry args={[suction, 20, 0.22, 8, false]} /><meshStandardMaterial color="#6b737d" metalness={0.5} roughness={0.4} /></mesh>
      <mesh><tubeGeometry args={[discharge, 120, 0.3, 8, false]} /><meshStandardMaterial color={p.running ? '#8a96a3' : '#5d646c'} metalness={0.5} roughness={0.4} /></mesh>
      <Flow curve={suction} max={20} active={flowAct} speed={6 + p.eff / 200} color="#7cc0ff" size={0.45} />
      <Flow curve={discharge} max={90} active={flowAct} speed={10 + p.eff / 90} color="#1f6fd0" size={0.5} />
    </group>
  );
}

export { Line };
