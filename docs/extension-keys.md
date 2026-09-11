# Extension keys

Redline's own keys are limited to two (CLAUDE.md). Both are written by the Count tool (Phase 2 PR 7); everything else Redline writes is a standard ISO 32000 key.

| Key        | Where      | Type          | Meaning                                           |
| ---------- | ---------- | ------------- | ------------------------------------------------- |
| `/RLTool`  | annotation | string        | id of the tool chest tool that created the markup |
| `/RLAttrs` | annotation | string (JSON) | custom attribute values for formula columns       |

## Values in use

| `/RLTool` | `/RLAttrs`                           | Markup                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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

## Duplicate / paste behaviour (no new keys)

`duplicateMarkup` clones the annotation dictionary under a fresh `/NM`, `/CreationDate`
and `/M`, sets `/P` to the target page, and drops `/Popup`, `/IRT` and `/RT` (a copy is
not a reply or a group member). All other keys, including `/BSI*`, `/RC`, `/DS` and
`/OC`, are copied as-is so a duplicated Revu markup keeps its custom-column data. The
`/AP` form object is shared between the original and the copy until either is edited.

Lock is bit 7 of `/F` (value 128), the standard Locked flag. Locked markups cannot be
moved, edited or deleted in the app. Verified in Revu: not yet (see interop checklist).
