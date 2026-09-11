/**
 * Right-click menu for a page thumbnail (PLAN §3.11): rotate, delete, extract, insert
 * before/after, move to first/last. Every entry goes through the same page operations
 * as the Pages panel toolbar.
 */

import {
  deletePages,
  extractPages,
  insertBlankPage,
  movePages,
  rotatePages,
} from '@redline/pdf-core';
import type { MenuItem } from './ContextMenu';
import { actions, getSession, useEditorStore } from './store';
import { downloadBytes } from './download';

export function pageMenuItems(index: number): MenuItem[] {
  const { pageSelection, pageCount } = useEditorStore.getState();
  const pages = pageSelection.includes(index) ? [...pageSelection].sort((a, b) => a - b) : [index];
  const many = pages.length > 1;
  const label = (verb: string) => (many ? `${verb} ${pages.length} pages` : `${verb} page`);
  return [
    {
      label: 'Rotate left',
      onSelect: () =>
        void actions.pageOperation(label('Rotate'), (doc) => rotatePages(doc, pages, -90), {
          select: pages,
        }),
    },
    {
      label: 'Rotate right',
      onSelect: () =>
        void actions.pageOperation(label('Rotate'), (doc) => rotatePages(doc, pages, 90), {
          select: pages,
        }),
    },
    { separator: true, label: '' },
    {
      label: 'Insert blank page before',
      onSelect: () => {
        const size = getSession()?.doc.pageSizes[index];
        void actions.pageOperation(
          'Insert blank page',
          (doc) => insertBlankPage(doc, index, size ? [size.width, size.height] : undefined),
          { select: [index], goTo: index },
        );
      },
    },
    {
      label: 'Insert blank page after',
      onSelect: () => {
        const size = getSession()?.doc.pageSizes[index];
        void actions.pageOperation(
          'Insert blank page',
          (doc) => insertBlankPage(doc, index + 1, size ? [size.width, size.height] : undefined),
          { select: [index + 1], goTo: index + 1 },
        );
      },
    },
    { separator: true, label: '' },
    {
      label: many ? 'Move pages to first' : 'Move to first',
      disabled: pages[0] === 0 && pages.every((p, k) => p === k),
      onSelect: () =>
        void actions.pageOperation(label('Move'), (doc) => movePages(doc, pages, 0), {
          select: pages.map((_, k) => k),
          goTo: 0,
        }),
    },
    {
      label: many ? 'Move pages to last' : 'Move to last',
      disabled:
        pages[pages.length - 1] === pageCount - 1 &&
        pages.every((p, k) => p === pageCount - pages.length + k),
      onSelect: () =>
        void actions.pageOperation(label('Move'), (doc) => movePages(doc, pages, pageCount), {
          select: pages.map((_, k) => pageCount - pages.length + k),
          goTo: pageCount - pages.length,
        }),
    },
    { separator: true, label: '' },
    {
      label: many ? `Extract ${pages.length} pages…` : 'Extract page…',
      onSelect: async () => {
        const session = getSession();
        if (!session) return;
        const bytes = await extractPages(session.doc, pages);
        const base = session.file.name.replace(/\.pdf$/i, '');
        const suffix = many ? `p${pages[0]! + 1}-${pages[pages.length - 1]! + 1}` : `p${index + 1}`;
        downloadBytes(bytes, `${base}.${suffix}.pdf`, 'application/pdf');
        actions.setStatus(`Extracted ${pages.length} page${many ? 's' : ''}`);
      },
    },
    {
      label: label('Delete'),
      danger: true,
      disabled: pages.length >= pageCount,
      onSelect: () =>
        void actions.pageOperation(
          label('Delete'),
          (doc) => {
            deletePages(doc, pages);
          },
          { goTo: Math.max(0, Math.min(...pages)) },
        ),
    },
  ];
}
