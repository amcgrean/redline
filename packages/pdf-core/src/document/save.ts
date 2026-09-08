/**
 * Incremental save. PLAN §3.6 "Saving" and CLAUDE.md non-negotiable #5.
 *
 * pdf-lib's `saveIncremental` returns ONLY the update section (new/changed objects, an
 * xref, a trailer with `/Prev`). `saveIncremental` here returns the original bytes with
 * that section appended, which is what a viewer expects. The original bytes are never
 * touched, so everything Redline does not understand is preserved by construction.
 *
 * VERIFIED (probe against the Revu fixture): with `useObjectStreams: false` the update
 * section is plain objects, the rewritten annotation carries every Bluebeam key
 * (`/RC`, `/DepthUnit`, `/MeasurementTypes`, …) verbatim — including Revu's own `(fot)`
 * typo — and the xref offsets already account for concatenation.
 *
 * pdf-lib only auto-tracks changes to objects it created itself; edits to dictionaries
 * parsed from the file must be marked explicitly, which `markChanged` does.
 */

import { PDFArray, PDFName, PDFRef, type PDFDocument } from '@cantoo/pdf-lib';
import type { RedlineDocument } from '../types.js';

type Snapshot = ReturnType<PDFDocument['takeSnapshot']>;

const snapshots = new WeakMap<RedlineDocument, Snapshot>();

/**
 * Take the baseline snapshot. MUST run before any object is registered: pdf-lib decides
 * "new object" by object number > the snapshot's high-water mark, so a snapshot taken
 * after `context.register` would silently drop those objects from the update section.
 * `openDocument` calls this as its last step.
 */
export function initSnapshot(doc: RedlineDocument): Snapshot {
  const snapshot = doc.pdfDoc.takeSnapshot();
  snapshots.set(doc, snapshot);
  return snapshot;
}

/** The baseline snapshot for a document opened through `openDocument`. */
export function snapshotOf(doc: RedlineDocument): Snapshot {
  const snapshot = snapshots.get(doc);
  if (!snapshot) {
    throw new Error('Document has no baseline snapshot; open it with openDocument()');
  }
  return snapshot;
}

/** Record that the object behind `ref` must be rewritten in the next update section. */
export function markChanged(doc: RedlineDocument, ref: PDFRef | undefined): void {
  if (ref) snapshotOf(doc).markRefForSave(ref);
}

/**
 * Record that the object behind `ref` is gone. A new object (registered after the
 * snapshot) is simply dropped from the update section; an object from the file gets a
 * free xref entry.
 */
export function markDeleted(doc: RedlineDocument, ref: PDFRef | undefined): void {
  if (!ref) return;
  snapshotOf(doc).markDeletedRef(ref);
  doc.pdfDoc.context.delete(ref);
}

/**
 * Mark the holder of a page-level array (`/Annots`, `/VP`) as changed. The array may be
 * an indirect object of its own — Revu writes `117 0 obj [115 0 R …]` — in which case
 * the array, not the page, is what needs rewriting.
 */
export function markPageArrayChanged(doc: RedlineDocument, pageIndex: number, key: string): void {
  const page = doc.pdfDoc.getPage(pageIndex);
  const direct = page.node.get(PDFName.of(key));
  if (direct instanceof PDFRef) {
    markChanged(doc, direct);
    return;
  }
  markChanged(doc, page.ref);
}

/** Get (creating if needed) a page's `/Annots` array and mark its holder changed. */
export function annotsArrayForWrite(doc: RedlineDocument, pageIndex: number): PDFArray {
  const page = doc.pdfDoc.getPage(pageIndex);
  let annots = page.node.Annots();
  if (!(annots instanceof PDFArray)) {
    annots = PDFArray.withContext(doc.pdfDoc.context);
    page.node.set(PDFName.of('Annots'), annots);
  }
  markPageArrayChanged(doc, pageIndex, 'Annots');
  return annots;
}

export interface SaveResult {
  /** Full file: original bytes + update section. */
  bytes: Uint8Array;
  /** Just the appended section, for inspection in tests. */
  update: Uint8Array;
}

/** Original bytes plus an appended incremental update. */
export async function saveIncremental(doc: RedlineDocument): Promise<SaveResult> {
  const update = await doc.pdfDoc.saveIncremental(snapshotOf(doc), { useObjectStreams: false });
  const bytes = new Uint8Array(doc.originalBytes.length + update.length);
  bytes.set(doc.originalBytes, 0);
  bytes.set(update, doc.originalBytes.length);
  return { bytes, update };
}
