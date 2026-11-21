export type SumpId = 'A' | 'B' | 'C' | 'D';
export const SUMP_IDS: SumpId[] = ['A', 'B', 'C', 'D'];

/** Provenance of a value — displayed everywhere a value is shown. */
export type Provenance = 'original' | 'inferred' | 'derived' | 'user' | 'simulated' | 'manual' | 'sensor';

// ---------------------------------------------------------------------------
// Engineering configuration
// ---------------------------------------------------------------------------
export interface Coefficients {
  n1: number; // excavation
  n2: number; // external dump
  n3: number; // backfilled / internal dump
  n4: number; // beyond excavation
}

export interface DesignAssumptions {
  rainfallDepthM: number; // design-day rainfall depth (m)
  seepagePct: number; // groundwater seepage allowance (%)
  safetyFactor: number; // sump capacity safety factor
  assessmentDays: number;
  hoursPerDay: number; // scheduled pumping hours per day
  pumpEfficiencyPct: number; // default operating efficiency (%)
  enforceOperatingHours: boolean; // limit each pump to its daily operating hours in the simulation
}

export type GroundwaterMode = 'allowance' | 'measured';

export interface GroundwaterConfig {
  /** allowance: Qin = Qrunoff × (1 + seepage%);  measured: Qin = Qrunoff + Qgw(measured). Never both. */
  mode: GroundwaterMode;
  measuredM3h: Record<SumpId, number>;
  /** Expected (baseline) groundwater inflow used for the "unexpected increase" alert. */
  expectedM3h: Record<SumpId, number>;
}

export type GeometryMode = 'derived' | 'manual';

export interface SumpGeometry {
  /**
   * derived: square-bottomed prismoidal pit whose bottom side is solved so that
   *          volume at max usable level equals the configured existing capacity (CONCEPTUAL).
   * manual:  user-entered (surveyed) dimensions.
   */
  mode: GeometryMode;
  usableDepthM: number; // floor to spill (max usable / overflow) level
  freeboardM: number; // spill level to rim
  sideSlope: number; // horizontal : vertical (m/m)
  aspect: number; // bottom length / bottom width (derived mode)
  bottomLengthM: number; // manual mode
  bottomWidthM: number; // manual mode
}

export interface SumpConfig {
  id: SumpId;
  name: string;
  A1: number; // excavation area m²
  A2: number; // internal dump / backfilled area m²
  A3: number; // area beyond excavation m²
  Aext: number; // external dump area m² (0 = not configured; source gives none)
  existingCapacity: number; // usable storage m³
  initialVolume: number; // initial stored water for a new simulation m³
  geometry: SumpGeometry;
  layout: { x: number; z: number }; // conceptual 3D layout position
}

export interface EngineeringConfig {
  coefficients: Coefficients;
  design: DesignAssumptions;
  groundwater: GroundwaterConfig;
  sumps: Record<SumpId, SumpConfig>;
  referencePumpRating: number; // m³/hr — used to express additional pump requirements
  sim: { dtMinutes: 1 | 5 | 15; predictionHorizonH: number; predictionDtMinutes: 1 | 5 | 15 };
}

// ---------------------------------------------------------------------------
// Pumps
// ---------------------------------------------------------------------------
export type PumpStatus = 'ON' | 'OFF' | 'STANDBY' | 'MAINTENANCE' | 'FAILED';
export const PUMP_STATUSES: PumpStatus[] = ['ON', 'OFF', 'STANDBY', 'MAINTENANCE', 'FAILED'];

export interface CurvePoint { headM: number; flowM3h: number }

export interface Pump {
  id: string;
  tag: string; // e.g. "A1"
  sumpId: SumpId;
  ratedM3h: number;
  efficiencyPct: number | null; // null → use design default
  dischargeHeadM: number;
  curve: CurvePoint[]; // optional manufacturer curve (flow at head); when present it replaces efficiency
  operatingHoursPerDay: number;
  status: PumpStatus;
  origin: 'existing' | 'proposed' | 'user';
  ratingBasis: 'inferred' | 'aggregate-split' | 'user';
  notes: string;
}

export interface PumpConfig {
  pumps: Pump[];
  power: Record<SumpId, boolean>; // power availability at each sump's pump station
}

// ---------------------------------------------------------------------------
// Rainfall
// ---------------------------------------------------------------------------
export interface TimelineEntry { hour: number; intensity: number } // T+hour → mm/hr (piecewise constant)
export interface RainEvent {
  id: string;
  label: string;
  startH: number; // simulation hours
  durationH: number;
  intensity: number; // mm/hr added on top of base rainfall
}

export interface RainfallInputs {
  mode: 'manual' | 'timeline';
  manualIntensity: number; // mm/hr
  manualDurationH: number | null; // null = indefinite
  manualStartH: number; // sim time at which the manual intensity was set
  timeline: TimelineEntry[];
  timelineAfter: 'zero' | 'repeat' | 'hold';
  events: RainEvent[];
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
export interface LevelThresholds { warnPct: number; criticalPct: number; emergencyPct: number }
export interface Thresholds {
  rainfallWarnMmH: number;
  rainfallCriticalMmH: number;
  rainfallEmergencyMmH: number;
  dailyRainLimitMm: number;
  level: LevelThresholds;
  sumpOverrides: Partial<Record<SumpId, LevelThresholds>>;
  overflowLeadH: number; // "approaching overflow" if forecast overflow within this many hours
  groundwaterIncreasePct: number;
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
export interface PumpRunState { dayIndex: number; todayH: number; totalH: number; pumpedM3: number }

export interface SimState {
  t: number; // hours since start
  startISO: string;
  volumes: Record<SumpId, number>;
  cumInflow: Record<SumpId, number>;
  cumPumped: Record<SumpId, number>;
  cumOverflow: Record<SumpId, number>;
  cumRainMm: number;
  pumpRun: Record<string, PumpRunState>;
}

export interface SumpRates {
  intensity: number; // mm/hr
  qRunoff: number; // m³/hr
  qGroundwater: number; // m³/hr (allowance or measured)
  qIn: number; // m³/hr
  capInstalledEff: number; // effective capacity of all serviceable pumps (ON/OFF/STANDBY)
  capActiveEff: number; // effective capacity of pumps actually running now
  capActiveRated: number;
  runningPumpIds: string[];
  qNet: number; // capActiveEff - qIn
  powerOn: boolean;
}

export interface Ctx {
  config: EngineeringConfig;
  pumps: PumpConfig;
  rainfall: RainfallInputs;
}

export type RainFn = (t: number) => number;
