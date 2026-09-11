/**
 * Bookmarks (`/Outlines`, ISO 32000-1 §12.3.3) as a plain tree of titles and page
 * indices, so page operations can carry them: merge and insert-from append the source's
 * bookmarks (re-pointed at the copied pages), delete prunes items whose page went away,
 * reorder keeps them (they reference page objects, which survive a move).
 *
 * pdf-lib has no outline API, so this reads and writes the dictionaries directly. Only
 * page destinations are kept (`/Dest [page /Fit …]`, named destinations through
 * `/Dests` or `/Names /Dests`, and `/A << /S /GoTo >>`); URI and other actions are
 * dropped rather than carried blindly into another file.
 */

import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';
import type { RedlineDocument } from '../types.js';

export interface OutlineItem {
  title: string;
  /** 0-based page index; undefined when the bookmark had no page destination. */
  pageIndex?: number;
  children: OutlineItem[];
  /** Collapsed in the viewer's tree (`/Count` negative). */
  closed?: boolean;
}

function textOf(value: PDFObject | undefined): string {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return '';
}

/** Resolve a destination (array, name, or string) to the page ref it points at. */
function destinationPage(
  pdf: PDFDocument,
  dest: PDFObject | undefined,
  depth = 0,
): PDFRef | undefined {
  if (!dest || depth > 3) return undefined;
  const context = pdf.context;
  if (dest instanceof PDFArray && dest.size() > 0) {
    const first = dest.get(0);
    return first instanceof PDFRef ? first : undefined;
  }
  const key = dest instanceof PDFName ? dest.decodeText() : textOf(dest);
  if (!key) return undefined;
  // Old-style /Dests dictionary in the catalog.
  const dests = pdf.catalog.lookup(PDFName.of('Dests'));
  if (dests instanceof PDFDict) {
    const entry = dests.lookup(PDFName.of(key));
    if (entry instanceof PDFDict)
      return destinationPage(pdf, entry.lookup(PDFName.of('D')), depth + 1);
    if (entry) return destinationPage(pdf, entry, depth + 1);
  }
  // Name tree under /Names /Dests.
  const names = pdf.catalog.lookup(PDFName.of('Names'));
  const tree = names instanceof PDFDict ? names.lookup(PDFName.of('Dests')) : undefined;
  const found = tree instanceof PDFDict ? lookupNameTree(context, tree, key) : undefined;
  if (found instanceof PDFDict)
    return destinationPage(pdf, found.lookup(PDFName.of('D')), depth + 1);
  if (found) return destinationPage(pdf, found, depth + 1);
  return undefined;
}

function lookupNameTree(
  context: PDFDocument['context'],
  node: PDFDict,
  key: string,
  depth = 0,
): PDFObject | undefined {
  if (depth > 32) return undefined;
  const names = node.lookup(PDFName.of('Names'));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      if (textOf(names.lookup(i)) === key) return names.lookup(i + 1);
    }
  }
  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i += 1) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) {
        const hit = lookupNameTree(context, kid, key, depth + 1);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

/** Read the outline tree. Missing or malformed outlines read as an empty list. */
export function readOutlines(pdf: PDFDocument): OutlineItem[] {
  const root = pdf.catalog.lookup(PDFName.of('Outlines'));
  if (!(root instanceof PDFDict)) return [];
  const pageIndexByRef = new Map<string, number>();
  pdf.getPages().forEach((page, i) => pageIndexByRef.set(page.ref.toString(), i));
  const seen = new Set<string>();

  const readSiblings = (firstRef: PDFObject | undefined, depth: number): OutlineItem[] => {
    const items: OutlineItem[] = [];
    let current = firstRef;
    while (current instanceof PDFRef && depth < 32) {
      const key = current.toString();
      if (seen.has(key)) break;
      seen.add(key);
      const dict = pdf.context.lookup(current);
      if (!(dict instanceof PDFDict)) break;
      let dest = dict.lookup(PDFName.of('Dest'));
      if (!dest) {
        const action = dict.lookup(PDFName.of('A'));
        if (action instanceof PDFDict && action.lookup(PDFName.of('S')) === PDFName.of('GoTo')) {
          dest = action.lookup(PDFName.of('D'));
        }
      }
      const pageRef = destinationPage(pdf, dest);
      const pageIndex = pageRef ? pageIndexByRef.get(pageRef.toString()) : undefined;
      const count = dict.lookup(PDFName.of('Count'));
      const item: OutlineItem = {
        title: textOf(dict.lookup(PDFName.of('Title'))),
        children: readSiblings(dict.get(PDFName.of('First')), depth + 1),
      };
      if (pageIndex !== undefined) item.pageIndex = pageIndex;
      if (count instanceof PDFNumber && count.asNumber() < 0 && item.children.length > 0) {
        item.closed = true;
      }
      items.push(item);
      current = dict.get(PDFName.of('Next'));
    }
    return items;
  };
  return readSiblings(root.get(PDFName.of('First')), 0);
}

function countOpen(items: OutlineItem[]): number {
  return items.reduce((n, item) => n + 1 + (item.closed ? 0 : countOpen(item.children)), 0);
}

/** Replace the document's outline tree with `items` (an empty list removes `/Outlines`). */
export function writeOutlines(pdf: PDFDocument, items: OutlineItem[]): void {
  const context = pdf.context;
  const pages = pdf.getPages();
  if (items.length === 0) {
    pdf.catalog.delete(PDFName.of('Outlines'));
    return;
  }
  const root = context.obj({}) as PDFDict;
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  const rootRef = context.register(root);

  const writeSiblings = (list: OutlineItem[], parentRef: PDFRef): [PDFRef, PDFRef] | undefined => {
    let first: PDFRef | undefined;
    let previous: { ref: PDFRef; dict: PDFDict } | undefined;
    for (const item of list) {
      const dict = context.obj({}) as PDFDict;
      const ref = context.register(dict);
      dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
      dict.set(PDFName.of('Parent'), parentRef);
      const page = item.pageIndex !== undefined ? pages[item.pageIndex] : undefined;
      if (page) {
        const dest = PDFArray.withContext(context);
        dest.push(page.ref);
        dest.push(PDFName.of('Fit'));
        dict.set(PDFName.of('Dest'), dest);
      }
      if (item.children.length > 0) {
        const kids = writeSiblings(item.children, ref);
        if (kids) {
          dict.set(PDFName.of('First'), kids[0]);
          dict.set(PDFName.of('Last'), kids[1]);
          const n = countOpen(item.children);
          dict.set(PDFName.of('Count'), PDFNumber.of(item.closed ? -n : n));
        }
      }
      if (previous) {
        previous.dict.set(PDFName.of('Next'), ref);
        dict.set(PDFName.of('Prev'), previous.ref);
      }
      first ??= ref;
      previous = { ref, dict };
    }
    return first && previous ? [first, previous.ref] : undefined;
  };

  const ends = writeSiblings(items, rootRef);
  if (ends) {
    root.set(PDFName.of('First'), ends[0]);
    root.set(PDFName.of('Last'), ends[1]);
    root.set(PDFName.of('Count'), PDFNumber.of(countOpen(items)));
  }
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
}

/** Shift page indices by `offset`; items pointing outside `[0, pageCount)` lose their page. */
export function remapOutlines(
  items: OutlineItem[],
  map: (pageIndex: number) => number | undefined,
): OutlineItem[] {
  return items.map((item) => {
    const mapped = item.pageIndex === undefined ? undefined : map(item.pageIndex);
    const out: OutlineItem = { title: item.title, children: remapOutlines(item.children, map) };
    if (mapped !== undefined) out.pageIndex = mapped;
    if (item.closed) out.closed = true;
    return out;
  });
}

/** Drop items that have neither a page nor children with pages (after a delete). */
export function pruneOutlines(items: OutlineItem[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const item of items) {
    const children = pruneOutlines(item.children);
    if (item.pageIndex === undefined && children.length === 0) continue;
    out.push({ ...item, children });
  }
  return out;
}

export function outlinesOf(doc: RedlineDocument): OutlineItem[] {
  return readOutlines(doc.pdfDoc);
}
