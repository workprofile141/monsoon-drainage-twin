export const fmt0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-IN'));
export const fmt1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const fmt2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} %`);

/** Duration in hours → "5 h 12 min" / "2 d 3 h". */
export function dur(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—';
  if (h <= 0) return 'now';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) { const H = Math.floor(h); const m = Math.round((h - H) * 60); return m === 60 ? `${H + 1} h` : `${H} h ${m} min`; }
  const d = Math.floor(h / 24); return `${d} d ${Math.round(h - d * 24)} h`;
}

export function simClock(startISO: string, t: number): Date { return new Date(new Date(startISO).getTime() + t * 3600_000); }
export function fmtDate(d: Date): string {
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
export const fmtT = (t: number) => { const h = Math.floor(t + 1e-9); const m = Math.round((t - h) * 60); return `T+${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`; };
export const wall = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour12: false });
export const SUMP_COLOR: Record<string, string> = { A: '#2a78d6', B: '#eb6834', C: '#1baf7a', D: '#eda100' };
export const SEV_COLOR: Record<string, string> = { normal: '#2fae5b', warning: '#e8c33a', critical: '#f08a24', emergency: '#e5484d' };
