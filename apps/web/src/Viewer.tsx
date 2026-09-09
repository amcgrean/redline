/**
 * Scrollable, zoomable page stack. Each page is rendered by pdf.js in tiles (no canvas
 * over 16 Mpx, PLAN §3.5) and overlaid with a Konva stage that covers only the visible
 * part of the page, so the markup canvas never grows with zoom either.
 *
 * Supports fit-page / fit-width zoom, continuous or single-page layout, and a view-only
 * rotation. Rotation goes through pdf.js's viewport, so the markup layer (which maps
 * user space through the same viewport) rotates with the page for free.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PdfjsDocument, PdfjsPage, PageViewport } from './pdfjs';
import { renderTile, tilesFor, type Tile } from './pdfjs';
import { MarkupLayer } from './MarkupLayer';
import { TextLayer } from './TextLayer';
import { FindHighlights } from './FindHighlights';
import { actions, useEditorStore } from './store';

const PAGE_GAP = 16;
/** Extra CSS pixels rendered around the visible area so scrolling does not flash. */
const RENDER_MARGIN = 256;

interface PageLayout {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
  viewport: PageViewport;
  page: PdfjsPage;
}

interface ScrollBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function intersect(a: ScrollBox, b: ScrollBox): ScrollBox | undefined {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

function viewportFor(page: PdfjsPage, scale: number, rotation: number): PageViewport {
  return page.getViewport({ scale, rotation: page.rotate + rotation });
}

/** The zoom that fits the widest page (fit-width) or the whole page (fit-page). */
function fittedZoom(
  pages: PdfjsPage[],
  rotation: number,
  mode: 'fit-page' | 'fit-width',
  clientWidth: number,
  clientHeight: number,
): number | undefined {
  if (pages.length === 0 || clientWidth <= 0 || clientHeight <= 0) return undefined;
  let widest = 0;
  let tallest = 0;
  for (const page of pages) {
    const { width, height } = viewportFor(page, 1, rotation);
    widest = Math.max(widest, width);
    tallest = Math.max(tallest, height);
  }
  const byWidth = (clientWidth - PAGE_GAP * 2) / widest;
  if (mode === 'fit-width') return byWidth;
  return Math.min(byWidth, (clientHeight - PAGE_GAP * 2) / tallest);
}

export function Viewer({ pdfjs }: { pdfjs: PdfjsDocument }) {
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const layoutMode = useEditorStore((s) => s.layoutMode);
  const rotation = useEditorStore((s) => s.viewRotation);
  const currentPage = useEditorStore((s) => s.currentPage);
  const scrollTo = useEditorStore((s) => s.scrollTo);
  const textMode = useEditorStore((s) => s.tool === 'text');
  const panTool = useEditorStore((s) => s.tool === 'pan');
  const spacePan = useEditorStore((s) => s.spacePan);
  const panning = panTool || spacePan;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PdfjsPage[]>([]);
  const [scroll, setScroll] = useState<ScrollBox>({ left: 0, top: 0, width: 0, height: 0 });

  // Load every page proxy once per document (cheap: no rendering yet).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded: PdfjsPage[] = [];
      for (let i = 1; i <= pdfjs.numPages; i += 1) loaded.push(await pdfjs.getPage(i));
      if (!cancelled) setPages(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfjs]);

  // Fit modes resolve against the scroll box; re-resolve when it or the pages change.
  useLayoutEffect(() => {
    if (zoomMode === 'custom') return;
    const el = scrollRef.current;
    if (!el) return;
    const subject = layoutMode === 'single' ? pages.filter((_, i) => i === currentPage) : pages;
    const fitted = fittedZoom(subject, rotation, zoomMode, el.clientWidth, el.clientHeight);
    if (fitted !== undefined) actions.applyFittedZoom(fitted);
  }, [pages, zoomMode, rotation, layoutMode, currentPage, scroll.width, scroll.height]);

  // Lay pages out in a vertical stack (or just the current one), centred on the widest.
  const layout = useMemo(() => {
    const shown = layoutMode === 'single' ? pages.filter((_, i) => i === currentPage) : pages;
    let top = PAGE_GAP;
    let maxWidth = 0;
    const items: PageLayout[] = shown.map((page) => {
      const viewport = viewportFor(page, zoom, rotation);
      const item = {
        index: pages.indexOf(page),
        top,
        left: 0,
        width: viewport.width,
        height: viewport.height,
        viewport,
        page,
      };
      top += viewport.height + PAGE_GAP;
      maxWidth = Math.max(maxWidth, viewport.width);
      return item;
    });
    for (const item of items) item.left = (maxWidth - item.width) / 2 + PAGE_GAP;
    return { items, width: maxWidth + PAGE_GAP * 2, height: top };
  }, [pages, zoom, rotation, layoutMode, currentPage]);

  const updateScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScroll({
      left: el.scrollLeft,
      top: el.scrollTop,
      width: el.clientWidth,
      height: el.clientHeight,
    });
  }, []);

  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateScroll);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [updateScroll]);

  // Continuous mode: the current page is the one a third of the way down the viewport.
  useEffect(() => {
    if (layoutMode !== 'continuous' || layout.items.length === 0) return;
    const probe = scroll.top + scroll.height / 3;
    let current = layout.items[0]!.index;
    for (const item of layout.items) {
      if (item.top <= probe) current = item.index;
      else break;
    }
    actions.setCurrentPage(current);
  }, [layout, layoutMode, scroll.top, scroll.height]);

  // Programmatic navigation (page input, PageUp/Down, Home/End, thumbnails).
  useEffect(() => {
    if (!scrollTo) return;
    const el = scrollRef.current;
    if (layoutMode === 'single') {
      actions.setCurrentPage(scrollTo.page);
      el?.scrollTo({ top: 0 });
    } else {
      const item = layout.items[scrollTo.page];
      if (el && item) el.scrollTo({ top: Math.max(0, item.top - PAGE_GAP), behavior: 'auto' });
    }
    actions.clearScrollRequest();
  }, [scrollTo, layout, layoutMode]);

  // The wheel zooms around the cursor (Revu's default); Shift+wheel scrolls natively.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.shiftKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = el.getBoundingClientRect();
      const cx = event.clientX - rect.left + el.scrollLeft;
      const cy = event.clientY - rect.top + el.scrollTop;
      actions.setZoom(zoom * factor);
      requestAnimationFrame(() => {
        el.scrollLeft = cx * factor - (event.clientX - rect.left);
        el.scrollTop = cy * factor - (event.clientY - rect.top);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // Drag-to-pan: the Pan tool, Space held, or the middle button from any tool.
  const drag = useRef<
    { pointerId: number; x: number; y: number; left: number; top: number } | undefined
  >(undefined);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const middle = event.button === 1;
    if (!(middle || (event.button === 0 && panning))) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.setPointerCapture(event.pointerId);
    el.classList.add('panning');
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const d = drag.current;
    if (!el || !d || d.pointerId !== event.pointerId) return;
    el.scrollLeft = d.left - (event.clientX - d.x);
    el.scrollTop = d.top - (event.clientY - d.y);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const d = drag.current;
    if (!el || !d || d.pointerId !== event.pointerId) return;
    drag.current = undefined;
    el.releasePointerCapture(event.pointerId);
    el.classList.remove('panning');
  };

  const visible = useMemo(
    () => ({
      left: scroll.left - RENDER_MARGIN,
      top: scroll.top - RENDER_MARGIN,
      width: scroll.width + RENDER_MARGIN * 2,
      height: scroll.height + RENDER_MARGIN * 2,
    }),
    [scroll],
  );

  return (
    <div
      className={`viewer${panning ? ' pan' : ''}`}
      ref={scrollRef}
      data-testid="viewer"
      data-layout={layoutMode}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={(e) => e.preventDefault()}
    >
      <div className="viewer-inner" style={{ width: layout.width, height: layout.height }}>
        {layout.items.map((item) => {
          const pageBox = {
            left: item.left,
            top: item.top,
            width: item.width,
            height: item.height,
          };
          const region = intersect(pageBox, visible);
          return (
            <div
              key={item.index}
              className="page"
              data-page={item.index + 1}
              style={{ left: item.left, top: item.top, width: item.width, height: item.height }}
            >
              {region && (
                <PageTiles
                  page={item.page}
                  viewport={item.viewport}
                  cacheKey={`${zoom}:${rotation}`}
                  visible={{
                    left: region.left - item.left,
                    top: region.top - item.top,
                    width: region.width,
                    height: region.height,
                  }}
                />
              )}
              {region && <FindHighlights pageIndex={item.index} viewport={item.viewport} />}
              {region && textMode && <TextLayer page={item.page} viewport={item.viewport} />}
              {region && (
                <MarkupLayer
                  pageIndex={item.index}
                  viewport={item.viewport}
                  visible={{
                    left: Math.max(0, scroll.left - item.left),
                    top: Math.max(0, scroll.top - item.top),
                    width:
                      Math.min(item.width, scroll.left + scroll.width - item.left) -
                      Math.max(0, scroll.left - item.left),
                    height:
                      Math.min(item.height, scroll.top + scroll.height - item.top) -
                      Math.max(0, scroll.top - item.top),
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PageTilesProps {
  page: PdfjsPage;
  viewport: PageViewport;
  /** Anything that invalidates every tile: zoom and rotation. */
  cacheKey: string;
  visible: ScrollBox;
}

/** Renders the tiles of one page that intersect `visible`, caching canvases per zoom. */
function PageTiles({ page, viewport, cacheKey, visible }: PageTilesProps) {
  const dpr = window.devicePixelRatio || 1;
  const tiles = useMemo(() => tilesFor(viewport.width, viewport.height, dpr), [viewport, dpr]);
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const cacheKeyRef = useRef<{ key: string; page: PdfjsPage }>({ key: cacheKey, page });
  const hostRef = useRef<HTMLDivElement>(null);
  const inflight = useRef(new Set<string>());
  const failures = useRef(new Map<string, number>());
  const [, force] = useState(0);

  // A new zoom/rotation or a new page proxy (the document was re-opened) invalidates every tile.
  if (cacheKeyRef.current.key !== cacheKey || cacheKeyRef.current.page !== page) {
    cache.current.clear();
    inflight.current.clear();
    failures.current.clear();
    cacheKeyRef.current = { key: cacheKey, page };
  }

  const needed = tiles.filter((t) =>
    intersect({ left: t.x, top: t.y, width: t.width, height: t.height }, visible),
  );

  useEffect(() => {
    let cancelled = false;
    for (const tile of needed) {
      const key = `${tile.x}:${tile.y}`;
      if (cache.current.has(key) || inflight.current.has(key)) continue;
      if ((failures.current.get(key) ?? 0) >= 3) continue;
      inflight.current.add(key);
      const canvas = document.createElement('canvas');
      canvas.className = 'tile';
      canvas.style.left = `${tile.x}px`;
      canvas.style.top = `${tile.y}px`;
      renderTile(page, viewport, tile, dpr, canvas)
        .then(() => {
          if (cancelled) return;
          cache.current.set(key, canvas);
          force((n) => n + 1);
        })
        .catch(() => {
          // A render can fail when the document is swapped mid-flight; retry a few times.
          const count = (failures.current.get(key) ?? 0) + 1;
          failures.current.set(key, count);
          if (count < 3 && !cancelled) setTimeout(() => force((n) => n + 1), 100);
        })
        .finally(() => inflight.current.delete(key));
    }
    return () => {
      cancelled = true;
    };
  });

  // Attach cached canvases directly; React only manages the host div.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wanted = new Set(needed.map((t) => `${t.x}:${t.y}`));
    for (const child of Array.from(host.children)) {
      const key = child.getAttribute('data-key');
      if (key && !wanted.has(key)) host.removeChild(child);
    }
    for (const tile of needed) {
      const key = `${tile.x}:${tile.y}`;
      const canvas = cache.current.get(key);
      if (!canvas || canvas.parentElement === host) continue;
      canvas.setAttribute('data-key', key);
      host.appendChild(canvas);
    }
  });

  return <div ref={hostRef} className="tiles" style={{ position: 'absolute', inset: 0 }} />;
}

export type { Tile };
