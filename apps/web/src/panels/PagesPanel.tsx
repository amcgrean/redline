/**
 * Pages panel (PLAN §3.9): thumbnails with a toolbar for rotate, delete, move to
 * first/last, insert blank, insert from PDF, extract. Every operation is a full rewrite
 * of the document behind the scenes (pdf-core `saveFull`), with its own undo.
 */

import { useRef } from 'react';
import {
  deletePages,
  extractPages,
  insertBlankPage,
  insertPagesFrom,
  movePages,
  rotatePages,
} from '@redline/pdf-core';
import type { PdfjsDocument } from '../pdfjs';
import { actions, getSession, useEditorStore } from '../store';
import { Thumbnails } from '../Thumbnails';
import { downloadBytes } from '../download';

export function PagesPanel({ pdfjs }: { pdfjs: PdfjsDocument }) {
  const selection = useEditorStore((s) => s.pageSelection);
  const currentPage = useEditorStore((s) => s.currentPage);
  const pageCount = useEditorStore((s) => s.pageCount);
  const busy = useEditorStore((s) => s.pageBusy);
  const fileInput = useRef<HTMLInputElement>(null);

  /** The pages an operation applies to: the selection, else the current page. */
  const targets = (): number[] =>
    selection.length ? [...selection].sort((a, b) => a - b) : [currentPage];
  const label = (verb: string) => {
    const n = targets().length;
    return n === 1 ? `${verb} page` : `${verb} ${n} pages`;
  };
  const insertAt = () => Math.max(...targets()) + 1;

  return (
    <div className="pages-panel">
      <div className="pages-toolbar" role="toolbar" aria-label="Page operations">
        <span className="muted small">
          {selection.length ? `${selection.length} selected` : `page ${currentPage + 1}`} of{' '}
          {pageCount}
        </span>
        <div className="pages-buttons">
          <button
            type="button"
            disabled={busy}
            title="Rotate left 90°"
            aria-label="Rotate left"
            onClick={() => {
              const pages = targets();
              void actions.pageOperation(label('Rotate'), (doc) => rotatePages(doc, pages, -90), {
                select: pages,
              });
            }}
          >
            ⟲
          </button>
          <button
            type="button"
            disabled={busy}
            title="Rotate right 90°"
            aria-label="Rotate right"
            onClick={() => {
              const pages = targets();
              void actions.pageOperation(label('Rotate'), (doc) => rotatePages(doc, pages, 90), {
                select: pages,
              });
            }}
          >
            ⟳
          </button>
          <button
            type="button"
            disabled={busy || targets().length >= pageCount}
            title="Delete the selected pages"
            aria-label="Delete pages"
            onClick={() => {
              const pages = targets();
              void actions.pageOperation(
                label('Delete'),
                (doc) => {
                  deletePages(doc, pages);
                },
                { goTo: Math.max(0, Math.min(...pages)) },
              );
            }}
          >
            Delete
          </button>
          <button
            type="button"
            disabled={busy}
            title="Move the selected pages to the front"
            aria-label="Move to first"
            onClick={() => {
              const pages = targets();
              void actions.pageOperation(label('Move'), (doc) => movePages(doc, pages, 0), {
                select: pages.map((_, k) => k),
                goTo: 0,
              });
            }}
          >
            ⤒ First
          </button>
          <button
            type="button"
            disabled={busy}
            title="Move the selected pages to the end"
            aria-label="Move to last"
            onClick={() => {
              const pages = targets();
              void actions.pageOperation(label('Move'), (doc) => movePages(doc, pages, pageCount), {
                select: pages.map((_, k) => pageCount - pages.length + k),
                goTo: pageCount - pages.length,
              });
            }}
          >
            ⤓ Last
          </button>
          <button
            type="button"
            disabled={busy}
            title="Insert a blank page after the selection"
            aria-label="Insert blank page"
            onClick={() => {
              const at = insertAt();
              const size = getSession()?.doc.pageSizes[currentPage];
              void actions.pageOperation(
                'Insert blank page',
                (doc) => insertBlankPage(doc, at, size ? [size.width, size.height] : undefined),
                { select: [at], goTo: at },
              );
            }}
          >
            + Blank
          </button>
          <button
            type="button"
            disabled={busy}
            title="Insert the pages of another PDF after the selection"
            onClick={() => fileInput.current?.click()}
          >
            + PDF…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Insert PDF"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const bytes = new Uint8Array(await file.arrayBuffer());
              const at = insertAt();
              let added = 0;
              await actions.pageOperation(
                `Insert ${file.name}`,
                async (doc) => {
                  added = await insertPagesFrom(doc, bytes, at);
                },
                { goTo: at },
              );
              if (added) actions.selectPages(Array.from({ length: added }, (_, k) => at + k));
            }}
          />
          <button
            type="button"
            disabled={busy}
            title="Lossless optimize through qpdf, with a size preview"
            aria-label="Compress"
            onClick={() => void actions.optimize()}
          >
            Compress…
          </button>
          <button
            type="button"
            disabled={busy}
            title="Download a copy with every markup baked into the pages"
            aria-label="Flatten copy"
            onClick={() => void actions.exportFlattened()}
          >
            Flatten copy…
          </button>
          <button
            type="button"
            disabled={busy}
            title="Save the selected pages as a new PDF"
            aria-label="Extract pages"
            onClick={async () => {
              const session = getSession();
              if (!session) return;
              const pages = targets();
              const bytes = await extractPages(session.doc, pages);
              const base = session.file.name.replace(/\.pdf$/i, '');
              const suffix =
                pages.length === 1
                  ? `p${pages[0]! + 1}`
                  : `p${pages[0]! + 1}-${pages[pages.length - 1]! + 1}`;
              downloadBytes(bytes, `${base}.${suffix}.pdf`, 'application/pdf');
              actions.setStatus(`Extracted ${pages.length} page${pages.length === 1 ? '' : 's'}`);
            }}
          >
            Extract…
          </button>
        </div>
        <div className="muted small">Click to select · Ctrl/Shift for more · drag to reorder</div>
      </div>
      <Thumbnails pdfjs={pdfjs} />
    </div>
  );
}
