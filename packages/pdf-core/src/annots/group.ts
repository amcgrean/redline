/**
 * Groups (PLAN §3.11 Group/Ungroup), written the way Revu does: one member is the
 * parent; every other member carries `/RT /Group` and `/IRT <parent ref>`. Redline
 * otherwise never touches `/RT` or `/IRT` (CLAUDE.md #4); these two functions are the
 * user's explicit edit of exactly those keys.
 */

import { PDFName, PDFRef, PDFString } from '@cantoo/pdf-lib';
import type { Markup, RedlineDocument } from '../types.js';
import { requireMarkup } from '../document/open.js';
import { markChanged } from '../document/save.js';
import { lookupName, pdfDate } from './dict.js';

/** Every id in the group `id` belongs to (parent first), or just `[id]` when ungrouped. */
export function groupMembers(doc: RedlineDocument, id: string): string[] {
  const markup = requireMarkup(doc, id);
  const parentId = markup.relations.groupParent ?? id;
  const parent = doc.markups.find((m) => m.id === parentId);
  if (!parent) return [id];
  const children = doc.markups
    .filter((m) => m.relations.groupParent === parentId && m.id !== parentId)
    .map((m) => m.id);
  return children.length === 0 && parentId === id ? [id] : [parentId, ...children];
}

/** True when the markup is in a group (as parent or child). */
export function isGrouped(doc: RedlineDocument, id: string): boolean {
  return groupMembers(doc, id).length > 1;
}

/**
 * Group `ids` under the first one. Members of other groups are pulled out of them first.
 * Returns the parent id.
 */
export function groupMarkups(
  doc: RedlineDocument,
  ids: readonly string[],
  now = new Date(),
): string {
  const unique = [...new Set(ids)];
  if (unique.length < 2) throw new Error('A group needs at least two markups');
  const parent = requireMarkup(doc, unique[0]!);
  ungroupMarkups(doc, unique, now);
  for (const id of unique.slice(1)) {
    const child = requireMarkup(doc, id);
    if (child.pageIndex !== parent.pageIndex) throw new Error('A group stays on one page');
    child.raw.set(PDFName.of('RT'), PDFName.of('Group'));
    child.raw.set(PDFName.of('IRT'), parent.ref);
    child.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
    child.relations.groupParent = parent.id;
    markChanged(doc, child.ref);
  }
  return parent.id;
}

/** Remove `ids` (and, for a parent, its whole group) from their groups. */
export function ungroupMarkups(
  doc: RedlineDocument,
  ids: readonly string[],
  now = new Date(),
): Markup[] {
  const touched: Markup[] = [];
  const targets = new Set<string>();
  for (const id of ids) for (const member of groupMembers(doc, id)) targets.add(member);
  for (const id of targets) {
    const m = doc.markups.find((x) => x.id === id);
    if (!m) continue;
    if (lookupName(m.raw, 'RT') !== 'Group') continue;
    const irt = m.raw.get(PDFName.of('IRT'));
    if (!(irt instanceof PDFRef) && irt !== undefined) continue;
    m.raw.delete(PDFName.of('RT'));
    m.raw.delete(PDFName.of('IRT'));
    m.raw.set(PDFName.of('M'), PDFString.of(pdfDate(now)));
    delete m.relations.groupParent;
    markChanged(doc, m.ref);
    touched.push(m);
  }
  return touched;
}
