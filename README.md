# Monsoon Drainage Digital Twin

Dynamic monsoon management dashboard with a live 3D mine-drainage digital twin for the four sumps of the
**"Pumping & Sump Capacity Assessment"** (Nilkanth A, Nilkanth B, KNR C, Departmental D).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests incl. mandatory TESTS 1–14
npm run build && npx vite preview --port 4173
npm run e2e        # browser smoke test + TEST 12 (needs preview running)
```

## Architecture

| Module | File |
|---|---|
| Original assessment data (deep-frozen, never written) | `src/engine/original.ts` |
| Engineering configuration / initial records | `src/engine/defaults.ts`, `src/engine/types.ts` |
| Rainfall engine (intensity, depth, forecast, events) | `src/engine/rainfall.ts` |
| Runoff + groundwater engines, design-day requirements | `src/engine/runoff.ts` |
| Pump management engine (efficiency / pump curve, running state) | `src/engine/pumps.ts` |
| Sump water-balance engine (single `advance()` stepper) | `src/engine/balance.ts` |
| Emptying-time prediction (analytic + time-stepped, current vs forecast) | `src/engine/prediction.ts` |
| Pump combination analysis (advisory) | `src/engine/combos.ts` |
| Scenario simulator | `src/engine/scenarios.ts` |
| Alert engine | `src/engine/alerts.ts` |
| Sump geometry, volume ↔ level, 3D mapping | `src/engine/geometry.ts`, `src/engine/visual.ts` |
| Validation (design-day vs source, TESTS 1–14) | `src/engine/validation.ts`, `src/engine/selfTests.ts` |
| Persistent store + simulation clock | `src/store/store.ts` (clock driven from `App.tsx`, above the router) |
| 3D digital twin (React Three Fiber) | `src/twin/Scene.tsx`, `src/pages/Twin.tsx` |
| Reports (PDF via jsPDF, Excel via SheetJS) | `src/reports/` |
| Sensor integration contract (read-only) | `src/integration/adapters.ts` |

Every number on screen, in reports and in the 3D model comes from the same engine functions.
The live simulation, predictions and scenarios all use `advance()`.

## Key engineering decisions / assumptions (all editable)

* Pump ratings are **inferred** (810 m³/hr). Departmental D's two proposed pumps share an *aggregate*
  810 m³/hr balance — placeholder 405 m³/hr each, flagged in the UI.
* Initial pump arrangement = existing + proposed pumps (switchable to existing-only in Pump management).
* Initial stored volume = 0 m³ (no measurement supplied); set per sump or via manual readings.
* Sump geometry is **conceptual**: a prismoidal pit (12 m usable depth, 1 m freeboard, 1:1 slopes) solved so its
  volume at the spill level equals the usable capacity. Enter surveyed dimensions in Configuration.
* Groundwater: either seepage allowance (Qrunoff × 1.10) or measured inflow (Qrunoff + Qgw) — never both.
* Pump curve, when entered, replaces the efficiency factor (no double application).
* Required pumping capacity follows the source: Qtotal ÷ (5 days × 20 h). An efficiency-adjusted rated figure is
  also reported. Internal inconsistencies in the source pumping table are listed on the Validation page, not altered.
* Demo rainfall timeline = the brief's example values plus a 16:00 → 0 mm/hr entry ending the storm.

## Safety

The application is advisory. It has no control path to physical pumps; all values are labelled
*simulated* or *manual* until sensor adapters are implemented (read-only contract in `src/integration`).
