/**
 * Per-document text index for search. pdf.js only READS here (CLAUDE.md #1).
 *
 * Text items come from `getTextContent()`, cached per document and page. A hit is a
 * substring of one item; its rectangle is interpolated along the item's width, which
 * is exact for monospaced runs and close enough for highlighting elsewhere. Matches that
 * span two items (rare in CAD exports, common in justified prose) are not found — a
 * Phase 2 refinement if it bites.
 */

import type { PdfjsDocument } from '../pdfjs';

export interface TextItemBox {
  str: string;
  /** Lower-cased, for matching. */
  lower: string;
  /** Origin in PDF user space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FindHit {
  page: number;
  /** PDF user-space rectangle of the matched substring. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const indexes = new WeakMap<PdfjsDocument, Map<number, Promise<TextItemBox[]>>>();

async function pageItems(pdfjs: PdfjsDocument, pageIndex: number): Promise<TextItemBox[]> {
  let perDoc = indexes.get(pdfjs);
  if (!perDoc) {
    perDoc = new Map();
    indexes.set(pdfjs, perDoc);
  }
  let pending = perDoc.get(pageIndex);
  if (!pending) {
    pending = (async () => {
      const page = await pdfjs.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      const out: TextItemBox[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const [, , , , e, f] = item.transform as number[];
        out.push({
          str: item.str,
          lower: item.str.toLowerCase(),
          x: e ?? 0,
          y: f ?? 0,
          width: item.width,
          height: item.height,
        });
      }
      return out;
    })();
    perDoc.set(pageIndex, pending);
  }
  return pending;
}

/** Search every page. Returns hits in page/reading order. */
export async function searchDocument(pdfjs: PdfjsDocument, query: string): Promise<FindHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: FindHit[] = [];
  for (let page = 0; page < pdfjs.numPages; page += 1) {
    const items = await pageItems(pdfjs, page);
    for (const item of items) {
      let from = 0;
      for (;;) {
        const at = item.lower.indexOf(needle, from);
        if (at < 0) break;
        const len = item.str.length || 1;
        const x0 = item.x + (item.width * at) / len;
        const x1 = item.x + (item.width * (at + needle.length)) / len;
        hits.push({ page, x0, y0: item.y, x1, y1: item.y + item.height });
        from = at + needle.length;
      }
    }
  }
  return hits;
}
