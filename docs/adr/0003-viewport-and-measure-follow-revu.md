# ADR-0003 — `/VP` and `/Measure` follow the decoded Revu 21 fixture, not Appendix A

**Status:** accepted (POC, 2026-09-08)

## Context

PLAN Appendix A sketched the viewport as
`<< /Type /Viewport /BBox … /Name (Redline scale) /Measure 12 0 R >>` with `/Measure`
shared by reference, `/A` as `/F /D /D 100`, and no `/V`. Decoding
`fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf` (Revu 21, August 2026)
showed what Revu actually writes.

## Verified from the fixture

| Item               | Revu writes                                                       | Appendix A said                    |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------- |
| Viewport identity  | `/NM (BUULQOYKDWTRIJOI)`                                          | `/Name (Redline scale)`            |
| `/Measure` sharing | one object per page **and** one per measurement                   | shared ref                         |
| `/X`               | single NumberFormat, `/C 0.05555556` for 0.25 in = 1 ft           | same                               |
| `/D`               | feet `/SS (-)` + inches `/C 12`, both `/F /F /FD true /PS ()`     | same shape                         |
| `/A`               | `/U (sf) /C 1 /D 1 /FD true /SS ()` — no `/F`                     | `/F /D /D 100`                     |
| `/T`               | `/U (\260)` degrees                                               | same                               |
| `/V`               | `/U (cu ft) /C 1 /D 1`                                            | absent                             |
| extra              | `/TargetUnitConversion 0.001157407` (= 1/864, points→feet at 1:1) | absent                             |
| conversions        | 7 significant digits                                              | 7 significant digits               |
| `/R`               | `0.25 in = 1 ft' in"`                                             | `1/8 in = 1 ft' in"`               |
| Line annotation    | `/LL -10 /LLE 2 /Cap true`, no `/CP`                              | `/LL 10 /LLE 2 /Cap true /CP /Top` |
| Line caption       | `/Contents (23'-10")`                                             | `80'-0"` form ✓                    |
| Area caption       | `/Contents (2,169 sf)` — whole sf, thousands grouped              | `72 sf`                            |
| Precision          | `/D 1` (that user's setting)                                      | `/D 16`                            |

Ground truth: the line's 429.0 pt × 0.05555556 = 23.83 ft = `23'-10"`; the polygon's
shoelace area 702 814.9 pt² × 0.05555556² = 2169.18 sf = `2,169 sf`. Both reproduce
exactly with `measure/format.ts` (`test/format.test.ts`).

## Decision

- Write `/VP` viewports with `/NM`, `/BBox` = CropBox, and a **private** `/Measure` object.
  Every measurement annotation also gets its own `/Measure` copy.
- Emit `/A` without `/F` and with `/D 1`, plus `/V` and `/TargetUnitConversion`, so our
  dictionaries are shape-identical to Revu's. `/TargetUnitConversion` is a Bluebeam key,
  not a Redline extension key; it is written for compatibility and documented in
  `docs/extension-keys.md`.
- Round conversion factors to 7 significant digits.
- `/R` uses the decimal page length (`0.125 in = 1 ft' in"`), as Revu does.
- Default precision stays 1/16 (PLAN §3.11); the fixture's `/D 1` is a user setting.
- `/CP /Top` is still written on lines; ASSUMED harmless (Revu omits it, the spec allows it).
- Append to an existing `/VP` array; replace only Redline's own entry on re-calibration.
  ASSUMED: the last matching viewport wins when several cover the same area.

## Needs Aaron

- Interop rows 5–8 on `fixtures/out/spike-0.1-blank-archd.pdf`: does Revu's Measurements
  panel show 1/8" = 1'-0", and does the Markups List show 80'-0" and 600 sf?
- Open `fixtures/out/corpus/D-1 Palazzo CF Slab.moved.pdf` (CAD export with ~286 viewports per
  page, 19,448 in total, all unitless `/R ( )` `/U ( )` at 1:1) — confirm nothing changed in
  Revu's scale. **Aaron 2026-09-08: scale fine; Revu lists no viewports for the CAD entries**
  (same as the untouched original — Redline ignores unitless viewports as page scales).
