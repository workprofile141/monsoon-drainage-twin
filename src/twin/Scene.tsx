/**
 * 3D MINE DRAINAGE DIGITAL TWIN (conceptual layout, not a surveyed model).
 * All dynamic quantities come from the store/engine:
 *  - water body size/height  ← waterVisual(sumpDims, simulated volume)   (geometry, not animation)
 *  - rain density            ← live rainfall intensity
 *  - runoff particle rate    ← calculated runoff per catchment component
 *  - discharge particles     ← each running pump's effective capacity and actual pumped rate
 *  - pump colour / impeller  ← pump status, station power and running state
 */
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store/store';
import type { SumpId, Pump } from '../engine/types';
import { SUMP_IDS } from '../engine/types';
import { sumpDims, type Dims } from '../engine/geometry';
import { waterVisual, markerLevels, SCENE_H_SCALE, SCENE_V_SCALE } from '../engine/visual';
import { effectiveCapacity, isRunning } from '../engine/pumps';
import { levelsFor } from '../engine/prediction';
import { sumpSeverity } from '../engine/alerts';
import { SEV_COLOR } from '../ui/format';

export const CATCHMENT_SCALE = 1 / 60; // conceptual catchment patches: 1 unit = 60 m (NOT the sump scale)
export const RIVER_Z = 2;
const STATUS_COLOR: Record<string, string> = { ON: '#2fae5b', OFF: '#6b7785', STANDBY: '#5d8fd8', MAINTENANCE: '#e8c33a', FAILED: '#e5484d' };

export interface TwinOptions { rain: boolean; labels: boolean; flows: boolean; selected: SumpId | null; onSelect: (id: SumpId | null) => void }

/** Closed/open prismoidal frustum: bottom L×W at y0, top (L+2sh)×(W+2sh) at y0+h (all in scene units). */
function frustum(Lb: number, Wb: number, Lt: number, Wt: number, h: number, withTop: boolean, withBottom: boolean) {
  const b = [[-Lb / 2, 0, -Wb / 2], [Lb / 2, 0, -Wb / 2], [Lb / 2, 0, Wb / 2], [-Lb / 2, 0, Wb / 2]];
  const t = [[-Lt / 2, h, -Wt / 2], [Lt / 2, h, -Wt / 2], [Lt / 2, h, Wt / 2], [-Lt / 2, h, Wt / 2]];
  const v = [...b, ...t];
  const idx: number[] = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(i, j, 4 + j, i, 4 + j, 4 + i); }
  if (withBottom) idx.push(0, 2, 1, 0, 3, 2);
  if (withTop) idx.push(4, 5, 6, 4, 6, 7);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rectLoop(L: number, W: number, y: number): [number, number, number][] {
  return [[-L / 2, y, -W / 2], [L / 2, y, -W / 2], [L / 2, y, W / 2], [-L / 2, y, W / 2], [-L / 2, y, -W / 2]];
}

interface SumpLayout { id: SumpId; x: number; z: number; dims: Dims; topL: number; topW: number; depth: number; north: boolean }

function useLayouts(): SumpLayout[] {
  const config = useStore((s) => s.config);
  return useMemo(() => SUMP_IDS.map((id) => {
    const sc = config.sumps[id];
    const dims = sumpDims(sc);
    const rim = dims.usableDepth + dims.freeboard;
    return {
      id, x: sc.layout.x, z: sc.layout.z, dims,
      topL: (dims.L + 2 * dims.s * rim) * SCENE_H_SCALE, topW: (dims.W + 2 * dims.s * rim) * SCENE_H_SCALE,
      depth: rim * SCENE_V_SCALE, north: sc.layout.z < RIVER_Z,
    };
  }), [config]);
}

// ---------------------------------------------------------------------------
export function TwinScene(o: TwinOptions) {
  const layouts = useLayouts();
  return (
    <>
      <color attach="background" args={['#dde9f7']} />
      <fog attach="fog" args={['#dde9f7', 220, 460]} />
      <ambientLight intensity={1.05} />
      <gridHelper args={[240, 48, '#b9c8b0', '#c6d3bd']} position={[0, 0.01, 0]} />
      <directionalLight position={[60, 120, 40]} intensity={1.1} />
      <hemisphereLight args={['#9fb8d0', '#2b2418', 0.35]} />
      <Ground layouts={layouts} />
      <River />
      {layouts.map((l) => <Catchment key={'c' + l.id} l={l} flows={o.flows} labels={o.labels && o.selected === l.id} />)}
      {layouts.map((l) => <SumpModel key={l.id} l={l} o={o} />)}
      {o.rain && <Rain />}
      <CameraRig layouts={layouts} selected={o.selected} />
    </>
  );
}

function Ground({ layouts }: { layouts: SumpLayout[] }) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-120, -100); shape.lineTo(120, -100); shape.lineTo(120, 100); shape.lineTo(-120, 100); shape.lineTo(-120, -100);
    for (const l of layouts) {
      // ShapeGeometry lies in XY; after rotating −90° about X, shape y maps to world −z
      const h = new THREE.Path();
      const x0 = l.x - l.topL / 2, x1 = l.x + l.topL / 2, y0 = -l.z - l.topW / 2, y1 = -l.z + l.topW / 2;
      h.moveTo(x0, y0); h.lineTo(x0, y1); h.lineTo(x1, y1); h.lineTo(x1, y0); h.lineTo(x0, y0);
      shape.holes.push(h);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [layouts]);
  return <mesh geometry={geom} receiveShadow><meshStandardMaterial color="#d6e2cc" roughness={1} /></mesh>;
}

function River() {
  const curve = useMemo(() => new THREE.LineCurve3(new THREE.Vector3(-110, 0.15, RIVER_Z), new THREE.Vector3(110, 0.15, RIVER_Z)), []);
  return (
    <group>
      <mesh position={[0, 0.06, RIVER_Z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[220, 3]} /><meshStandardMaterial color="#6fb1ec" emissive="#1d5a96" emissiveIntensity={0.25} /></mesh>
      <FlowParticles curve={curve} max={160} active={1} speed={6} color="#1c6fd1" size={0.35} />
      <Html position={[96, 1.5, RIVER_Z]} center><div className="tag3d">Discharge channel → outlet (conceptual)</div></Html>
    </group>
  );
}

function Catchment({ l, flows, labels }: { l: SumpLayout; flows: boolean; labels: boolean }) {
  const sc = useStore((s) => s.config.sumps[l.id]);
  const coeff = useStore((s) => s.config.coefficients);
  const qRunoff = useStore((s) => s.derived.live?.rates[l.id].qRunoff ?? 0);
  const dir = l.north ? -1 : 1;
  const exSide = Math.sqrt(sc.A1) * CATCHMENT_SCALE;
  const rimSide = Math.sqrt(sc.A1 + sc.A3) * CATCHMENT_SCALE;
  const dumpSide = Math.sqrt(sc.A2) * CATCHMENT_SCALE;
  const cz = l.z + dir * (l.topW / 2 + 6 + rimSide / 2);
  const exX = l.x - rimSide / 2 - 1.5, dumpX = l.x + dumpSide / 2 + 1.5;
  const wEx = sc.A1 * coeff.n1 + sc.A3 * coeff.n4, wDump = sc.A2 * coeff.n3;
  const shareEx = wEx / (wEx + wDump || 1);
  const sumpEdge = l.z + dir * (l.topW / 2);
  const chanEx = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(exX + rimSide / 4, 0.2, cz - dir * rimSide / 2), new THREE.Vector3(exX + rimSide / 3, 0.2, (cz + sumpEdge) / 2), new THREE.Vector3(l.x - l.topL / 6, 0.2, sumpEdge)]), [exX, rimSide, cz, dir, sumpEdge, l.x, l.topL]);
  const chanDump = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(dumpX - dumpSide / 4, 0.2, cz - dir * dumpSide / 2), new THREE.Vector3(dumpX - dumpSide / 3, 0.2, (cz + sumpEdge) / 2), new THREE.Vector3(l.x + l.topL / 6, 0.2, sumpEdge)]), [dumpX, dumpSide, cz, dir, sumpEdge, l.x, l.topL]);
  const rateEx = qRunoff * shareEx, rateDump = qRunoff * (1 - shareEx);
  const act = (q: number) => Math.min(1, q / 30000);
  return (
    <group>
      {/* area beyond excavation (rim band) */}
      <mesh position={[exX, 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[rimSide, rimSide]} /><meshStandardMaterial color="#b8c9a3" /></mesh>
      {/* excavation (pit) with benches */}
      <mesh position={[exX, 0.04, cz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[exSide, exSide]} /><meshStandardMaterial color="#8d8f96" /></mesh>
      {[0.8, 0.6, 0.4].map((f) => <Line key={f} points={rectLoop(exSide * f, exSide * f, 0.06).map(([x, y, z]) => [x + exX, y, z + cz] as [number, number, number])} color="#6c6f78" lineWidth={1} />)}
      {/* internal dump / backfill — raised terraces */}
      {[1, 0.75, 0.5].map((f, i) => <mesh key={f} position={[dumpX, 0.4 + i * 0.8, cz]}><boxGeometry args={[dumpSide * f, 0.8, dumpSide * f]} /><meshStandardMaterial color={['#b39a78', '#c2aa88', '#d0ba98'][i]} /></mesh>)}
      {/* drainage channels */}
      <mesh><tubeGeometry args={[chanEx, 24, 0.35, 6, false]} /><meshStandardMaterial color="#5b9bd5" /></mesh>
      <mesh><tubeGeometry args={[chanDump, 24, 0.35, 6, false]} /><meshStandardMaterial color="#5b9bd5" /></mesh>
      {flows && <FlowParticles curve={chanEx} max={120} active={act(rateEx)} speed={4 + Math.min(10, rateEx / 4000)} color="#1f78e0" size={0.45} />}
      {flows && <FlowParticles curve={chanDump} max={120} active={act(rateDump)} speed={4 + Math.min(10, rateDump / 4000)} color="#1f78e0" size={0.45} />}
      {labels && <>
        <Html position={[exX, 1.2, cz]} center><div className="tag3d">Excavation A1 · n1 {coeff.n1}<br />+ beyond A3 · n4 {coeff.n4}</div></Html>
        <Html position={[dumpX, 3.2, cz]} center><div className="tag3d">Internal dump A2 · n3 {coeff.n3}</div></Html>
      </>}
    </group>
  );
}

function SumpModel({ l, o }: { l: SumpLayout; o: TwinOptions }) {
  const V = useStore((s) => s.sim.volumes[l.id]);
  const rates = useStore((s) => s.derived.live?.rates[l.id]);
  const th = useStore((s) => s.thresholds);
  const name = useStore((s) => s.config.sumps[l.id].name);
  const sev = useStore((s) => sumpSeverity(s.derived.alerts, l.id));
  const pumps = useStore((s) => s.pumps.pumps).filter((p) => p.sumpId === l.id);
  const cap = l.dims.capacity;
  const wv = waterVisual(l.dims, V);
  const Lv = markerLevels(l.dims, levelsFor(th, l.id).warnPct, levelsFor(th, l.id).criticalPct);
  const floorY = -l.depth;
  const Lb = l.dims.L * SCENE_H_SCALE, Wb = l.dims.W * SCENE_H_SCALE;
  const pit = useMemo(() => frustum(Lb, Wb, l.topL, l.topW, l.depth, false, true), [Lb, Wb, l.topL, l.topW, l.depth]);
  const waterKey = wv.sceneLevel.toFixed(4);
  const water = useMemo(() => (wv.sceneLevel > 1e-4 ? frustum(Lb, Wb, wv.sceneSurfaceL, wv.sceneSurfaceW, wv.sceneLevel, true, true) : null), [waterKey, Lb, Wb]); // eslint-disable-line
  const selected = o.selected === l.id;
  const overflowing = V >= cap - 1 && (rates?.qNet ?? 0) < 0;
  const surf = (m: number) => ({ L: (l.dims.L + 2 * l.dims.s * m) * SCENE_H_SCALE, W: (l.dims.W + 2 * l.dims.s * m) * SCENE_H_SCALE, y: floorY + m * SCENE_V_SCALE });
  const markers = [
    { m: Lv.warnM, c: SEV_COLOR.warning, t: 'Warning' }, { m: Lv.critM, c: SEV_COLOR.critical, t: 'Critical' },
    { m: Lv.maxM, c: SEV_COLOR.emergency, t: 'Max usable / overflow' }, { m: Lv.rimM, c: '#9aa7b4', t: 'Rim' },
  ];
  return (
    <group position={[l.x, 0, l.z]}>
      <group position={[0, floorY, 0]}>
        <mesh geometry={pit} onClick={(e) => { e.stopPropagation(); o.onSelect(l.id); }}>
          <meshStandardMaterial color={selected ? '#a9bcd2' : '#c2ccd8'} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <lineSegments><edgesGeometry args={[pit]} /><lineBasicMaterial color={selected ? '#0a7aff' : '#7d8aa0'} /></lineSegments>
        {water && <mesh geometry={water} onClick={(e) => { e.stopPropagation(); o.onSelect(l.id); }}>
          <meshStandardMaterial color={overflowing ? '#e5383b' : '#2f8cf0'} transparent opacity={0.7} emissive="#0b3f7a" emissiveIntensity={0.3} roughness={0.2} metalness={0.1} />
        </mesh>}
      </group>
      {markers.map((mk) => { const q = surf(mk.m); return <Line key={mk.t} points={rectLoop(q.L, q.W, q.y)} color={mk.c} lineWidth={1.5} dashed={mk.t === 'Rim'} dashSize={0.5} gapSize={0.3} />; })}
      {/* severity halo on the rim */}
      <Line points={rectLoop(l.topL + 1.2, l.topW + 1.2, 0.08)} color={SEV_COLOR[sev]} lineWidth={sev === 'normal' ? 1.5 : 3.5} />
      {overflowing && o.flows && <OverflowStream l={l} />}
      {pumps.map((p, i) => <PumpUnit key={p.id} p={p} i={i} n={pumps.length} l={l} flows={o.flows} sumpEmpty={V <= 1} rates={rates} showTag={selected} />)}
      {o.labels && !selected && (
        <Html position={[0, 2.6, 0]} center>
          <div className="tag3d" style={{ borderColor: SEV_COLOR[sev], cursor: 'pointer', pointerEvents: 'auto' }} onClick={() => o.onSelect(l.id)}>
            <b>{name}</b><br />
            {Math.round(V).toLocaleString('en-IN')} / {Math.round(cap).toLocaleString('en-IN')} m³ ({(wv.util * 100).toFixed(1)} %)<br />
            Level {wv.levelM.toFixed(2)} m · Qin {Math.round(rates?.qIn ?? 0).toLocaleString('en-IN')} · Qpump {Math.round(rates?.capActiveEff ?? 0).toLocaleString('en-IN')} m³/hr
          </div>
        </Html>
      )}
      {selected && markers.map((mk) => { const q = surf(mk.m); return <Html key={'l' + mk.t} position={[q.L / 2 + 0.3, q.y, 0]}><div className="tag3d" style={{ color: mk.c }}>{mk.t} {mk.m.toFixed(2)} m</div></Html>; })}
      {selected && <Html position={[-wv.sceneSurfaceL / 2 - 0.3, floorY + wv.sceneLevel, 0]} style={{ transform: 'translateX(-100%)' }}><div className="tag3d" style={{ color: '#0a64c8' }}>Water {wv.levelM.toFixed(2)} m</div></Html>}
    </group>
  );
}

function PumpUnit({ p, i, n, l, flows, sumpEmpty, rates, showTag }: { p: Pump; i: number; n: number; l: SumpLayout; flows: boolean; sumpEmpty: boolean; rates?: { qIn: number; capActiveEff: number }; showTag: boolean }) {
  const config = useStore((s) => s.config);
  const pc = useStore((s) => s.pumps);
  const run = useStore((s) => s.sim.pumpRun[p.id]);
  const t = useStore((s) => s.sim.t);
  const running = isRunning(p, pc, config, run, t);
  const eff = effectiveCapacity(p, config).value;
  const towardRiver = l.north ? 1 : -1;
  const px = -l.topL / 2 + ((i + 1) / (n + 1)) * l.topL;
  const pz = towardRiver * (l.topW / 2 + 0.9);
  const imp = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.MeshStandardMaterial>(null);
  // actual discharge share: when the sump is dry, pumps can only remove the inflow
  const actualFrac = !running ? 0 : sumpEmpty && rates && rates.capActiveEff > 0 ? Math.min(1, rates.qIn / rates.capActiveEff) : 1;
  useFrame((_, dt) => {
    if (imp.current && running) imp.current.rotation.y += dt * (2 + eff / 200) * actualFrac;
    if (body.current && p.status === 'FAILED') body.current.emissiveIntensity = 0.5 + 0.5 * Math.sin(performance.now() / 200);
  });
  const worldStart = new THREE.Vector3(l.x + px, 0.9, l.z + pz);
  const riverZ = RIVER_Z - towardRiver * 0.8;
  const pipe = useMemo(() => new THREE.CatmullRomCurve3([
    worldStart.clone(), new THREE.Vector3(l.x + px, 1.6, l.z + pz + towardRiver * 2), new THREE.Vector3(l.x + px * 0.6, 1.2, (l.z + pz + riverZ) / 2), new THREE.Vector3(l.x + px * 0.4, 0.4, riverZ),
  ]), [l.x, l.z, px, pz, riverZ, towardRiver]); // eslint-disable-line
  const color = !pc.power[p.sumpId] && p.status === 'ON' ? '#8a6d2c' : STATUS_COLOR[p.status];
  return (
    <group>
      <group position={[px, 0, pz]}>
        <mesh position={[0, 0.45, 0]}><boxGeometry args={[0.9, 0.9, 0.9]} /><meshStandardMaterial ref={body} color={color} emissive={p.status === 'FAILED' ? '#ff2020' : running ? '#0d3d1f' : '#000'} emissiveIntensity={0.6} /></mesh>
        <mesh ref={imp} position={[0, 1.0, 0]}><cylinderGeometry args={[0.38, 0.38, 0.12, 6]} /><meshStandardMaterial color={running ? '#c9f5d6' : '#556'} /></mesh>
        {/* suction pipe into the sump */}
        <mesh position={[0, -l.depth / 2 + 0.2, -towardRiver * 0.9]}><cylinderGeometry args={[0.08, 0.08, l.depth, 6]} /><meshStandardMaterial color="#8c96a0" /></mesh>
        {showTag && <Html position={[0, 1.6, 0]} center><div className="tag3d" style={{ fontSize: 10, padding: '1px 4px', color }}>{p.tag}{p.status === 'FAILED' ? ' ✖' : running ? ' ▶' : ''}</div></Html>}
      </group>
      <group position={[-l.x, 0, -l.z]}>
        <mesh><tubeGeometry args={[pipe, 20, 0.14, 6, false]} /><meshStandardMaterial color={running ? '#7d8d9c' : '#4a535c'} /></mesh>
        {flows && <FlowParticles curve={pipe} max={40} active={running ? Math.max(0.15, Math.min(1, eff / 1000)) * actualFrac : 0} speed={3 + eff / 250} color="#0a64c8" size={0.32} />}
      </group>
    </group>
  );
}

function OverflowStream({ l }: { l: SumpLayout }) {
  const away = l.north ? 1 : -1;
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(l.topL / 3, 0.2, away * l.topW / 2), new THREE.Vector3(l.topL / 2 + 3, 0.1, away * (l.topW / 2 + 3)), new THREE.Vector3(l.topL / 2 + 6, 0.1, RIVER_Z - l.z),
  ]), [l, away]);
  return <FlowParticles curve={curve} max={80} active={1} speed={8} color="#ff6b6b" size={0.5} />;
}

/** Particles that move along a curve; `active` (0–1) sets how many are shown. */
function FlowParticles({ curve, max, active, speed, color, size }: { curve: THREE.Curve<THREE.Vector3>; max: number; active: number; speed: number; color: string; size: number }) {
  const ref = useRef<THREE.Points>(null);
  const phases = useMemo(() => Float32Array.from({ length: max }, (_, i) => i / max), [max]);
  const positions = useMemo(() => new Float32Array(max * 3), [max]);
  const len = useMemo(() => curve.getLength(), [curve]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const count = Math.round(Math.max(0, Math.min(1, active)) * max);
    pts.geometry.setDrawRange(0, count);
    if (!count) return;
    const du = (speed * Math.min(dt, 0.1)) / Math.max(len, 1e-3);
    for (let i = 0; i < count; i++) {
      phases[i] = (phases[i] + du) % 1;
      curve.getPointAt(phases[i], tmp);
      positions[i * 3] = tmp.x; positions[i * 3 + 1] = tmp.y + 0.15; positions[i * 3 + 2] = tmp.z;
    }
    (pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial color={color} size={size} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

function Rain() {
  const I = useStore((s) => s.derived.live?.intensity ?? 0);
  const N = 6000;
  const ref = useRef<THREE.Points>(null);
  const pos = useMemo(() => { const a = new Float32Array(N * 3); for (let i = 0; i < N; i++) { a[i * 3] = (Math.random() - 0.5) * 220; a[i * 3 + 1] = Math.random() * 60; a[i * 3 + 2] = (Math.random() - 0.5) * 190; } return a; }, []);
  useFrame((_, dt) => {
    const p = ref.current; if (!p) return;
    const count = I <= 0 ? 0 : Math.round(Math.min(1, 0.04 + I / 80) * N);
    p.geometry.setDrawRange(0, count);
    const v = (30 + I * 0.6) * Math.min(dt, 0.1);
    for (let i = 0; i < count; i++) { pos[i * 3 + 1] -= v; if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] += 60; }
    (p.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial color="#5b86b8" size={0.18} transparent opacity={0.6} depthWrite={false} />
    </points>
  );
}

function CameraRig({ layouts, selected }: { layouts: SumpLayout[]; selected: SumpId | null }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    const l = layouts.find((x) => x.id === selected);
    const pos = l ? new THREE.Vector3(l.x + (l.x >= 0 ? 1 : -1) * (l.topL * 0.9 + 10), 9, l.z + (l.north ? -6 : 6)) : new THREE.Vector3(0, 78, 92);
    const target = l ? new THREE.Vector3(l.x, -2.5, l.z) : new THREE.Vector3(0, 0, 4);
    goal.current = { pos, target, t: 0 };
  }, [selected, layouts]);
  useFrame((_, dt) => {
    const g = goal.current; const c = controls.current;
    if (!g || !c) return;
    g.t += dt;
    const k = 1 - Math.pow(0.02, dt);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (g.t > 1.6) goal.current = null; // release to the user
  });
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.1} maxPolarAngle={Math.PI / 2.05} minDistance={6} maxDistance={320} />;
}
