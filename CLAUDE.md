# Redline — CLAUDE.md

Redline is a browser-native PDF markup, measurement, and page-tools app for construction offices (estimators, sales, office clerks). It runs entirely client-side and must produce PDFs that open correctly in Bluebeam Revu, Acrobat, Chrome, and Edge, and must round-trip Revu-authored markups without loss. The full plan is `docs/PLAN.md`; read it before starting any task. Deviations from it need an ADR in `docs/adr/`.

## Non-negotiables

1. **One writer.** `@cantoo/pdf-lib` is the only code that produces PDF bytes. pdf.js reads and renders only. Never introduce a second writing engine.
2. **PDF user space everywhere.** Markup geometry is stored in points in the page's coordinate system (respecting `/Rotate` and the CropBox origin). Screen pixels never leave the canvas layer.
3. **Every markup is a standard annotation with an appearance stream.** Always write `/AP /N` (`/BBox` = `/Rect`, `/Matrix` to origin). Regenerate on every edit. No sidecar files, no private formats.
4. **Preserve unknown keys.** Edit dictionaries in place; rewrite only owned keys (list in PLAN §3.4). Never regenerate `/NM`. Never touch `/BSI*`, `/RC`/`/DS` (except to sync with edited `/Contents`), `/IRT`, `/RT`, `/OC`, `/Popup`, `/VP` entries you did not create, catalog `/BSIAnnotColumns`, page `/BSISpaces`, `/Names /JavaScript`.
5. **Incremental saves for markup-only changes.** Full rewrites only for page-structure and compress operations.
6. **`packages/pdf-core` is DOM-free.** It runs in Node under Vitest. No `window`, `document`, or React imports there.
7. **Permissive licenses only.** MIT/Apache-2.0/BSD/ISC. No AGPL/GPL (that excludes MuPDF.js and Ghostscript WASM). CI runs a license audit that fails the build.
8. **Fixtures are read-only.** Never edit files under `fixtures/`. Write outputs to `fixtures/out/` (git-ignored).
9. **Say what you verified versus assumed.** When Revu behavior is uncertain, decode a real fixture instead of guessing, and state it in the PR.

## Stack

Vite + React 19 + TypeScript strict · Tailwind + shadcn/ui (Radix) · Zustand + immer · `pdfjs-dist` 6.x · `@cantoo/pdf-lib` 2.9.x · Konva 10 + react-konva · Dexie · `qpdf-wasm` · zod · Vitest · Playwright · pnpm workspaces.

## Layout

```
apps/web            React shell: canvas, panels, menu bar, context menus, shortcuts
packages/pdf-core   document/, annots/, annots/ap/, measure/, pages/, compress/, stamps/, ids.ts
packages/toolchest  zod schemas, JSON import/export, formula evaluator, .btx importer (later)
fixtures/           Revu-authored, CAD-exported, scanned, broken PDFs (+ out/ for generated)
docs/               PLAN.md, interop-checklist.md, extension-keys.md, adr/
```

## Commands

```
pnpm i                      install
pnpm dev                    run the app
pnpm test                   vitest (pdf-core + toolchest)
pnpm test:e2e               playwright
pnpm test:corpus            round-trip every fixture; asserts only owned keys change
pnpm lint && pnpm typecheck
pnpm license-audit          fails on AGPL/GPL/unknown
pnpm build
```

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, named exports, no `any` in `pdf-core`.
- Tests first for anything in `pdf-core`: every appearance-stream generator has a golden PDF and a PNG snapshot rendered with pdf.js in Node; every dictionary writer has a snapshot of the serialized dictionary.
- Units: internal geometry in points; world units only at the formatting and export boundary. Feet-inches formatting lives in `measure/format.ts` and is the single source of truth (also used to build `/Measure` `/D` arrays).
- IDs: `/NM` = 16 uppercase A–Z letters (`ids.ts`), unique per document; app-level ids are ULIDs.
- Extension keys are limited to `/RLTool` and `/RLAttrs` and documented in `docs/extension-keys.md`. Do not add others without an ADR.
- Undo: every user action is a command with `do`/`undo`; no direct state mutation from UI handlers.
- Performance budgets (checked in e2e): first page visible < 2 s for a local 50 MB file; pan/zoom ≥ 55 fps on a 100-sheet ARCH D set; no canvas larger than 16 Mpx.
- PR size: one bullet of the roadmap per PR. Include: what changed, tests added, which fixtures were round-tripped, and what needs manual Revu verification (list the output files under `fixtures/out/`).

## Definition of done for pdf-core changes

- Unit tests and corpus test pass.
- Output files placed in `fixtures/out/` for the interop checklist (`docs/interop-checklist.md`), and the PR notes which checks Aaron needs to run in Revu/Acrobat/Chrome/Edge.
- No new dependency without license check.
- ADR added or updated if a decision in `docs/PLAN.md` changed.

## Domain vocabulary

- **Markup**: any annotation (Bluebeam's term). **Measurement**: a markup with a `*Dimension` intent and `/Measure`. **Scale**: page-length : world-length (e.g. 1/8 in = 1 ft), stored per page as a `/VP` viewport. **Tool**: a saved preset (properties mode) or saved drawing (drawing mode). **Tool chest**: an ordered set of tools. **Profile**: user defaults, shortcuts, layout, and chest list. **Markups List**: the table of all markups with measurement and custom columns. **Subject**: the `/Subj` label used for grouping and subtotals. **Flatten**: bake markups into page content.
