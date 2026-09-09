# Extension keys

Redline's own keys are limited to two (CLAUDE.md). Both are written by the Count tool (Phase 2 PR 7); everything else Redline writes is a standard ISO 32000 key.

| Key        | Where      | Type          | Meaning                                           |
| ---------- | ---------- | ------------- | ------------------------------------------------- |
| `/RLTool`  | annotation | string        | id of the tool chest tool that created the markup |
| `/RLAttrs` | annotation | string (JSON) | custom attribute values for formula columns       |

## Values in use

| `/RLTool` | `/RLAttrs`                           | Markup                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `count`   | `{"count":1,"group":"<16 letters>"}` | One count symbol: a `/Circle` with its own `/AP`, `/Subj` = what is counted. Every symbol of one count shares `group`; the total is the number of symbols. Revu/Acrobat see N plain circle markups under the subject (PLAN §7: no Bluebeam-private count intent until verified). |

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
