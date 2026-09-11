/**
 * Page thumbnails (the Pages panel body). Rendered lazily by pdf.js as they scroll into
 * view, cached per document/page/rotation, click to navigate and select, Ctrl/Shift for
 * multi-select, drag to reorder. Annotations are drawn by pdf.js here (annotationMode
 * default) because a thumbnail is a preview, not the editing surface.
 */

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { movePages } from '@redline/pdf-core';
import type { PdfjsDocument } from './pdfjs';
import { actions, useEditorStore } from './store';

const THUMB_WIDTH = 132;
const CACHE_LIMIT = 600;

const cache = new Map<string, HTMLCanvasElement>();

/** A stable id per pdf.js document object: a full save can keep the same fingerprint. */
const docIds = new WeakMap<PdfjsDocument, number>();
let nextDocId = 1;
function docKey(pdfjs: PdfjsDocument): string {
  let id = docIds.get(pdfjs);
  if (!id) {
    id = nextDocId;
    nextDocId += 1;
    docIds.set(pdfjs, id);
  }
  return `${pdfjs.fingerprints[0]}#${id}`;
}

function remember(key: string, canvas: HTMLCanvasElement): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, canvas);
}

async function renderThumbnail(
  pdfjs: PdfjsDocument,
  pageNumber: number,
  rotation: number,
): Promise<HTMLCanvasElement> {
  const key = `${docKey(pdfjs)}:${pageNumber}:${rotation}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const page = await pdfjs.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = THUMB_WIDTH / base.width;
  const viewport = page.getViewport({ scale: scale * dpr, rotation: page.rotate + rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  remember(key, canvas);
  return canvas;
}

interface ThumbProps {
  pdfjs: PdfjsDocument;
  pageNumber: number;
  rotation: number;
  current: boolean;
  selected: boolean;
  aspect: number;
  dropSide?: 'before' | 'after';
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

function Thumb({
  pdfjs,
  pageNumber,
  rotation,
  current,
  selected,
  aspect,
  dropSide,
  onDragStart,
  onDragOver,
  onDrop,
}: ThumbProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void renderThumbnail(pdfjs, pageNumber, rotation).then((canvas) => {
      const el = host.current;
      if (cancelled || !el) return;
      el.replaceChildren(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, pdfjs, pageNumber, rotation]);

  useEffect(() => {
    if (current) host.current?.parentElement?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const classes = ['thumb'];
  if (current) classes.push('current');
  if (selected) classes.push('selected');
  if (dropSide) classes.push(`drop-${dropSide}`);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-label={`Page ${pageNumber}`}
      aria-current={current ? 'page' : undefined}
      aria-pressed={selected}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(e) => {
        const index = pageNumber - 1;
        if (e.ctrlKey || e.metaKey) actions.togglePageSelection(index);
        else if (e.shiftKey) actions.extendPageSelection(index);
        else actions.selectPages([index]);
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) actions.goToPage(index);
      }}
    >
      <div
        ref={host}
        className="thumb-canvas"
        style={{ width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * aspect) }}
      />
      <span className="thumb-label">{pageNumber}</span>
    </button>
  );
}

export function Thumbnails({ pdfjs }: { pdfjs: PdfjsDocument }) {
  const currentPage = useEditorStore((s) => s.currentPage);
  const rotation = useEditorStore((s) => s.viewRotation);
  const selection = useEditorStore((s) => s.pageSelection);
  const [aspects, setAspects] = useState<number[]>([]);
  const [drop, setDrop] = useState<{ index: number; side: 'before' | 'after' }>();
  const dragging = useRef<number[]>([]);

  // Height/width per page so placeholders have the right shape before rendering.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: number[] = [];
      for (let i = 1; i <= pdfjs.numPages; i += 1) {
        const page = await pdfjs.getPage(i);
        const v = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
        out.push(v.height / v.width);
      }
      if (!cancelled) setAspects(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfjs, rotation]);

  const onDragStart = (index: number) => (event: DragEvent<HTMLElement>) => {
    const moving = selection.includes(index) ? [...selection] : [index];
    dragging.current = moving;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', moving.join(','));
  };
  const onDragOver = (index: number) => (event: DragEvent<HTMLElement>) => {
    if (dragging.current.length === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const side = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
    if (drop?.index !== index || drop.side !== side) setDrop({ index, side });
  };
  const onDrop = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const moving = dragging.current;
    dragging.current = [];
    setDrop(undefined);
    if (moving.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const target = event.clientY < box.top + box.height / 2 ? index : index + 1;
    // No-op when the block would land where it already is.
    const before = moving.filter((i) => i < target).length;
    const insertAt = target - before;
    if (moving.every((i, k) => i === insertAt + k)) return;
    void actions.pageOperation(
      moving.length === 1 ? 'Reorder page' : `Reorder ${moving.length} pages`,
      (doc) => movePages(doc, moving, target),
      { select: moving.map((_, k) => insertAt + k), goTo: insertAt },
    );
  };

  return (
    <div className="thumbnails" aria-label="Pages" onDragLeave={() => setDrop(undefined)}>
      {aspects.map((aspect, i) => (
        <Thumb
          key={i}
          pdfjs={pdfjs}
          pageNumber={i + 1}
          rotation={rotation}
          current={i === currentPage}
          selected={selection.includes(i)}
          aspect={aspect}
          dropSide={drop?.index === i ? drop.side : undefined}
          onDragStart={onDragStart(i)}
          onDragOver={onDragOver(i)}
          onDrop={onDrop(i)}
        />
      ))}
    </div>
  );
}
