import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Scatter, BarChart, Bar,
} from 'recharts';

export interface SeriesDef { key: string; name: string; color: string; dashed?: boolean }

const axisStyle = { fontSize: 11, fill: '#6b7587' };
const tipStyle = { background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(60,72,100,0.15)', borderRadius: 12, boxShadow: '0 6px 20px rgba(40,60,110,0.15)', fontSize: 12 };
const fmtNum = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(2)) : String(v));
const fmtTick = (t: number) => `${Math.floor(t)}h`;

export function TimeChart({ data, series, unit, yLabel, area, step, refLines, height = 240, scatter, xKey = 't', xLabel = 'Simulation time (h)', yDomain, filterNegative }: {
  data: Record<string, number>[]; series: SeriesDef[]; unit?: string; yLabel?: string; area?: boolean; step?: boolean;
  refLines?: { y: number; label: string; color?: string }[]; height?: number; xKey?: string; xLabel?: string;
  scatter?: { data: { t: number; v: number }[]; name: string; color: string }; yDomain?: [number | string, number | string]; filterNegative?: boolean;
}) {
  const d = filterNegative ? data.map((p) => { const q = { ...p }; for (const s of series) if (q[s.key] < 0) (q as any)[s.key] = null; return q; }) : data;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={d} margin={{ top: 6, right: 14, bottom: 14, left: 4 }}>
          <CartesianGrid stroke="rgba(60,72,100,0.10)" vertical={false} />
          <XAxis dataKey={xKey} type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick} tick={axisStyle} stroke="rgba(60,72,100,0.25)"
            label={{ value: xLabel, position: 'insideBottom', offset: -6, style: axisStyle }} allowDuplicatedCategory={false} />
          <YAxis tick={axisStyle} stroke="rgba(60,72,100,0.25)" width={62} tickFormatter={fmtNum} domain={yDomain ?? ['auto', 'auto']}
            label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { ...axisStyle, textAnchor: 'middle' } } : undefined} />
          <Tooltip contentStyle={tipStyle} labelFormatter={(t) => `T+${Number(t).toFixed(2)} h`} formatter={(v, n) => [`${fmtNum(v)} ${unit ?? ''}`, n]} />
          {series.length > 1 || scatter ? <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} /> : null}
          {refLines?.map((r) => <ReferenceLine key={r.label} y={r.y} stroke={r.color ?? '#8a94a6'} strokeDasharray="4 4" label={{ value: r.label, fill: '#6b7587', fontSize: 10, position: 'insideTopRight' }} />)}
          {series.map((s) => area
            ? <Area key={s.key} type={step ? 'stepAfter' : 'monotone'} dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.18} strokeWidth={2} dot={false} isAnimationActive={false} />
            : <Line key={s.key} type={step ? 'stepAfter' : 'monotone'} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} strokeDasharray={s.dashed ? '5 4' : undefined} isAnimationActive={false} connectNulls={false} />)}
          {scatter && <Scatter data={scatter.data.map((p) => ({ [xKey]: p.t, sv: p.v }))} dataKey="sv" name={scatter.name} fill={scatter.color} shape="diamond" isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Bars({ data, xKey, series, unit, height = 240, yLabel, layout }: {
  data: Record<string, string | number>[]; xKey: string; series: SeriesDef[]; unit?: string; height?: number; yLabel?: string; layout?: 'horizontal' | 'vertical';
}) {
  const vertical = layout === 'vertical';
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={layout} margin={{ top: 6, right: 14, bottom: 6, left: 4 }} barGap={2}>
          <CartesianGrid stroke="rgba(60,72,100,0.10)" vertical={vertical} horizontal={!vertical} />
          {vertical ? <XAxis type="number" tick={axisStyle} stroke="rgba(60,72,100,0.25)" tickFormatter={fmtNum} /> : <XAxis dataKey={xKey} tick={axisStyle} stroke="rgba(60,72,100,0.25)" />}
          {vertical ? <YAxis type="category" dataKey={xKey} tick={axisStyle} stroke="rgba(60,72,100,0.25)" width={70} /> :
            <YAxis tick={axisStyle} stroke="rgba(60,72,100,0.25)" width={62} tickFormatter={fmtNum} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { ...axisStyle, textAnchor: 'middle' } } : undefined} />}
          <Tooltip contentStyle={tipStyle} cursor={{ fill: 'rgba(60,72,100,0.06)' }} formatter={(v, n) => [`${fmtNum(v)} ${unit ?? ''}`, n]} />
          {series.length > 1 && <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={false} maxBarSize={36} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
