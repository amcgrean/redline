/**
 * Review mode (PLAN §3.10, Ctrl+Shift+F): every panel and bar hidden, a floating minimal
 * toolbar, a laser-pointer cursor, page navigation. Escape leaves.
 */

import { useEffect, useState } from 'react';
import { actions, useEditorStore } from './store';

export function ReviewBar() {
  const currentPage = useEditorStore((s) => s.currentPage);
  const pageCount = useEditorStore((s) => s.pageCount);
  const laser = useEditorStore((s) => s.laser);
  return (
    <div className="review-bar" role="toolbar" aria-label="Review">
      <button
        type="button"
        aria-label="Previous page"
        disabled={currentPage === 0}
        onClick={actions.previousPage}
      >
        ‹
      </button>
      <span className="review-page" data-testid="review-page">
        {currentPage + 1} / {pageCount}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={currentPage >= pageCount - 1}
        onClick={actions.nextPage}
      >
        ›
      </button>
      <span className="sep" />
      <button type="button" onClick={() => actions.setZoomMode('fit-page')} title="Fit page">
        Fit
      </button>
      <button type="button" onClick={() => actions.setZoomMode('fit-width')} title="Fit width">
        Width
      </button>
      <button
        type="button"
        aria-pressed={laser}
        className={laser ? 'active' : ''}
        onClick={() => actions.toggleLaser()}
        title="Laser pointer (L)"
      >
        Laser
      </button>
      <span className="sep" />
      <button type="button" onClick={() => actions.toggleReview(false)} title="Exit review (Esc)">
        Exit
      </button>
    </div>
  );
}

/** A red dot that follows the pointer over the viewer while the laser is on. */
export function LaserPointer() {
  const [at, setAt] = useState<{ x: number; y: number } | undefined>();
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const over = (event.target as Element | null)?.closest('.viewer');
      setAt(over ? { x: event.clientX, y: event.clientY } : undefined);
    };
    const leave = () => setAt(undefined);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseleave', leave);
    };
  }, []);
  if (!at) return null;
  return <div className="laser-dot" data-testid="laser-dot" style={{ left: at.x, top: at.y }} />;
}
