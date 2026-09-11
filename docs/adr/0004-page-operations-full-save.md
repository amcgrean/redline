# ADR 0004 — Page operations rewrite the file; the app reloads after each one

Date: 2026-09-10 · Status: accepted

## Context

PLAN §3.6 and CLAUDE.md #5: markup-only changes are incremental saves; page-structure
changes (rotate, delete, reorder, insert, extract, merge) are full rewrites through
pdf-lib. The markup model in `pdf-core` (`RedlineDocument.markups`, `pageScales`,
`pageSizes`) is indexed by page position, and pdf.js holds its own parsed copy of the
file, so both go stale the moment the page tree changes.

## Decision

1. `packages/pdf-core/src/pages/ops.ts` mutates the pdf-lib document only. After any
   operation the caller must `saveFull` and `openDocument` the result; the functions do
   not remap the markup model. The web app does exactly that in `actions.pageOperation`:
   run the operation, `saveFull`, reload pdf-core and pdf.js from the bytes, swap the
   session's document. Cost is one rewrite plus one reload per operation, which stays
   under a second on the CAD sets in `fixtures/`.
2. Undo for page operations is a separate stack on the session (`pageHistory`, five
   entries, each holding the pre-operation bytes from a non-finalising incremental save).
   Ctrl+Z falls through to it when the markup command stack is empty. Markup undo across
   a page operation is not supported (the command stack is cleared on reload, as it is on
   Save).
3. `saveFull` writes plain objects (`useObjectStreams: false`), leaves form-field
   appearances alone, and applies pending markup deletions first so the rewrite does not
   resurrect trashed objects. `deletePages` deletes the removed pages' annotation objects
   (and their popups) so they are not carried as orphans.
4. `movePages` re-registers each moved page object under its original ref before
   re-inserting it, because pdf-lib's `removePage` deletes the page from the context.

## Consequences

- The file's incremental-update history collapses into one xref after a page operation.
  Every parsed object keeps its keys (verified by `pages.test.ts` on the synthetic Revu
  fixture: identical key sets per markup, `/BSISpaces` on the page).
- Bookmarks: pdf-lib's `copyPages` does not carry `/Outlines`, so `pages/outlines.ts`
  reads them as a title/page tree and writes them back: merge and insert-from append the
  source's bookmarks re-pointed at the copied pages, extract keeps the ones for the pages
  taken, delete prunes items whose page went away, rotate/move need nothing (items refer
  to page objects). Only page destinations are carried; URI/JavaScript actions and
  destination zoom rectangles are dropped (`/Fit` is written). Updated 2026-09-11.
- Needs Aaron's Revu check (interop checklist): a rotated page with measurements reads the
  same values; page reorder survives a Revu reopen; a Revu file after insert/delete keeps
  its custom columns and spaces.
