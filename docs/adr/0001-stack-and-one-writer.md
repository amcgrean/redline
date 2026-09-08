# ADR-0001 — Stack, and pdf-lib as the only writer

**Status:** accepted (POC, 2026-09-08)

## Context

PLAN §3.1–3.2 lock the stack and the "one writer" rule. The POC had to prove they hold up
against a real Revu 21 file before Phases 1–3 build on them.

## Decision

- `@cantoo/pdf-lib` 2.9.x is the only code that produces PDF bytes. pdf.js 6.x reads and
  renders only.
- Incremental saves use pdf-lib's `takeSnapshot()` + `saveIncremental(snapshot,
{ useObjectStreams: false })`. pdf-lib returns only the update section; Redline appends
  it to the original bytes (`document/save.ts`).
- The snapshot is taken in `openDocument` before anything is registered, because pdf-lib
  treats any object number above the snapshot's high-water mark as "new" and any object at
  or below it as unchanged unless explicitly marked. Edits to parsed dictionaries are marked
  with `markChanged`; pdf-lib's automatic tracking did not pick them up in testing.
- Object streams are off for updates so the appended section is plain, greppable objects.

## Verified

- Loading the Revu fixture, editing one annotation in place, and saving incrementally
  rewrote that annotation with every Bluebeam key verbatim — including Revu's own
  `/U(fot)` typo in a `/DepthUnit` — and nothing else.
- pdf.js 6 opens the result.

## Consequences

- Node 22+ is the natural runtime for tests; on Node 20 `test/setup.ts` polyfills
  `Promise.withResolvers`, `ArrayBuffer#transferToFixedLength` and
  `process.getBuiltinModule` for pdf.js.
- `@napi-rs/canvas` ≥ 1.0 is required by pdf.js 6 for Node rendering.
