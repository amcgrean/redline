# Redline — proof-of-concept kickoff

## What the POC has to prove (go / no-go)

The POC exists to test four things, each of which either validates the architecture or points to a contained fix. Nothing else belongs in it.

| #   | Claim under test                                               | Pass looks like                                                                                                                                                                             | If it fails                                                                                             |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | The browser can do the estimator's core loop                   | Drop a plan PDF, calibrate with two clicks, draw a length and an area, see captions, click Save, get a file                                                                                 | UI plumbing; not an architecture problem                                                                |
| 2   | Redline's measurements are real to Revu, Acrobat, Chrome, Edge | Revu's Markups List shows Subject, Length, Area with the right values and the markups are editable there; page scale is recognized; Chrome/Edge/Acrobat display the markups and captions    | Adjust the `/Measure`, `/VP`, or `/AP` writers (PLAN §3.6, Appendix A)                                  |
| 3   | Round-trip is lossless                                         | Open a Revu-marked file, move one markup, save; reopen in Revu with custom columns, spaces, groups, replies, stamp, and scale intact; the automated dictionary diff touches only owned keys | If pdf-lib can't parse a file: add the qpdf-wasm repair pass. If a key was lost: fix the ownership rule |
| 4   | Performance is acceptable on real sets                         | A 100-sheet ARCH D set opens, first page in < 2 s, pans and zooms without jank                                                                                                              | Tiling/worker tuning, or switch page rasterization to the PDFium worker (escape hatch in PLAN §3.2)     |

Four passes means Phases 1–3 proceed on this architecture without revisiting it.

## Before you paste the prompt

1. Create an empty repo (`redline`), copy `CLAUDE.md` to the root and `PLAN.md`, `interop-checklist.md`, and this file into `docs/`.
2. Create `fixtures/` and drop in what you have: two or three Revu-authored PDFs (page scale, a few measurements, a custom column, a space, a group, a reply, a stamp), a couple of CAD-exported plan sets (one large), a scanned set, and the ugliest PDFs your office has ever received. Claude Code cannot make these; you can.
3. Optional: put the source of the existing LiveEdge Takeoff module in `reference/` (git-ignored). Its pdf.js setup and calibration flow are reusable; its Fabric.js layer is not.
4. Open Claude Code in the repo and paste everything below the line.

---

Read `CLAUDE.md`, `docs/PLAN.md`, `docs/interop-checklist.md`, and `docs/POC-KICKOFF.md` before doing anything. This pass is a proof of concept, not Phase 1. Its only job is to prove the architecture in PLAN §3 works end-to-end in a browser and in Bluebeam Revu. Keep it lean: no panels, no tool chest, no menus beyond what the demo needs. Start by writing a short plan of the files you will create and the order, then execute it.

**Build**

1. Scaffold the monorepo per PLAN §3.3: pnpm workspaces, `apps/web` (Vite + React + TypeScript strict), `packages/pdf-core`, Vitest, ESLint/Prettier, and a `license-audit` script that fails on AGPL/GPL/unknown licenses. Skip Playwright, Tailwind/shadcn, Zustand, and Dexie for now; they arrive in Phase 1.

2. `packages/pdf-core` (DOM-free, tested in Node):
   - `openDocument(bytes)` parses every annotation on every page into the PLAN §3.4 `Markup` model, keeping `raw` (the live pdf-lib dictionary).
   - `setPageScale(doc, pageIndex, scale, units)` writes a `/VP` viewport per PLAN §3.6 and Appendix A, appending to any existing `/VP` array.
   - `addLengthMeasurement(...)` writes `/Line` + `/IT /LineDimension`; `addAreaMeasurement(...)` writes `/Polygon` + `/IT /PolygonDimension`. Both carry a complete `/Measure` (`/R`, `/X`, `/D`, `/A`, `/T`; first `/C` converts from points), `/Contents` with the formatted value, `/Cap true`, `/NM` (16 uppercase letters), `/T`, `/M`, `/CreationDate`, `/Subj`, `/F 4`, `/C`, `/CA`, `/BS`, `/LE`, `/LL`, `/LLE`, and a generated `/AP /N` form XObject (`/BBox` = `/Rect`, Helvetica caption, leader lines, arrowheads).
   - `moveMarkup(doc, id, dx, dy)` updates geometry and `/Rect`, regenerates `/AP`, bumps `/M`, and touches nothing else.
   - `saveIncremental(doc)` returns the original bytes plus an appended update section.
   - A feet-inches formatter (`80'-0"`, `16'-1 1/2"`, precision to 1/16) that is the single source for captions and for the `/Measure` `/D` array.
   - Tests: dictionary snapshots for every writer; a rendered PNG snapshot of each `/AP` via pdf.js in Node; a corpus test that, for every PDF in `fixtures/`, opens it, moves one markup by 10 pt, saves, reopens, and asserts that only owned keys changed, that `/BSIColumnData`, `/BSISpaces`, `/BSIAnnotColumns`, `/RC`, `/IRT`, `/OC`, and pre-existing `/VP` entries are byte-identical, and that pdf.js can open the output.

3. `apps/web`: one deliberately plain page.
   - Drop zone and file input. Render pages with pdf.js (`annotationMode: DISABLE`) in a scrollable, zoomable view, tiled so no canvas exceeds 16 Mpx.
   - Draw existing markups from the `Markup` model on a Konva layer in PDF user space. Render `Line`, `PolyLine`, `Polygon`, `Square`, `Circle`, `Ink`, and `FreeText` natively; render anything else through the AP-bitmap fallback in PLAN §3.5, or a labeled placeholder box if that is not done yet.
   - Three buttons: Calibrate (click two points, type a distance, choose ft-in or decimal ft), Length, Area. Selected markups can be dragged.
   - Save downloads the file; use the File System Access API to save in place when the browser supports it.

4. Write outputs for manual checking to `fixtures/out/`: (1) a blank ARCH D sheet with one page scale, one length, and one area; (2) every Revu-authored fixture re-saved after moving one markup; (3) the same files saved from the browser demo.

**Constraints.** Everything in `CLAUDE.md` applies: pdf-lib is the only writer, PDF user space everywhere, always write `/AP`, never regenerate `/NM`, permissive licenses only, `pdf-core` is DOM-free. When Revu behavior is uncertain, decode a fixture and say what you verified versus assumed.

**Fixtures.** If `fixtures/` is missing any category, generate synthetic PDFs with pdf-lib for the unit tests and clearly list which corpus checks are pending real files.

**Done when** `pnpm test` is green, `pnpm dev` runs the demo, `fixtures/out/` is populated, and you have written a summary separating what tests verified from what needs Aaron's check in Revu, Acrobat, Chrome, and Edge per `docs/interop-checklist.md`. Stop there.
