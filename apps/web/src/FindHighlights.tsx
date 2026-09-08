/**
 * Search-hit highlights for one page, positioned through the page viewport so they
 * follow zoom and rotation like everything else.
 */

import type { PageViewport } from './pdfjs';
import { useEditorStore } from './store';

export function FindHighlights({
  pageIndex,
  viewport,
}: {
  pageIndex: number;
  viewport: PageViewport;
}) {
  const hits = useEditorStore((s) => s.find.hits);
  const current = useEditorStore((s) => s.find.index);
  const open = useEditorStore((s) => s.find.open);
  if (!open || hits.length === 0) return null;

  return (
    <div className="find-highlights" aria-hidden="true">
      {hits.map((hit, i) => {
        if (hit.page !== pageIndex) return null;
        const [ax, ay] = viewport.convertToViewportPoint(hit.x0, hit.y0);
        const [bx, by] = viewport.convertToViewportPoint(hit.x1, hit.y1);
        const left = Math.min(ax, bx);
        const top = Math.min(ay, by);
        return (
          <div
            key={i}
            className={`find-hit${i === current ? ' current' : ''}`}
            data-testid="find-hit"
            style={{
              left,
              top,
              width: Math.max(2, Math.abs(bx - ax)),
              height: Math.max(2, Math.abs(by - ay)),
            }}
          />
        );
      })}
    </div>
  );
}
