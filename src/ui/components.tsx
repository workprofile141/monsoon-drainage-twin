import { useEffect, useState, type ReactNode } from 'react';
import type { Provenance } from '../engine/types';
import type { Severity } from '../engine/alerts';

const PROV_LABEL: Record<Provenance, string> = {
  original: 'Original', inferred: 'Inferred', derived: 'Derived', user: 'User-set', simulated: 'Simulated', manual: 'Manual', sensor: 'Sensor',
};
const PROV_TIP: Record<Provenance, string> = {
  original: 'Value from the Pumping & Sump Capacity Assessment',
  inferred: 'Inferred from the source tables (not explicitly stated) — editable',
  derived: 'Calculated/derived default — editable',
  user: 'Configured by the user',
  simulated: 'Output of the simulation engine — not a measurement',
  manual: 'Manually entered reading',
  sensor: 'Live sensor data',
};
export function Prov({ p }: { p: Provenance }) {
  return <span className={`prov prov-${p}`} title={PROV_TIP[p]}>{PROV_LABEL[p]}</span>;
}

const SEV_ICON: Record<Severity, string> = { normal: '●', warning: '▲', critical: '◆', emergency: '■' };
const SEV_LABEL: Record<Severity, string> = { normal: 'Normal', warning: 'Warning', critical: 'Critical', emergency: 'Emergency' };
export function SevPill({ s, text }: { s: Severity; text?: string }) {
  return <span className={`pill sev-${s}`}>{SEV_ICON[s]} {text ?? SEV_LABEL[s]}</span>;
}

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {(title || right) && <div className="panel-head"><h2>{title}</h2><div className="row">{right}</div></div>}
      {children}
    </section>
  );
}

export function Kpi({ label, value, unit, sub, prov, className }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; prov?: Provenance; className?: string }) {
  return (
    <div className={`kpi ${className ?? ''}`}>
      <div className="spread"><span className="label">{label}</span>{prov && <Prov p={prov} />}</div>
      <div className="value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Validated numeric input: commits on blur / Enter; rejects non-finite or out-of-range values. */
export function NumInput({ value, onCommit, min, max, step, width, disabled, title }: {
  value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; width?: number; disabled?: boolean; title?: string;
}) {
  const [txt, setTxt] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setTxt(String(roundForDisplay(value))); }, [value, focus]);
  const parsed = Number(txt);
  const valid = txt.trim() !== '' && Number.isFinite(parsed) && (min == null || parsed >= min) && (max == null || parsed <= max);
  const commit = () => { if (valid && parsed !== value) onCommit(parsed); else if (!valid) setTxt(String(roundForDisplay(value))); };
  return (
    <input type="number" className={valid ? '' : 'invalid'} value={txt} step={step ?? 'any'} min={min} max={max} disabled={disabled}
      title={title ?? (min != null || max != null ? `Allowed: ${min ?? '−∞'} … ${max ?? '∞'}` : undefined)}
      style={width ? { width } : undefined}
      onFocus={() => setFocus(true)}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { setFocus(false); commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}
const roundForDisplay = (v: number) => (Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <button key={String(o.v)} className={o.v === value ? 'active' : ''} onClick={() => onChange(o.v)}>{o.l}</button>)}
    </div>
  );
}

export function UtilBar({ pct, warn, crit, color }: { pct: number; warn?: number; crit?: number; color?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="util" aria-label={`Storage utilisation ${p.toFixed(1)} %`}>
      <div style={{ width: `${p}%`, background: color ?? 'var(--accent)' }} />
      {warn != null && <span className="mark" style={{ left: `${warn}%` }} title={`Warning ${warn} %`} />}
      {crit != null && <span className="mark" style={{ left: `${crit}%`, background: 'var(--st-critical)' }} title={`Critical ${crit} %`} />}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return <div className="tabs">{tabs.map((t) => <button key={t.v} className={t.v === value ? 'active' : ''} onClick={() => onChange(t.v)}>{t.l}</button>)}</div>;
}

export function SimLabel() {
  return <span className="prov prov-simulated" title="All live values are produced by the simulation engine; no sensor feed is connected.">Simulated — no live sensors</span>;
}
