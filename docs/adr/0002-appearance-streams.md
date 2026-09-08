# ADR-0002 — Appearance streams: `/BBox` = `/Rect`, identity `/Matrix`, standard Helvetica

**Status:** accepted (POC, 2026-09-08)

## Context

CLAUDE.md says "`/BBox` = `/Rect`, `/Matrix` to origin"; PLAN Appendix A's worked example
shows `/BBox [90 80 830 130] /Matrix [1 0 0 1 0 0]` with the content stream in page
coordinates. Both are valid as long as BBox and Matrix agree with each other.

## Decision

- Follow the Appendix A example literally: `/BBox` equals `/Rect`, `/Matrix` is the
  identity, and the content stream is written in page user space. It keeps streams readable
  ("100 100 m 820 100 l S" is the line you drew) and makes translation trivial.
- The caption font is the standard-14 Helvetica as a plain `/Type1` dictionary with
  `/WinAnsiEncoding` inside the AP's `/Resources`. No embedding, no shared font object, so
  every AP is self-contained. Metrics for centring come from pdf-lib's
  `StandardFontEmbedder` without registering anything in the document.
- Opacity is an `/ExtGState` (`/CA`, `/ca`) inside the AP, added only when < 1.
- `moveMarkup` regenerates the AP for measurements Redline can draw (`LineDimension`,
  `PolygonDimension`) and reuses the existing `/Contents` as the caption. Everything else
  keeps its AP: with BBox in form space and the viewer mapping BBox onto the new `/Rect`,
  a translation needs no new stream.

## Verified

- pdf.js in Node renders the generated APs (PNG snapshots in `test/__snapshots__`).

## Needs Aaron

- Chrome/Edge/Acrobat/Revu rendering of `fixtures/out/spike-0.1-blank-archd.pdf`
  (interop checklist rows 2–4).
