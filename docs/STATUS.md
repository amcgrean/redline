# Redline status (2026-09-11)

Live: https://redline-1tr.pages.dev · Repo: https://github.com/amcgrean/redline · CI: GitHub Actions (check + Playwright), auto-deploy to Cloudflare Pages on `main`.

## Where the roadmap stands

| Phase                                      | State                                                                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Spikes / POC                             | Done. Revu shows and edits Redline measurements; page scale round-trips (POC-RESULTS.md).                                                                                                                                   |
| 1 Viewer shell                             | Done. Tabs, recents, thumbnails, rotate, find, text select, print, autosave/recover.                                                                                                                                       |
| 2 Markup engine                            | Done. Length/polylength/area/perimeter/rect-area/count, rectangle/ellipse/line/arrow/polygon/cloud/pen/highlighter, text box/callout/note, select/move/resize/vertex edit, undo/redo, copy/paste/duplicate, lock/hide, z-order, group, snapping. |
| 3 Estimator MVP                            | Done. Calibrate + presets + scope, per-page and per-markup scale, Markups List (sort/filter/subtotals), CSV/XLSX export, tool chest with attributes and formulas (Wall LF: height → SF, studs), profiles.                   |
| 4 Clerk tools                              | Done. Pages panel (rotate/delete/reorder/insert/extract/split, bookmarks carried), stamps (built-in, custom text, PNG/JPEG/SVG/PDF, stamp all pages), flatten, Compress (Optimize via qpdf, Reduce images).                 |
| 5 Sales / review                           | Done except touch/pen and sheet hyperlinks. Review mode + laser, menu bar, PNG export, markups summary PDF.                                                                                                                 |
| 6 Round-trip hardening / Bluebeam import   | Not started. Needs Revu fixtures with counts, custom columns, spaces, layers, stamps (see below).                                                                                                                            |

## What is verified by tests

164 unit tests (pdf-core, toolchest, web) and 53 Playwright tests run on every push. Every appearance-stream writer has a dictionary snapshot and a pdf.js render snapshot; the corpus test round-trips every fixture and asserts only owned keys change.

## What only Aaron can verify (interop checklist rows)

Files are written to `fixtures/out/` by `pnpm fixtures:out`:

| File                                   | Row     | Check in Revu                                                                     |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `spike-0.2-measurements.pdf`           | 5, 8    | Perimeter (closed polyline) and count (plain circles + `/RLAttrs`) are acceptable |
| `pages-0.4-revu-rotated-reordered.pdf` | 11a     | Values unchanged after rotate + reorder; custom columns and spaces intact          |
| `pages-0.4-revu-deleted.pdf`           | 11b     | Page delete leaves no orphan rows                                                  |
| `stamps-0.5-revu.pdf`                  | 9a      | Three stamp kinds appear as Stamp markups; rotation/opacity editable              |
| `compress-0.6-revu-optimized.pdf`      | C1a     | Everything intact after Optimize (28% smaller)                                     |
| Live site on a scanned set             | C2a     | Reduce images at 200 dpi: legible, ≥ 60% smaller                                   |
| Any locked / hidden / grouped markup   | —       | Lock (bit 7), Hidden (bit 2) and `/RT /Group` read the same in Revu                |

## Fixtures still needed

A Revu file with: Bluebeam counts (`PolygonCount`), custom columns with values, spaces, replies, layers, a dynamic stamp; and a 100-sheet ARCH D set for the pan/zoom budget. None of the current fixtures has these, so preservation is proven on a synthetic fixture only.

## Assumptions worth a second look

- Counts are standard circles grouped by `/RLAttrs`; a Bluebeam-native count form waits on a fixture.
- Page operations rewrite the file (incremental history collapses); undo for them is a separate five-deep stack.
- Bookmarks carry titles and page targets only.
- Stamp-all-pages places at a corner in unrotated user space.
- Reduce images is proven on synthetic scans only.
