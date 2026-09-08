# POC results — 2026-09-08

Scope: `docs/POC-KICKOFF.md`. Everything below is split into **verified by tests/automation**
and **needs Aaron in Revu / Acrobat / Chrome / Edge** (`docs/interop-checklist.md`).

## Aaron's viewer results (2026-09-08)

| # | Check | Revu 21 | Acrobat | Chrome | Edge |
|---|---|---|---|---|---|
| 1 | Opens without repair prompt | pass (all files) | n/a (no Acrobat Pro) | pass (spike) | pass (spike) |
| 2 | Markups visible at right position/size | pass | n/a | pass (spike) | pass (spike) |
| 3 | Endings, dashes, fill opacity render | pass (arrowheads, slashes, fill) | n/a | not yet checked on browser files | not yet checked |
| 4 | Captions show Redline's value | pass (`80'-0"`, `600 sf`, `94'-3 3/8"`, `30'-6"`) | n/a | not yet checked | not yet checked |
| 5 | Markups List: Subject, Author, Date, Length/Area | pass | — | — | — |
| 6 | Measurements panel scale matches calibration | pass | — | — | — |
| 7 | Acrobat "use scale from document" | — | n/a (needs Acrobat Pro) | — | — |
| 8 | Editable in Revu (vertex moves, value updates) | pass (spike and others) | — | — | — |
| 12 | Print preview shows markups | not yet checked | n/a | not yet checked | not yet checked |
| R5 | Page scale unchanged unless Redline changed it | pass (D-1, D-2 CAD sets) | | | |
| R7 | Edit in Revu → reopen in Redline → nothing lost | **pass** — see R7 result below | | | |

Notes:
- `corpus/Takeoff …moved.pdf`: the 10 pt move (1/7 in on a 36 in sheet) is invisible by eye —
  expected. `corpus/Takeoff …moved-1in.pdf` moves the same "31-Gable SF" (47 sf) polygon on
  page 1 (Front Elevation) by 1 in right and 1 in up for a visible check.
- D-1 / D-2: Revu lists no viewports. The files carry ~286 unitless CAD viewports per page
  (`/R ( )`, `/U ( )`, 1:1). Redline leaves them untouched and, since this pass, no longer reads
  them as a page scale (parser fix + test).
- R7 result (`fixtures/from-revu/file moved.pdf`, Revu's save of `corpus/Takeoff …moved-1in.pdf`
  after Aaron dragged the "40-8\" Lap SF" polygon on page 1): Revu did a **full rewrite**
  (Producer "Bluebeam PDF Library 21", one `%%EOF`). Diff against the file he started from:
  217/217 markups, 0 added, 0 removed, 212 byte-identical; Redline's "31-Gable SF" move kept
  exactly (Aaron also saw it in Revu); the dragged polygon changed `/M`, `/Vertices`, `/Rect`,
  `/RC`; three neighbours differ only by Revu rounding coordinates to 3 decimals (≤ 0.0001 pt).
  Page scales and `/VP` entries unchanged on all 6 pages. Redline then reopened the Revu file and
  passed the corpus round-trip on it (`from-revu/` is now swept by `pnpm test:corpus`; output
  `out/corpus/from-revu_file moved.moved.pdf`).

## Go / no-go status

| #   | Claim                                                       | Status                                                                                                                                                                                            |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Browser core loop (drop → calibrate → length → area → save) | **Done in the demo** on a CAD export and on the Revu takeoff; outputs in `fixtures/out/browser/`                                                                                                  |
| 2   | Measurements are real to Revu/Acrobat/Chrome/Edge           | Dictionaries are shape-identical to Revu's own (decoded, not guessed); pdf.js renders them. **Viewer checks pending (rows 1–8, 12)**                                                              |
| 3   | Lossless round-trip                                         | **Automated pass** on all 6 fixtures + a synthetic Bluebeam-keyed file: only owned keys change, `/RC`, `/IRT`, `/OC`, `/BSI*`, pre-existing `/VP` byte-identical. **PASS**: Revu reopens all moved files (R5), keeps Redline's move on a full rewrite, and Redline round-trips Revu's rewrite (R7). R1–R4, R6 still need a fixture with columns/spaces/groups/stamp |
| 4   | Performance on real sets                                    | Not measured — no 100-sheet set in `fixtures/` (largest is 7 MB, D-1 with 60+ viewports). Tiled rendering and viewport-sized Konva stages are in place; **needs a 100-sheet fixture**             |

## What the tests verified (`pnpm test` — 49 tests, all green; `pnpm test:corpus` — 7/7)

**Formatter (single source for captions and `/D` arrays)** — `test/format.test.ts`

- `80'-0"`, `16'-1 1/2"`, rounding to 1/16 with carry into the next foot, thousands grouping, negatives.
- Reproduces Revu's own captions from Revu's own geometry in the fixture: a 429 pt line at
  0.25 in = 1 ft → `23'-10"`; a 14-vertex polygon → `2,169 sf` (shoelace × (ft/pt)²).

**`/Measure` and `/VP`** — `test/measure.test.ts`, snapshots in `test/__snapshots__/`

- Dictionary shape matches the decoded Revu 21 object byte-for-byte in structure: `/Subtype /RL`,
  single `/X` with 7-significant-digit `/C`, two-element `/D` with `/SS (-)`, `/A` with `/C 1`,
  `/T` degrees, `/V`, `/TargetUnitConversion`. Details and every deviation from PLAN Appendix A
  are in `docs/adr/0003-viewport-and-measure-follow-revu.md`.
- `setPageScale` appends to an existing `/VP` array (the earlier entry serialises identically),
  replaces its own entry on re-calibration, and the scale reads back after an incremental save.

**Writers** — `test/writers.test.ts`

- `addLengthMeasurement` writes every key the kickoff lists (`/IT /LineDimension`, `/L`, `/Rect`,
  own `/Measure` copy, `/Contents`, `/Cap`, `/NM` 16 letters, `/T`, `/M`, `/CreationDate`,
  `/Subj`, `/F 4`, `/C`, `/CA`, `/BS`, `/LE`, `/LL`, `/LLE`, `/AP /N` with `/BBox` = `/Rect`,
  Helvetica font resource). Snapshot: `length-80ft.txt` (PLAN Appendix A's 80'-0" example).
- `addAreaMeasurement` likewise (`/Polygon` + `/IT /PolygonDimension`). Snapshot: `area-600sf.txt`.
- `moveMarkup` changes exactly `AP, L|Vertices|Rect, M, Rect` and nothing else; on a Bluebeam-style
  markup `/RC`, `/DS`, `/BSIColumnData`, `/OC`, `/IRT`, `/RT`, `/GroupNesting`, `/MeasurementTypes`,
  `/NM`, `/CreationDate` are untouched. A move reuses the existing `/Contents` as the caption and
  does not rewrite `/Contents`/`/RC`.
- `saveIncremental` output = original bytes + a plain-object update section (`/Prev`, no
  `/ObjStm`); moving one markup puts exactly that one object in the update.

**Appearance streams rendered by pdf.js in Node** — `test/ap-render.test.ts`, PNGs in `test/__snapshots__/`

- Lengths with ClosedArrow / Slash / OpenArrow+Butt endings, leaders, dashes, opacity; areas with
  translucent fill; a moved measurement; a 1:1 crop proving the Helvetica caption is legible text.

**Corpus round-trip** — `test/corpus.test.ts`, for every PDF in `fixtures/` plus a synthetic file

- Open → move one markup 10 pt → save → reopen: only owned keys changed on the moved annotation,
  every other annotation unchanged, catalog `/BSIAnnotColumns`, page `/BSISpaces`, and every
  pre-existing `/VP` entry identical, pdf.js opens the output with the same page count.
- Outputs: `fixtures/out/corpus/*.moved.pdf`.

**Browser demo (driven in the in-app browser, then re-checked with pdf-core)**

- `16228 Sharon Drive - Urbandale.pdf` (no scale): Calibrate by two clicks + `30'-6"` → 1 in = 4.002 ft
  (≈ 1/4" = 1'-0"), Length `30'-6"`, Area `113 sf`, Save. Reopened file has one `/VP`, two
  annotations, pdf.js sees `Line, Polygon`.
- `Takeoff bluebeam copy …pdf` (217 Revu markups, scale from the document): Length, Area, drag a
  Revu polygon ("152 sf"), Save twice (two stacked incremental updates). The moved Revu polygon
  changed only `AP, M, Rect, Vertices`; `/RC` and `/Contents` preserved; 0 other annotations changed.

## What needs Aaron (interop checklist)

Open each file below in **Revu 21, Acrobat, Chrome, Edge** and fill in the rows.

| File                                                                                                                                                 | Rows                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `fixtures/out/spike-0.1-blank-archd.pdf` — blank ARCH D, 1/8" = 1'-0" (ft-in to 1/16), `80'-0"` length, `600 sf` area, a diagonal with Slash endings | 1, 2, 3, 4, **5, 6, 7, 8**, 12                         |
| `fixtures/out/browser/16228 Sharon Drive - Urbandale.browser.pdf` — calibrated in the browser, one length, one area                                  | 1–8, 12                                                |
| `fixtures/out/browser/Takeoff bluebeam copy … .browser.pdf` — Revu takeoff + browser length/area + one Revu polygon moved, two update sections       | 1–8, **R3 (replies/groups: none in file), R5, R7, R8** |
| `fixtures/out/corpus/Takeoff bluebeam copy … .moved.pdf` — Revu takeoff, one Revu polygon moved by pdf-core                                          | 1, 2, 4, 5, 8, R5, R7                                  |
| `fixtures/out/corpus/D-1 Palazzo CF Slab.moved.pdf`, `D-2 … .moved.pdf` — CAD exports with 60+ embedded viewports, one Square moved                  | 1, 2, **R5** (embedded scale unchanged)                |

The specific questions the tests cannot answer:

1. Does Revu's **Markups List** show Subject / Author / Length / Area for Redline's measurements,
   and are they editable (row 5, 8)? Everything in the dictionary says yes, but only Revu knows.
2. Does Revu's **Measurements panel** show the page scale Redline wrote as `/VP` (row 6)?
   Redline reads its own `/VP` back, and the shape matches Revu's, but row 6 is the real test.
3. Does Acrobat pick up the scale under "Use scale and units from document" (row 7)?
4. Do **Chrome and Edge draw the `/AP`** exactly as pdf.js does (rows 2–4)? pdf.js is Chrome's
   sibling renderer, not Chrome.
5. After editing the moved Revu polygon in Revu and saving, does Redline reopen it cleanly (R7)?

## Verified vs assumed (per CLAUDE.md #9)

Verified by decoding `fixtures/Takeoff bluebeam copy 16228 Sharon Drive - Urbandale.pdf`:
Revu's `/Viewport` (`/NM`, private `/Measure` per page), the full `/Measure` layout, `/Line`
(`/LL -10 /LLE 2 /Cap true /LE [/Slash /Slash]`, no `/CP`), `/Polygon` measurement keys,
caption formats, that every measurement carries its own `/Measure`, that `/Annots` and `/VP`
arrays are indirect objects.

Assumed (no fixture evidence yet):

- `/CP /Top` on lines is harmless (Revu omits it; ISO 32000 allows it).
- The last matching `/VP` entry wins when several cover the same area.
- `/V` and `/TargetUnitConversion` are optional for Revu; we emit them anyway.
- The synthetic Bluebeam file's `/BSIColumnData`, `/BSISpaces`, `/BSIAnnotColumns`, `/IRT`, `/OC`
  are shaped plausibly. **No real fixture contains them.** Corpus checks for custom columns,
  spaces, groups, replies, layers and dynamic stamps are pending real files — please add a Revu
  PDF that has all of them (kickoff step 2).
- Author is written as `Aaron McGrean` (from your email); PLAN examples say "McGrane". Change in
  `apps/web/src/store.ts` if wrong.

## Known gaps (deliberately out of POC scope)

- No undo/command stack, no panels, no tool chest (Phase 1–3).
- `moveMarkup` regenerates the AP for LineDimension/PolygonDimension in Redline's style
  (horizontal caption); a moved Revu measurement therefore changes look. Revu regenerates on
  its own edits anyway. Other subtypes keep their AP (the viewer maps BBox onto the new Rect).
- Bluebeam-only intents (`PolygonCount`, …) pass through and render via the AP-bitmap path.
- Node 20.14 is installed; pdf.js 6 and Vite 7 want Node 22. `packages/pdf-core/test/setup.ts`
  polyfills three APIs; Vite prints a warning but runs. Node 22 removes both.
- `docs/PLAN.md` / `docs/POC-KICKOFF.md` were touched by a Prettier run (table/whitespace only);
  `.prettierignore` now excludes them.
