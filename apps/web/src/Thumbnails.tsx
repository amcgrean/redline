/**
 * Page thumbnails. Rendered lazily by pdf.js as they scroll into view, cached per
 * document/page/rotation, click to navigate. Annotations are drawn by pdf.js here
 * (annotationMode default) because a thumbnail is a preview, not the editing surface.
 */

import { useEffect, useRef, useState } from 'react';
import type { PdfjsDocument } from './pdfjs';
import { actions, useEditorStore } from './store';

const THUMB_WIDTH = 132;
const CACHE_LIMIT = 600;

const cache = new Map<string, HTMLCanvasElement>();

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
  const key = `${pdfjs.fingerprints[0]}:${pageNumber}:${rotation}`;
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
  aspect: number;
}

function Thumb({ pdfjs, pageNumber, rotation, current, aspect }: ThumbProps) {
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

  return (
    <button
      type="button"
      className={`thumb${current ? ' current' : ''}`}
      aria-label={`Page ${pageNumber}`}
      aria-current={current ? 'page' : undefined}
      onClick={() => actions.goToPage(pageNumber - 1)}
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
  const [aspects, setAspects] = useState<number[]>([]);

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

  return (
    <div className="thumbnails" aria-label="Pages">
      {aspects.map((aspect, i) => (
        <Thumb
          key={i}
          pdfjs={pdfjs}
          pageNumber={i + 1}
          rotation={rotation}
          current={i === currentPage}
          aspect={aspect}
        />
      ))}
    </div>
  );
}
