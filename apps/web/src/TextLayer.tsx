/**
 * pdf.js text layer for one page: transparent spans positioned over the glyphs so the
 * browser's own selection and copy work. Mounted only while the Text tool is active, so
 * the (much larger) tiled page stays cheap the rest of the time.
 */

import { useEffect, useRef } from 'react';
import { TextLayer as PdfjsTextLayer } from 'pdfjs-dist';
import type { PdfjsPage, PageViewport } from './pdfjs';

export function TextLayer({ page, viewport }: { page: PdfjsPage; viewport: PageViewport }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    container.replaceChildren();
    container.style.setProperty('--scale-factor', String(viewport.scale));
    const layer = new PdfjsTextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    let cancelled = false;
    layer.render().catch(() => undefined);
    return () => {
      cancelled = true;
      if (!cancelled) return;
      layer.cancel();
      container.replaceChildren();
    };
  }, [page, viewport]);

  return <div ref={host} className="textLayer" data-testid="text-layer" />;
}
