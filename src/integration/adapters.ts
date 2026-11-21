/**
 * SENSOR INTEGRATION READINESS (read-only ingestion contract).
 *
 * Future adapters (rain gauges, sump level sensors, flow meters, pump run-status contacts,
 * power monitors, PLC/SCADA gateways) implement `SensorAdapter` and push `SensorReading`s.
 * Readings are recorded with source = 'sensor' so the UI can distinguish them from
 * simulated and manually entered values.
 *
 * SAFETY: this contract is deliberately READ-ONLY. There is no write/command method.
 * Physical pump operation must never be triggered from this dashboard without a separately
 * implemented, authenticated and safety-validated control integration.
 */
import type { SumpId } from '../engine/types';

export type SensorKind = 'rainfall' | 'volume' | 'level' | 'flow' | 'groundwater' | 'pumpStatus' | 'power';

export interface SensorReading {
  channelId: string;
  kind: SensorKind;
  sumpId: SumpId | null;
  pumpId?: string;
  value: number;
  unit: string;
  timestampISO: string; // instrument timestamp
  quality: 'good' | 'suspect' | 'bad';
}

export interface SensorAdapter {
  id: string;
  description: string;
  protocol: 'HTTP' | 'MQTT' | 'OPC-UA' | 'Modbus-TCP' | 'File';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Subscribe to readings; returns an unsubscribe function. */
  subscribe(onReading: (r: SensorReading) => void): () => void;
}

export interface ChannelSpec { channel: string; kind: SensorKind; unit: string; feeds: string }

export const PLANNED_CHANNELS: ChannelSpec[] = [
  { channel: 'Automatic rain gauge(s)', kind: 'rainfall', unit: 'mm/hr, mm', feeds: 'Rainfall engine (replaces manual / timeline intensity)' },
  { channel: 'Sump water-level sensors (A–D)', kind: 'level', unit: 'm', feeds: 'Water balance (volume via sump geometry)' },
  { channel: 'Discharge flow meters', kind: 'flow', unit: 'm³/hr', feeds: 'Pump performance / effective capacity calibration' },
  { channel: 'Pump running-status contacts', kind: 'pumpStatus', unit: 'on/off', feeds: 'Pump management (status)' },
  { channel: 'Power monitoring per station', kind: 'power', unit: 'on/off, kW', feeds: 'Power-failure alerts' },
  { channel: 'Groundwater / dewatering meters', kind: 'groundwater', unit: 'm³/hr', feeds: 'Groundwater inflow engine (measured mode)' },
  { channel: 'PLC / SCADA gateway', kind: 'flow', unit: 'various', feeds: 'Bulk read-only tag ingestion' },
];

/** Validates a reading before it is accepted into the store. */
export function validateReading(r: SensorReading): string | null {
  if (!Number.isFinite(r.value)) return 'value must be a finite number';
  if (r.value < 0 && r.kind !== 'pumpStatus') return 'negative values are not physical for this kind';
  if (Number.isNaN(Date.parse(r.timestampISO))) return 'invalid timestamp';
  if (r.quality === 'bad') return 'reading flagged bad quality';
  return null;
}
