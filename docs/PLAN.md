# Redline — browser-native PDF markup, measurement, and page tools for construction offices

**Build plan v1 · September 8, 2026 · working codename "Redline" (rename any time)**

This is the master plan for Claude Code and Claude Design. It locks the architecture, defines the PDF interoperability rules that make Bluebeam round-trip work, and lays out phased milestones with acceptance criteria and the prompt sequence to drive them. A companion `CLAUDE.md` seeds the repo.

---

## 0. The short version

Build a single-page web app (Vite + React + TypeScript) that opens a PDF entirely in the browser, renders it with pdf.js, draws every markup on a Konva canvas in PDF user-space coordinates, and writes standard ISO 32000 annotation dictionaries with appearance streams through pdf-lib using incremental saves. Measurements are real PDF measurement annotations (`/IT` + `/Measure`) with a page-level `/VP` viewport for scale, which is exactly what Bluebeam Revu and Acrobat read. Unknown keys in existing files are preserved byte-for-byte so a Revu-marked drawing survives an edit in Redline and vice versa. Profiles and tool chests live in IndexedDB as JSON and export as files; cloud sync is a later layer behind an interface. Estimators get the first usable build; clerks (merge, pages, stamps, compress) and sales (review markup) follow on the same engine. Permissive licenses only, so the product can leave Beisser without a rewrite.

## 1. Decisions locked

| Decision      | Choice                       | Consequence                                                                                                                                                                   |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience      | Beisser first, product later | Standalone repo, no LiveEdge coupling, MIT/Apache/BSD dependencies only, multi-tenant-ready data shapes even though v1 is single-user                                         |
| Storage       | Local-first, no accounts     | Everything runs client-side; profiles/tool chests in IndexedDB + JSON export/import; static hosting; `ProfileStore` interface so a Supabase implementation can drop in later  |
| Bluebeam      | Full round-trip              | Must load, edit, and re-save Revu-authored markups, scale, custom columns, groups, and stamps without loss — this drives the "one writer, preserve unknown keys" architecture |
| First persona | Estimators                   | Phase 3 (calibrate, measure, tool chest, markups list export) is the first pilot; it also forces the annotation and scale foundation everything else uses                     |

## 2. Personas and what "usable" means

| Persona      | Daily job in Redline                                                                   | v1 must-haves                                                                                                                                                                                                  | The "dead simple" test                                                    |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Estimator    | Open plan set, set scale, run lengths/areas/counts with saved tools, export quantities | Calibrate + presets, length/polylength/area/perimeter/count, captions, tool chest with attributes and formulas, markups list with subtotals, CSV/XLSX export, save that opens in Revu with measurements intact | Open a sheet and get a wall LF total in under 60 seconds with no training |
| Sales        | Mark up plans and review with a customer, send a clean copy                            | Clean shapes/text/callouts/clouds/highlights, review mode that hides chrome, export flattened PDF or PNG, markup summary                                                                                       | A customer can watch over a shoulder and follow what is happening         |
| Office clerk | Stamp, note, merge, reorder/rotate/delete pages, compress, send                        | Stamp library with dynamic date/user/status, drag-drop merge of many files, pages panel with drag reorder, rotate, delete, insert, extract, split, compress with predictable results, flatten                  | Every one of these is at most one menu click or one right-click away      |

## 3. Architecture

### 3.1 Principles (non-negotiable)

1. **One writer.** pdf-lib (the `@cantoo/pdf-lib` fork) is the only code that produces PDF bytes. pdf.js only reads and renders. No second engine ever writes a document.
2. **PDF user space is the coordinate system everywhere.** Markup geometry is stored in points with the page's origin and rotation; the canvas applies a transform. Never store screen pixels.
3. **Every markup is a standard PDF annotation with an appearance stream.** No private formats, no sidecar files. If Chrome, Acrobat, and Revu cannot all display it, it is not done.
4. **Preserve what you don't understand.** Annotation dictionaries are edited in place; only keys Redline owns are rewritten; everything else (Bluebeam's `/BSI*` keys, `/RC`, `/DS`, replies, layers) is carried through untouched. `/NM` is never regenerated.
5. **Incremental saves by default.** Editing markups appends an update section rather than rewriting the file. Full rewrites happen only for compress/optimize and page-structure changes where a rewrite is cheaper and safer.
6. **Core logic is DOM-free.** `packages/pdf-core` runs in Node under Vitest with golden-file tests. The React app is a thin shell over it.
7. **Dead simple wins ties.** When two designs are close, the one with fewer visible controls ships.

### 3.2 Stack

| Layer                   | Choice                                                                                                                                           | License    | Why                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell               | Vite (current major) + React 19 + TypeScript (strict)                                                                                            | MIT        | A static SPA needs no server; Next.js buys nothing here and complicates static/on-prem hosting                                                                 |
| UI kit                  | Tailwind + shadcn/ui (Radix Menubar, ContextMenu, Dialog, Popover, Command)                                                                      | MIT        | Same toolkit as LiveEdge; Radix gives accessible menu bar and right-click menus for free                                                                       |
| State                   | Zustand + immer, with a command/undo stack                                                                                                       | MIT        | Small, fast, easy to serialize the editor state for autosave                                                                                                   |
| Rendering               | `pdfjs-dist` 6.x (6.3.x current, Apache-2.0, monthly releases)                                                                                   | Apache-2.0 | Most battle-tested renderer; worker-based; text layer for search/select; can render individual appearance streams                                              |
| Document model + writer | `@cantoo/pdf-lib` 2.9.x (MIT, active; original `pdf-lib` is frozen at 1.17.1 since 2021)                                                         | MIT        | Raw dictionary access, form XObjects for `/AP`, `copyPages`/`removePage`/`setRotation`, `embedJpg`/`embedPng`, encrypted-PDF loading, and **incremental save** |
| Markup canvas           | Konva 10 + react-konva                                                                                                                           | MIT        | One interactive layer per visible page; culling, caching, and `listening(false)` for large sheets; proven over pdf.js (InkLayer uses the same pattern)         |
| Persistence             | Dexie (IndexedDB) for profiles, tool chests, recents, autosave; OPFS for working copies of large files                                           | Apache-2.0 | Works in Chrome, Edge, Firefox, Safari                                                                                                                         |
| Compression             | `qpdf-wasm` (Apache-2.0, qpdf 12.x) for lossless optimize + repair; own image-downsample pass (pdf.js decode → canvas → JPEG → pdf-lib re-embed) | Apache-2.0 | Only permissive path that actually shrinks scans; Ghostscript and MuPDF are AGPL                                                                               |
| File I/O                | File System Access API (Chrome/Edge) behind a `FileTarget` interface with download fallback                                                      | —          | Real "Save" in place on Beisser PCs; still works elsewhere                                                                                                     |
| Validation              | zod schemas for tool chest, profile, and extension keys                                                                                          | MIT        | Import/export safety                                                                                                                                           |
| Tests                   | Vitest (core, golden PDFs), Playwright (UI), fixture corpus                                                                                      | MIT        | Round-trip regressions are the main risk                                                                                                                       |
| Errors                  | Sentry (optional, off by default in v1)                                                                                                          | —          | Opt-in only                                                                                                                                                    |

**Deliberately not used:** MuPDF.js (AGPL-3.0; most complete API but needs an Artifex license to commercialize), Ghostscript WASM (AGPL), pdf.js's built-in AnnotationEditor (only FreeText/Ink/Highlight/Stamp; cannot create Line/Polygon/measurement annotations), EmbedPDF as the application framework (PDFium fork, MIT/Apache-2.0, ships 14 shape tools but no measurement support and no control over dictionaries; keep as an escape hatch for rendering performance or as an image decoder), Fabric.js (fine, but Konva's layer/culling model fits tiled pages better).

### 3.3 Repository layout

```
redline/
  apps/web/                     # Vite React app (shell, panels, canvas, menus, shortcuts)
  packages/pdf-core/            # DOM-free engine — everything below is unit-tested in Node
    src/document/               # open, repair (qpdf), incremental save, full save, page tree
    src/annots/                 # Markup model, parse <-> serialize, ownership rules
    src/annots/ap/              # appearance-stream generators per subtype (line, poly, cloud, text, stamp…)
    src/measure/                # scale model, units, feet-inches formatting, geometry, /Measure + /VP builders
    src/pages/                  # merge, reorder, rotate, delete, insert, extract, split, flatten
    src/compress/               # lossless (qpdf) + image downsample pipeline
    src/stamps/                 # stamp library, dynamic fields, PDF-as-stamp import
    src/ids.ts                  # /NM generator (16 uppercase letters), ulid for app ids
  packages/toolchest/           # zod schemas, JSON import/export, formulas, .btx importer (Phase 6)
  fixtures/                     # Revu-authored, CAD-exported, scanned, and synthetic PDFs (never hand-edited)
  docs/adr/                     # one Architecture Decision Record per decision in this plan
  docs/interop-checklist.md     # manual Revu/Acrobat/Chrome/Edge verification protocol
```

### 3.4 The markup model

```ts
interface Markup {
  id: string; // === /NM. 16 uppercase letters. Assigned once, never regenerated.
  pageIndex: number;
  subtype:
    | 'Line'
    | 'PolyLine'
    | 'Polygon'
    | 'Square'
    | 'Circle'
    | 'Ink'
    | 'FreeText'
    | 'Highlight'
    | 'Underline'
    | 'StrikeOut'
    | 'Text'
    | 'Stamp'
    | 'Unknown';
  intent?:
    | 'LineDimension'
    | 'LineArrow'
    | 'PolyLineDimension'
    | 'PolygonDimension'
    | 'PolygonCloud'
    | 'FreeTextCallout'
    | 'FreeTextTypewriter'
    | string; // Bluebeam-only intents pass through as strings
  geometry: Geometry; // PDF user space (points). Line: [x1,y1,x2,y2]; Poly: vertices; Rect: bbox; Ink: paths; Callout: line + box
  style: {
    stroke?: RGB;
    fill?: RGB;
    opacity: number;
    fillOpacity?: number;
    width: number;
    dash?: number[];
    lineEnds?: [LineEnding, LineEnding];
    cloud?: { intensity: number };
    hatch?: HatchRef;
    font?: { family: string; size: number; color: RGB; align: 'left' | 'center' | 'right' };
  };
  text?: {
    contents: string;
    subject: string;
    author: string;
    created: Date;
    modified: Date;
    richText?: string;
  };
  measure?: {
    // present when intent is a *Dimension intent
    scale: Scale;
    units: UnitFormat;
    caption: boolean;
    captionPosition: 'top' | 'inline';
    computed: { length?: number; area?: number; perimeter?: number; count?: number }; // world units
  };
  attrs?: Record<string, string | number | boolean>; // custom columns (tool attributes + formulas)
  relations?: { groupParent?: string; replyTo?: string; layer?: string };
  flags: { locked: boolean; hidden: boolean; print: boolean };
  raw: PDFDict; // the live dictionary from pdf-lib. Unknown keys live here and are written back verbatim.
  render: 'native' | 'ap-bitmap'; // Unknown subtypes and exotic stamps render their /AP as a bitmap
}
```

**Ownership rule.** On save, Redline rewrites only: `/Rect`, geometry keys (`/L`, `/Vertices`, `/QuadPoints`, `/InkList`, `/CL`), `/C`, `/IC`, `/CA`, `/BS`, `/BE`, `/LE`, `/LL`, `/LLE`, `/Cap`, `/CP`, `/Contents`, `/Subj`, `/T`, `/M`, `/F`, `/DA`, `/DS`, `/RC` (kept in sync with `/Contents`), `/IT`, `/Measure`, `/AP`, `/Popup`, and its own `/RL*` extension keys. Everything else is untouched. New markups get `/NM`, `/CreationDate`, `/T`, `/M`, `/Subj`, `/F 4`, `/P`.

**Extension keys (kept tiny).** `/RLTool` (tool id string), `/RLAttrs` (JSON string of custom attributes). Documented in `docs/extension-keys.md`. Everything a viewer needs to display or measure is in standard keys; the extension keys only restore tool linkage and attributes.

### 3.5 Rendering and coordinates

- pdf.js renders each page with `annotationMode: DISABLE`. Redline draws all markups itself so the view is consistent with what will be saved.
- Tiled rendering at the current zoom; never one giant canvas. Safari caps canvas area at 16.7 Mpx and an ARCH E sheet at 150 dpi is ~39 Mpx. Render tiles in the pdf.js worker; cache two zoom levels; lazy text layer per page.
- Konva stage: one `Layer` per visible page, `transform = zoom × pageMatrix` where `pageMatrix` folds in `/Rotate`, the CropBox origin, and the y-flip. Hit testing, handles, and snapping all happen in user space.
- Snapping: endpoints, midpoints, orthogonal lock with Shift, 45° increments, and (Phase 6) vector snapping to page line-art extracted from the content stream.
- **AP fallback rendering.** For annotation subtypes Redline does not model natively (odd stamps, rich-text FreeText, file attachments): wrap the annotation's `/AP /N` XObject in a temporary one-page PDF via pdf-lib, render it with pdf.js, and draw the bitmap in the Konva layer. The markup stays selectable, movable, and deletable, and its dictionary is preserved.

### 3.6 Interoperability spec (the part that makes Bluebeam round-trip work)

These rules come from the PDF spec, decoded Revu tool sets and stamps, PDFium source, and Bluebeam support docs. Treat them as requirements, not suggestions.

**Appearance streams**

- Chrome's PDFium only synthesizes appearances for Square, Circle, Ink, Highlight, Underline, StrikeOut, Squiggly, Text, Popup (and FreeText recently). A `/Line`, `/Polygon`, `/PolyLine`, or `/Stamp` without `/AP` renders _nothing_ in Chrome. Edge now uses Adobe's engine and behaves like Acrobat. Revu tolerates missing `/AP` for markups it recognizes and regenerates them on edit.
- Therefore: **always write `/AP /N`** as a form XObject with `/BBox` equal to `/Rect`, `/Matrix` translating to the origin, `/Resources` with `/ProcSet [/PDF /Text]` and the caption font. Regenerate on every edit. Captions and leader lines are drawn inside the AP for measurements.
- Fonts: use the standard 14 Helvetica for captions and text (no embedding needed, universally rendered). Custom fonts are a later feature.

**Measurements**

- A shape becomes a measurement with `/IT` (`LineDimension`, `PolyLineDimension`, `PolygonDimension`) plus a complete `/Measure` dictionary (`/Type /Measure /Subtype /RL`, `/R` scale string, and `/X`, `/D`, `/A`, `/T` NumberFormat arrays). The first NumberFormat's `/C` converts from default user space **points**; subsequent elements convert from the previous unit. Geometry lives in `/L` (line) or `/Vertices` (poly). Without `/IT`, Revu shows no length in the Markups List.
- Write `/Contents` with the formatted value (e.g. `16'-1 1/2"`) and `/Cap true` so Acrobat and other tools show it; Revu recomputes from geometry × Measure. Copy the page's Measure into every measurement annotation, exactly as Revu does.
- Feet-inches is a two-element `/D` array: feet with `/SS (-)` then inches with `/C 12` and `/U (")`, `/F /F` fractions with `/D 16` (or the user's precision), `/FD true`.
- Bluebeam's `/Measure` may carry `/V` (volume) — preserve it. Bluebeam-only intents (`PolygonCount`, `CircleDimension`, `PolygonVolume`, `PolyLineAngle`, `PolygonRadius`) and keys (`/MeasurementTypes`, `/NumCounts`, `/CountScale`, `/Depth`, `/DepthUnit`, `/RiseDrop`, `/SlopeType`, `/PitchRun`) are read and displayed in Phase 6; until then they pass through untouched.

**Page scale**

- Write the calibrated scale as a page-level viewport: `/VP [ << /Type /Viewport /BBox <page box> /Name (Redline scale) /Measure <ref> >> ]`. Append to an existing `/VP` array; never replace it. Acrobat reads this under "Use scale and units from document"; Revu reads it as the page scale. (Spike 0.2 verifies byte-level agreement against a Revu 21-authored sample.)

**Identity and metadata**

- `/NM`: 16 uppercase letters, unique per document, assigned at creation, never changed (Revu, Studio, custom-column data, and reply chains key off it).
- Always write `/T` (author from profile), `/CreationDate`, `/M`, `/Subj` (the Markups List "Subject"), `/F 4`, `/C`, `/IC`, `/CA`, `/BS`.
- Preserve verbatim: `/BSIColumnData` (per-annotation custom column values, positional), catalog `/BSIAnnotColumns` (column definitions), page `/BSISpaces`, `/RC` and `/DS` (rich text and CSS font), `/FillOpacity`, `/Pattern*`, `/LineStyle*`, `/GroupNesting`, `/OC` (layers), `/RT`/`/IRT` (groups use `/RT /Group`, replies `/RT /R`), `/Popup`, `/Names /JavaScript`, OCProperties. If Redline edits `/Contents` on a markup that has `/RC`, it rewrites `/RC` to match.

**Stamps**

- `/Subtype /Stamp` with a distinctive `/Name`, `/Subj (Stamp)`, and a self-contained `/AP` (vector or image). Revu treats it as a stamp markup with editable color/opacity/rotation. Redline's stamp library stores stamps as one-page PDFs (the same convention Revu uses) or PNG/SVG; dynamic fields (date, user, status, custom text) are baked into the AP at placement time.

**Saving**

- Markup-only and scale changes: incremental update (`saveIncremental`) appended to the original bytes. Page-structure changes (merge, reorder, delete, rotate): full save through pdf-lib. Compress: full rewrite through the compression pipeline, then qpdf. Header `%PDF-1.7`.
- Never rewrite `/M` on markups the user did not touch.

**Verification matrix (runs at the end of every phase).** Open the same fixture set in Revu 21, Acrobat, Chrome, and Edge. Check: markups visible, measurements listed with correct Length/Area/Subject in Revu's Markups List, Revu can edit them, edit in Revu → reopen in Redline → nothing lost, custom columns and spaces intact, stamps still stamps. The checklist lives in `docs/interop-checklist.md` and is a required PR gate for `pdf-core` changes.

### 3.7 Measurement engine

```ts
interface Scale {
  pageLength: number;
  pageUnit: 'in' | 'mm';
  worldLength: number;
  worldUnit: 'ft' | 'in' | 'm' | 'mm' | 'cm' | 'yd';
}
interface UnitFormat {
  display: 'ft-in' | 'decimal-ft' | 'in' | 'm' | 'mm' | 'cm';
  precision: 1 | 2 | 4 | 8 | 16 | 32 | 64 /* fraction denominator */ | number /* decimals */;
}
```

- **Calibrate:** click two points, type the known distance, done. Also: pick from presets (1/16, 3/32, 1/8, 3/16, 1/4, 3/8, 1/2, 3/4, 1 in = 1 ft; 1:20 … 1:500), type a ratio, or accept an embedded viewport scale if the PDF has one (CAD exports often do; show it as "Document scale").
- **Scope:** per page by default with "Apply to all pages" and "Apply to pages like this one" (same size and orientation). Per-region viewports (details on a sheet at a different scale) are Phase 6.
- **Types v1:** length, polylength, area (with perimeter), perimeter, count, rectangle area. **Later:** diameter/radius, angle, volume (area × depth attribute), slope/pitch.
- **Math:** all in user space then × scale; area by shoelace on the polygon in world units; feet-inches formatter with fraction reduction and the `/D` array mirrored into `/Measure`.
- **Captions:** measurement value, optional subject, position top/inline, follow Bluebeam's `/Cap`, `/CP`, `/LL`, `/LLE` for lines.
- **"Sizing capabilities" (the wall-LF-run request):** a tool carries **attributes** (e.g. Wall Height 9 ft, Stud Spacing 16 in, Layers 2) and **formulas** (`wallArea = length * height`, `studs = ceil(length * 12 / studSpacing) + 1`). Attributes are editable per markup in the Properties panel; formulas appear as columns in the Markups List with subtotals per subject. This mirrors Bluebeam custom columns and exports to CSV/XLSX so it feeds LiveEdge Estimating later. Formula evaluation is a tiny safe expression evaluator (numbers, + − × ÷, `ceil/floor/round/min/max`, attribute names), not `eval`.

### 3.8 Tool chest and profiles

- **Tool** = a named, iconed preset: kind (length, area, count, rect, text, stamp, …), style, measure settings, attributes, formulas, hotkey, and mode. **Properties mode** draws a new markup with those properties; **Drawing mode** places a fixed drawing (a saved symbol or grouped markup), matching Bluebeam's two modes.
- **Tool chest** = an ordered set of tools with a name, owner, optional default scale, and version. Any selected markup can become a tool via right-click "Add to Tool Chest".
- **Quick slots:** keys `1`–`9` fire the first nine tools of the active chest.
- **Profile** = author name, default units/precision/scale presets, default styles per kind, shortcut map (including a "Bluebeam-style" preset), panel layout, theme, and the list of chests.
- **Storage:** Dexie tables `profiles`, `toolchests`, `stamps`, `recents`, `autosave`. `ProfileStore` interface with `LocalProfileStore` now and `CloudProfileStore` (Supabase) later.
- **Files:** `*.toolchest.json` and `*.profile.json` (zod-validated, versioned, forward-compatible). Share via email or a network drive today; company-shared chests come with cloud sync. `.btx` import (Bluebeam tool sets are XML with zlib-compressed PDF dictionaries) is a Phase 6 stretch; `.btx` export is low value.
- Schemas are in Appendix C.

### 3.9 Page tools (clerk)

- **Pages panel:** thumbnails, multi-select, drag to reorder, rotate 90/180/270, delete, insert blank or from another PDF, extract selection to a new file, split by page ranges or every N pages, "move to first/last".
- **Merge:** drop several files (or select in the open dialog) → an ordering list with per-file page ranges → one merged PDF. The outline (bookmarks) is rebuilt with one top-level entry per source file (pdf-lib's `copyPages` does not carry outlines, so this is explicit work).
- **Stamps:** library panel (built-in Approved/Received/Draft/Reviewed/Void + user stamps from PDF/PNG/SVG), dynamic fields (date, time, user, custom text, status pick-list) filled in a small dialog at placement, recent stamps, "stamp all pages".
- **Flatten:** bake selected or all markups into page content (with the same AP), keep a copy of the unflattened file offered by default.
- **Compress:** two modes with predictable results. _Optimize_ (lossless via qpdf: object streams, flate level 9, unreferenced objects dropped) typically saves 10–30% on vector plan sets. _Reduce images_ (downsample images to 150/200/300 dpi and re-encode JPEG at chosen quality, then optimize) typically saves 60–85% on scanned sets. Show before/after size and a preview before writing. Vector content and text are never rasterized in either mode.

### 3.10 Sales / review

- Polished markup tools: rectangle, ellipse, line, arrow, polyline, polygon, cloud, pen, highlighter, text box, callout, sticky note, highlight-text.
- **Review mode** (Ctrl+Shift+F): hides panels and menus, leaves a floating minimal toolbar; laser-pointer cursor; page navigation.
- Export: flattened PDF copy, current view as PNG, markups summary (a PDF or CSV listing markups with page thumbnails) for sending to a customer.
- Later: touch and Apple Pencil on iPad Safari (no File System Access API there; use share-sheet download).

### 3.11 UI spec

**Layout.** Menu bar across the top (File, Edit, View, Markup, Measure, Document, Tools, Help). Under it, one contextual toolbar that changes with the active tool (style, units, caption options). Left: a slim tool rail with the eight most-used tools and the quick-slot chest. Center: the canvas with a page indicator and zoom control in the bottom corner. Right: a tabbed panel — Tool Chest, Markups List, Pages, Properties — collapsible to icons. Status bar: scale for the current page (click to calibrate), cursor coordinates in world units when a measure tool is active, file size, save state.

**Right-click.** Context-aware, like Revu:

- On a markup: Properties, Edit text, Add to Tool Chest, Duplicate, Group/Ungroup, Lock, Hide, Bring to front/Send to back, Change subject, Change scale (measurements), Show/Hide caption, Convert (rect → area, line → length), Delete.
- On the page: Paste, Select all on page, Calibrate scale, Apply scale to all pages, Rotate view, Insert page, Delete page, Stamp here, Snapshot.
- On a thumbnail: Rotate, Delete, Extract, Insert before/after, Move to first/last.
- On a tool chest tool: Edit, Duplicate, Set hotkey, Move up/down, Remove, Export chest.

**Keyboard.** Single-key tools like Figma, standard editing chords, everything remappable per profile (Appendix B).

**"Dead simple" rules.** No modal onboarding. Opening a file drops you in Select mode with the last-used chest visible. Calibration is a status-bar click. Every destructive action has undo, including page deletes. Defaults are opinionated (red 2 pt lines, ft-in to 1/16, Helvetica 10) and changed in one place (Profile). Keyboard help via `?`.

## 4. Roadmap

Weeks assume Claude Code doing most implementation with Aaron reviewing and testing in Revu. Each phase ends with the interop matrix and a tagged release.

### Phase 0 — Foundation and the two spikes that de-risk everything (weeks 1–2)

- Monorepo, Vite app, `pdf-core` package, Vitest, Playwright, CI with license audit (`license-checker` fails on AGPL/GPL/unknown), Prettier/ESLint, ADR folder seeded with the decisions in this plan.
- Fixture corpus: at least 3 Revu-authored PDFs (with page scale, measurements, custom columns, a space, a group, a reply, a dynamic stamp), 3 CAD-exported plan sets (one with an embedded `/VP` scale, one 100+ sheets), 3 scans (JPEG, CCITT, JBIG2), 2 deliberately broken files.
- **Spike 0.1 (the proof):** with pdf-lib, write a `/Line` measurement with `/IT /LineDimension`, `/Measure`, `/Cap`, and a generated `/AP` into a fixture; write a page `/VP`. Open in Revu, Acrobat, Chrome, Edge. Pass = Revu's Markups List shows the correct length and the markup is editable there; Chrome and Edge display the line and caption.
- **Spike 0.2 (round-trip):** load a Revu-authored fixture with pdf-lib, move one markup, `saveIncremental`, reopen in Revu. Pass = custom columns, spaces, groups, replies, stamp, and page scale all intact; diff of the dictionaries shows only the keys Redline owns changed.
- **Spike 0.3 (performance):** render a 100-sheet ARCH D set with tiled pdf.js in a worker; pan/zoom at 60 fps; first page visible < 2 s from a local file.
- Exit: both spikes green and written up as ADRs. If 0.2 exposes a pdf-lib parsing failure on any fixture, add the qpdf repair pass before continuing.

### Phase 1 — Viewer (weeks 2–4)

- Open via drag-drop, file picker, File System Access API, and paste; recents; multiple documents in tabs.
- Tiled rendering, zoom (Ctrl+scroll, fit page/width, marquee zoom), rotate view, continuous and single-page modes, thumbnails, page navigation, text search with hit highlighting, text selection/copy, print.
- Autosave of the working state to OPFS/IndexedDB with crash recovery.
- Acceptance: opens every fixture; 100-sheet set navigable without jank; search returns hits across pages; reload recovers an unsaved session.

### Phase 2 — Markup engine and save (weeks 4–8)

- `Markup` model, parser from pdf-lib dictionaries (all subtypes, including `render: 'ap-bitmap'` fallback), serializer with ownership rules, AP generators (line with endings, polyline, polygon, cloud, rect, ellipse, ink, highlight/underline/strikeout via QuadPoints, free text with alignment, callout with leader, sticky note icon, stamp from XObject).
- Konva layer: select, multi-select, marquee, move, resize, rotate (where the subtype allows), vertex editing, snapping, Shift-constrain, copy/paste/duplicate across pages, group/ungroup, lock, z-order, undo/redo with a command stack.
- Properties panel, contextual toolbar, right-click menus, shortcuts, `?` overlay.
- Incremental save, Save As, and the "unsaved changes" lifecycle.
- Acceptance: every tool produces a markup that displays in Revu/Acrobat/Chrome/Edge; Revu-authored markups load, move, and save back with no lost keys (automated dictionary diff test on the corpus); undo covers every action.

### Phase 3 — Measurement, tool chest, profiles → Estimator MVP (weeks 8–12)

- Calibrate (two-point, presets, ratio, embedded), scope (page/all/like), `/VP` writing, status-bar scale.
- Length, polylength, area/perimeter, count, rectangle area, captions, ft-in and metric formatting, per-markup scale override.
- Markups List: sortable columns (subject, page, type, length, area, count, author, date, custom attributes, formula columns), filter by page/subject, subtotals per subject, select-from-list, export CSV/XLSX.
- Tool chest: create from markup, edit tool (style, measure settings, attributes, formulas, hotkey, icon), chests panel, quick slots, JSON import/export. Profiles: author, defaults, shortcuts, layout, JSON import/export.
- Pilot with Beisser estimators on real plan sets; collect the top 10 friction points and fix them before Phase 4.
- Acceptance: a wall-LF tool with a height attribute produces correct LF and SF totals; the saved PDF opens in Revu with each measurement showing the same length; export matches the on-screen totals.

### Phase 4 — Clerk tools (weeks 12–15)

- Pages panel operations, merge, split, extract, insert, rotate, delete, flatten.
- Stamp library, dynamic stamps, stamp all pages, import PDF/PNG/SVG stamps.
- Compress (optimize and reduce-images) with size preview.
- Acceptance: merge 10 files with bookmarks preserved; a 30 MB scanned set compresses > 60% at 200 dpi with readable text; stamps appear as stamps in Revu's Markups List; page reorder survives Revu reopen.

### Phase 5 — Sales and review polish (weeks 15–17)

- Review mode, laser pointer, export flattened/PNG, markups summary, hyperlinks between sheets (optional).
- Touch/pen basics if sales use iPads.
- Acceptance: a five-minute customer walkthrough needs no visible tool chrome; exported copies render identically in Acrobat and Chrome.

### Phase 6 — Round-trip hardening and Bluebeam import (weeks 17–20)

- Display Bluebeam-only measurement intents and values; groups/replies UI; layers (`/OC`) visibility; spaces display; custom columns from `/BSIAnnotColumns` shown and editable with `/BSIColumnData` kept aligned.
- Write Bluebeam-compatible count markups after verifying against Revu samples; per-region viewports; vector snapping.
- `.btx` tool set import (properties-mode tools and Measure dictionaries); `.bpx` profile import as a stretch.
- Acceptance: a Revu-authored takeoff with custom columns can be extended in Redline and Revu alternately for five rounds with a stable dictionary diff.

### Phase 7 — Productization (ongoing after the Beisser pilots)

- PWA install, offline; Sentry opt-in; performance budgets in CI; accessibility pass; docs site.
- `CloudProfileStore` on Supabase: accounts, company workspaces, shared chests and stamp libraries, org-wide defaults. Multi-tenant from the first migration.
- Licensing audit, trademark check on the product name, pricing page. The wedge: Bluebeam Revu is $260 (Basics, length/area only) to $590 (Max) per user per year in 2026; most clerks and sales staff use a fraction of it.

## 5. Working with Claude Code

**Setup.** Create the repo with `CLAUDE.md` (companion file), this `PLAN.md` at `docs/PLAN.md`, and `docs/interop-checklist.md`. Ask Claude Code to read both before any work. Keep `pdf-core` PRs small and test-first; every AP generator ships with a golden PDF and a rendered PNG snapshot.

**Rules to give it (also in CLAUDE.md).** One writer (pdf-lib only). PDF user space everywhere. Always write `/AP`. Never regenerate `/NM`. Never mutate fixtures. No AGPL/GPL dependencies. An ADR for every deviation from the plan. Run the license audit and the corpus round-trip test before opening a PR. When unsure how Revu stores something, decode a real fixture rather than guessing, and say what was verified versus assumed.

**Proof of concept first.** Before the sequence below, run `docs/POC-KICKOFF.md`: a lean pass that scaffolds the repo, implements the measurement writers, the parser, incremental save, and a bare demo page, and produces files for the four go/no-go checks (core loop in the browser, Revu/Acrobat/Chrome/Edge recognition, lossless round-trip, performance on a 100-sheet set). Four passes means Phases 1–3 proceed without revisiting the architecture; each failure maps to a contained fix.

**Prompt sequence.** Run these in order after the POC; each is one Claude Code session with the acceptance criteria pasted in. Prompts 1–3 are largely satisfied by the POC and become hardening passes.

1. _Scaffold._ "Read CLAUDE.md and docs/PLAN.md. Create the monorepo per §3.3 with Vite+React+TS, Tailwind+shadcn, Zustand, Vitest, Playwright, ESLint/Prettier, and a CI workflow that runs tests plus a license audit that fails on AGPL/GPL/unknown. Add ADR-0001 (stack) and ADR-0002 (one writer). Stop when `pnpm test` and `pnpm build` pass."
2. _Spike 0.1._ "In packages/pdf-core, implement `writeLineMeasurement(doc, pageIndex, {x1,y1,x2,y2}, scale, units, style)` and `setPageScale(doc, pageIndex, scale, units)` per §3.6 and Appendix A, generating the `/AP` with caption and leader lines using Helvetica. Produce `fixtures/out/spike-0.1.pdf` from `fixtures/blank-archd.pdf`. Add golden tests for the dictionaries and a rendered PNG snapshot via pdf.js in Node. I will open the output in Revu, Acrobat, Chrome and Edge and report back."
3. _Spike 0.2._ "Implement `openDocument(bytes)` → `Markup[]` parsing every annotation on every page into the §3.4 model with `raw` retained, and `saveIncremental(doc)` that writes back only owned keys. Add a corpus test: for each Revu fixture, parse, translate one markup by 10 pt, save, reparse, and assert that the dictionary diff touches only owned keys and that `/BSIColumnData`, `/BSISpaces`, `/BSIAnnotColumns`, `/RC`, `/IRT`, `/OC`, and `/VP` are byte-identical."
4. _Viewer._ Phase 1 with its acceptance list.
5. _Markup engine._ Phase 2, split into: model+parser, AP generators (one PR per subtype family), Konva interaction, panels/menus/shortcuts, save lifecycle.
6. _Measurement + tool chest + profiles._ Phase 3, split into: scale/units/formatting (pure functions first), measurement tools, Markups List + export, tool chest + profiles + JSON schemas.
7. Phases 4–6 likewise, one PR per bullet.

**Verification you own.** Claude Code cannot open Revu. After each `pdf-core` milestone it will leave files in `fixtures/out/`; run the interop checklist on your PC and paste results back. Screenshots of Revu's Markups List are the fastest feedback.

## 6. Design brief (Claude Design)

Mock these screens before Phase 2 starts, desktop-first at 1440×900 and 1920×1080, light and dark:

1. App shell with a plan sheet open in Select mode, right panel on Tool Chest.
2. Calibrate Scale dialog (two-point capture state, presets grid, ratio input, scope radio).
3. Tool editor (kind, style, measure settings, attributes, formulas, hotkey, icon preview).
4. Markups List with subtotals and an export button.
5. Right-click context menu on a measurement.
6. Pages panel mid-drag with a multi-selection.
7. Merge dialog with three files and page ranges.
8. Stamp picker with dynamic-field form.
9. Compress dialog with before/after size and a mode toggle.
10. Review mode with the floating toolbar.

Direction: dense, quiet, canvas-first. Neutral gray chrome, one accent color for selection and focus, markups in saturated colors that read on white drawings. 13 px UI type, 8 px spacing grid, no hero imagery, no marketing tone inside the app. Icons from Lucide. Menus and dialogs should look like an application, not a website.

## 7. Risks and mitigations

| Risk                                                                 | Mitigation                                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf-lib fails to parse some CAD-exported or damaged PDFs             | qpdf-wasm repair pass (rewrite to a clean structure) before pdf-lib load; corpus grows with every field failure; EmbedPDF's PDFium as a last-resort reader |
| AP generation fidelity (cloud arcs, captions, rotated text, hatches) | Golden PDFs + PNG snapshots per generator; visual review in four viewers each phase                                                                        |
| Revu page-scale byte format not yet verified for Revu 21             | Spike 0.2 uses a Revu 21-authored sample from Beisser; adjust `/VP` writer if needed                                                                       |
| Bluebeam-only count and volume intents                               | Pass through untouched until Phase 6; write our count as standard grouped markups plus `/RLAttrs` until Revu compatibility is verified                     |
| 200-sheet sets and 100 MB files                                      | Tiling, worker rendering, lazy text layers, OPFS working copies, incremental saves; performance budgets in CI                                              |
| Safari/iPad (no File System Access API; canvas limits)               | `FileTarget` fallback to download/share; tiles sized under the Safari area cap; touch in Phase 5                                                           |
| Licensing drift                                                      | CI license audit; no AGPL/GPL; dependency review in every PR                                                                                               |
| Scope creep                                                          | The "not in v1" list: digital signatures, OCR, forms authoring, 3D PDFs, Studio-style live collaboration, Bates numbering, redaction                       |

## 8. Open items I still want from you

- Two or three Revu 21-authored PDFs from Beisser with page scale, a few measurements, a custom column, a space, a group, and a stamp (for Spike 0.2).
- Confirm Beisser PCs run Chrome or Edge (for File System Access API "Save in place").
- Whether sales reviews plans on iPads with customers (moves touch support earlier).
- A product name you like; "Redline" is a placeholder.

---

## Appendix A — Example dictionaries Redline writes

Page scale, 1/8 in = 1 ft, feet-inches to 1/16:

```
% page dictionary
/VP [ << /Type /Viewport /BBox [0 0 2592 1728] /Name (Redline scale) /Measure 12 0 R >> ]

12 0 obj
<< /Type /Measure /Subtype /RL /R (1/8 in = 1 ft' in")
   /X [ << /Type /NumberFormat /U (') /C 0.1111111 /F /F /D 16 /FD true /SS (-) >>
        << /Type /NumberFormat /U (") /C 12 /F /F /D 16 /FD true >> ]
   /D [ << /Type /NumberFormat /U (') /C 1 /F /F /D 16 /FD true /SS (-) >>
        << /Type /NumberFormat /U (") /C 12 /F /F /D 16 /FD true >> ]
   /A [ << /Type /NumberFormat /U (sf) /C 1 /F /D /D 100 >> ]
   /T [ << /Type /NumberFormat /U (\260) /C 1 /F /D /D 100 >> ] >>
```

(`/C 0.1111111` because 1 pt = 1/72 in and 1 in = 8 ft → 8/72 ft per point.)

Length measurement:

```
<< /Type /Annot /Subtype /Line /IT /LineDimension
   /L [100 100 820 100] /Rect [90 80 830 130]
   /LE [/ClosedArrow /ClosedArrow] /LL 10 /LLE 2 /Cap true /CP /Top
   /Measure 12 0 R /Contents (80'-0")
   /Subj (Ext Wall 2x6) /T (Aaron McGrane) /NM (KQWVXHPTMBZRCJAL)
   /CreationDate (D:20260908101500-05'00') /M (D:20260908101500-05'00')
   /C [0.83 0.18 0.18] /CA 1 /BS << /Type /Border /W 2 /S /S >> /F 4
   /RLTool (01J9…) /RLAttrs ({"height":9,"studSpacing":16})
   /AP << /N 20 0 R >> /P 4 0 R >>
```

Area measurement (what Revu itself writes, minus its rich text):

```
<< /Type /Annot /Subtype /Polygon /IT /PolygonDimension
   /Vertices [5.5 59.5 5.5 5.5 113.5 5.5 113.5 59.5] /Rect [0 0 119 65]
   /Cap true /Contents (72 sf) /Subj (Tile) /C [1 0 0] /IC [1 1 0] /CA 1
   /BS << /Type /Border /W 1 /S /S >> /Measure 12 0 R /F 4
   /NM (…) /T (…) /M (…) /CreationDate (…) /AP << /N … >> >>
```

Stamp:

```
<< /Type /Annot /Subtype /Stamp /Name /RedlineReceived /Subj (Stamp) /Rect [72 648 300 720]
   /Contents (RECEIVED 09/08/2026 AM) /T (Aaron McGrane) /NM (…) /M (…) /CreationDate (…)
   /CA 1 /F 4 /AP << /N 31 0 R >> >>
```

Appearance stream skeleton (all subtypes):

```
20 0 obj
<< /Type /XObject /Subtype /Form /BBox [90 80 830 130] /Matrix [1 0 0 1 0 0]
   /Resources << /ProcSet [/PDF /Text] /Font << /Helv 5 0 R >> >> /Length … >>
stream
q 0.83 0.18 0.18 RG 2 w 100 100 m 820 100 l S … (arrowheads, leader lines) …
BT /Helv 10 Tf 0.83 0.18 0.18 rg 440 112 Td (80'-0") Tj ET Q
endstream
```

## Appendix B — Keyboard shortcuts v1 (default profile)

| Action                      | Keys                                    |     | Action                                                      | Keys                           |
| --------------------------- | --------------------------------------- | --- | ----------------------------------------------------------- | ------------------------------ |
| Select                      | V                                       |     | Length                                                      | M                              |
| Pan                         | H or hold Space                         |     | Polylength                                                  | Shift+M                        |
| Zoom in/out                 | Ctrl+= / Ctrl+− or Ctrl+scroll          |     | Area                                                        | A                              |
| Fit page / fit width / 100% | Shift+1 (or Ctrl+0) / Shift+2 / Shift+0 |     | Perimeter                                                   | Shift+A                        |
| Text box                    | T                                       |     | Count                                                       | C                              |
| Sticky note                 | N                                       |     | Calibrate scale                                             | X                              |
| Callout                     | K                                       |     | Stamp (last used)                                           | S                              |
| Rectangle                   | R                                       |     | Stamp picker                                                | Shift+S                        |
| Ellipse                     | E                                       |     | Quick-slot tools                                            | 1–9                            |
| Line / Arrow                | L / Shift+L                             |     | Open / Save / Save As                                       | Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Polygon / Cloud             | G / Shift+G                             |     | Undo / Redo                                                 | Ctrl+Z / Ctrl+Y                |
| Pen                         | P                                       |     | Duplicate                                                   | Ctrl+D                         |
| Highlighter                 | Shift+H                                 |     | Group / Ungroup                                             | Ctrl+G / Ctrl+Shift+G          |
| Finish polyline / cancel    | Enter / Esc                             |     | Lock                                                        | Ctrl+L                         |
| Remove last vertex          | Backspace                               |     | Find text                                                   | Ctrl+F                         |
| Constrain 45°/ortho         | hold Shift                              |     | Command palette (any tool or command by name)               | Ctrl+K                         |
| Override snap               | hold Alt                                |     | Right panel: Tool Chest / Markups List / Pages / Properties | Ctrl+Shift+1 / 2 / 3 / 4       |
| Delete markup               | Delete                                  |     | Review mode                                                 | Ctrl+Shift+F                   |
| Select all on page          | Ctrl+A                                  |     | Shortcut help                                               | ?                              |

Browser-reserved chords that a web page cannot intercept (Ctrl+T, Ctrl+W, Ctrl+N, Ctrl+Shift+T/N/W, Ctrl+Tab, and F11 in most browsers) are deliberately unused; installing as a PWA frees some of them but the defaults must work in a plain tab. A "Bluebeam-style" shortcut preset ships in the profile picker; all keys are remappable.

## Appendix C — Tool chest and profile JSON

```json
{
  "$schema": "https://redline.app/schemas/toolchest-1.json",
  "version": 1,
  "id": "01J9Z6Q3K7N4R8S2T5V9W1X3Y5",
  "name": "Beisser Framing Takeoff",
  "author": "Aaron McGrane",
  "updatedAt": "2026-09-08T15:15:00Z",
  "defaultScale": { "pageLength": 1, "pageUnit": "in", "worldLength": 8, "worldUnit": "ft" },
  "tools": [
    {
      "id": "01J9Z6R1…",
      "name": "Ext Wall 2x6 · 9 ft",
      "subject": "Ext Wall 2x6",
      "kind": "length",
      "mode": "properties",
      "style": {
        "stroke": "#D32F2F",
        "opacity": 1,
        "lineWidth": 2,
        "lineEnds": ["ClosedArrow", "ClosedArrow"],
        "font": { "family": "Helvetica", "size": 10 }
      },
      "measure": { "display": "ft-in", "precision": 16, "caption": true, "captionPosition": "top" },
      "attributes": [
        { "key": "height", "label": "Wall Height", "type": "number", "unit": "ft", "default": 9 },
        {
          "key": "studSpacing",
          "label": "Stud Spacing (in)",
          "type": "choice",
          "options": [12, 16, 24],
          "default": 16
        }
      ],
      "formulas": [
        { "key": "wallSF", "label": "Wall SF", "expr": "length * height" },
        { "key": "studs", "label": "Studs", "expr": "ceil(length * 12 / studSpacing) + 1" }
      ],
      "hotkey": "1",
      "icon": "auto"
    },
    {
      "id": "01J9Z6R2…",
      "name": "Roof Area",
      "subject": "Roofing",
      "kind": "area",
      "mode": "properties",
      "style": { "stroke": "#1565C0", "fill": "#1565C0", "fillOpacity": 0.25, "lineWidth": 1 },
      "measure": { "display": "decimal-ft", "precision": 2, "caption": true },
      "attributes": [{ "key": "pitch", "label": "Pitch (x/12)", "type": "number", "default": 6 }],
      "formulas": [
        { "key": "sfActual", "label": "SF (pitched)", "expr": "area * sqrt(1 + (pitch/12)^2)" },
        { "key": "squares", "label": "Squares", "expr": "ceil(sfActual / 100)" }
      ],
      "hotkey": "2"
    }
  ]
}
```

```json
{
  "$schema": "https://redline.app/schemas/profile-1.json",
  "version": 1,
  "name": "Aaron — Estimating",
  "author": "Aaron McGrane",
  "defaults": {
    "units": { "display": "ft-in", "precision": 16 },
    "scalePresets": ["1/8 in = 1 ft", "1/4 in = 1 ft", "3/16 in = 1 ft", "1/16 in = 1 ft"],
    "styles": {
      "length": { "stroke": "#D32F2F", "lineWidth": 2 },
      "area": { "stroke": "#1565C0", "fill": "#1565C0", "fillOpacity": 0.25 },
      "text": { "font": { "family": "Helvetica", "size": 10 } }
    }
  },
  "shortcuts": { "preset": "redline", "overrides": { "length": "M", "area": "A" } },
  "layout": {
    "rightPanel": "toolchest",
    "rightPanelWidth": 320,
    "toolRail": true,
    "theme": "system"
  },
  "toolchests": ["01J9Z6Q3K7N4R8S2T5V9W1X3Y5"],
  "stamps": ["received-dynamic", "reviewed"]
}
```

Formulas may reference `length`, `area`, `perimeter`, `count`, any attribute key, and `ceil floor round min max sqrt abs`; the evaluator is a small parser, never `eval`.

## Appendix D — Sources consulted for this plan

Library facts (versions verified against the npm registry on 2026-09-08): pdf.js 6.3.x (Apache-2.0), `@cantoo/pdf-lib` 2.9.x (MIT; incremental save, low-level dictionaries), Konva 10.x (MIT), `qpdf-wasm` 0.1.x (Apache-2.0, lossless only), EmbedPDF 2.15 (MIT/Apache-2.0 PDFium fork, no measurement plugin), MuPDF.js 1.28 (AGPL-3.0), Ghostscript WASM (AGPL-3.0). Browser support from MDN compat data 8.1: File System Access API is Chromium-only; OPFS is universal; Safari canvas area cap 16.7 Mpx.

Interoperability: ISO 32000-1 Tables 175/178/260–263 (Line/Polygon annotations, Viewport, Measure, NumberFormat); PDFium `cpdf_annot.cpp` / `cpdf_generateap.cpp` (which subtypes get synthesized appearances); decoded Bluebeam Estimation `.btx` tool set and Engineering Review interactive stamp from community.bluebeam.com; pymkup (Bluebeam key reverse-engineering); Bluebeam support articles on custom columns, viewports/protected scale, locking vs flattening, interactive stamps; Apryse community example of programmatic `/IT` + `/Measure` annotations; Bluebeam pricing page (Basics $260, Core $330, Complete $440, Max $590 per user per year, 2026).
