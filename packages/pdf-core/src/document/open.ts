/**
 * `openDocument(bytes)` — parse every annotation on every page into the PLAN §3.4 model.
 *
 * Strictly read-only: opening a file must not dirty it, or the corpus round-trip test
 * could not tell a Redline edit apart from a side effect of loading.
 */

import { PDFArray, PDFDict, PDFRef, PDFDocument } from '@cantoo/pdf-lib';
import type { Markup, RedlineDocument } from '../types.js';
import { collectUsedNM, parseAnnotation } from '../annots/parse.js';
import { lookupText } from '../annots/dict.js';
import { readPageScale } from '../measure/viewport.js';
import { computeMeasurement } from '../measure/compute.js';
import { initSnapshot } from './save.js';

export interface OpenOptions {
  /** Passed through to pdf-lib. Encrypted files still parse for viewing. */
  ignoreEncryption?: boolean;
}

/**
 * Annotations authored outside Revu often have no `/NM`. They get a deterministic
 * placeholder derived from the object number so the UI has a stable handle; a real
 * `/NM` is assigned on the first edit (see `ensureNM`), never at parse time.
 */
function placeholderId(ref: PDFRef): string {
  return `obj:${ref.objectNumber}:${ref.generationNumber}`;
}

export function isPlaceholderId(id: string): boolean {
  return id.startsWith('obj:');
}

export async function openDocument(
  bytes: Uint8Array,
  options: OpenOptions = {},
): Promise<RedlineDocument> {
  // `updateMetadata: false` keeps pdf-lib from rewriting `/Info` and the XMP packet on
  // save — neither is a key Redline owns.
  const pdfDoc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: options.ignoreEncryption ?? true,
  });

  const pages = pdfDoc.getPages();
  const usedNM = collectUsedNM(pages);
  const markups: Markup[] = [];
  const pageScales = new Map<
    number,
    RedlineDocument['pageScales'] extends Map<number, infer V> ? V : never
  >();
  const pageSizes: RedlineDocument['pageSizes'] = [];

  for (const [pageIndex, page] of pages.entries()) {
    const cropBox = page.getCropBox();
    pageSizes.push({
      width: cropBox.width,
      height: cropBox.height,
      rotation: ((page.getRotation().angle % 360) + 360) % 360,
    });

    const scale = readPageScale(page);
    if (scale) pageScales.set(pageIndex, scale);

    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict)) continue;
      const nm = lookupText(dict, 'NM');
      const id = nm ?? placeholderId(ref instanceof PDFRef ? ref : PDFRef.of(0, 0));
      const markup = parseAnnotation(
        ref instanceof PDFRef ? ref : PDFRef.of(0, 0),
        dict,
        pageIndex,
        id,
      );
      // Fill in the measurement block now that the page's scale is known.
      if (markup.measure && scale) {
        markup.measure.scale = scale.scale;
        markup.measure.units = scale.units;
        markup.measure.computed = computeMeasurement(markup, scale);
      }
      markups.push(markup);
    }
  }

  const doc: RedlineDocument = {
    pdfDoc,
    originalBytes: bytes,
    markups,
    usedNM,
    pageScales,
    ownViewports: new Map(),
    pageSizes,
    trash: [],
    baselineObjectNumber: pdfDoc.context.largestObjectNumber,
  };
  // Baseline for incremental saves — must precede any object registration.
  initSnapshot(doc);
  return doc;
}

/** Look a markup up by its id. Throws rather than silently no-op'ing on a typo. */
export function requireMarkup(doc: RedlineDocument, id: string): Markup {
  const markup = doc.markups.find((m) => m.id === id);
  if (!markup) throw new Error(`No markup with id ${id}`);
  return markup;
}
