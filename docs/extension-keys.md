# Extension keys

Redline's own keys are limited to two (CLAUDE.md). Neither is written by the POC yet.

| Key        | Where      | Type          | Meaning                                           |
| ---------- | ---------- | ------------- | ------------------------------------------------- |
| `/RLTool`  | annotation | string        | id of the tool chest tool that created the markup |
| `/RLAttrs` | annotation | string (JSON) | custom attribute values for formula columns       |

## Bluebeam keys Redline writes for compatibility

These are not Redline extensions; they are emitted because Revu writes them and we want our
dictionaries to be shape-identical. Decoded from `fixtures/Takeoff bluebeam copy 16228
Sharon Drive - Urbandale.pdf` (ADR-0003).

| Key                     | Where       | Value                                              |
| ----------------------- | ----------- | -------------------------------------------------- |
| `/TargetUnitConversion` | `/Measure`  | points → target world unit at 1:1 (1/864 for feet) |
| `/NM`                   | `/Viewport` | 16 uppercase letters, like an annotation           |

## Bluebeam keys Redline preserves and never writes

`/BSIColumnData`, `/BSIAnnotColumns`, `/BSISpaces`, `/MeasurementTypes`, `/SlopeType`,
`/PitchRun`, `/RiseDrop`, `/DepthUnit`, `/Depth`, `/Label`, `/Segments`, `/AlignOnSegment`,
`/FillOpacity`, `/BM`, `/GroupNesting`, `/Pattern*`, `/LineStyle*`, `/NumCounts`,
`/CountScale`, `/RC`/`/DS` (rewritten only to mirror an edited `/Contents`).
