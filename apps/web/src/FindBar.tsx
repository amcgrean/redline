/**
 * Find in document (Ctrl+F). Runs the search over the cached text index and steps
 * through hits; the viewer draws the highlights.
 */

import { useEffect, useRef, useState } from 'react';
import { actions, useEditor, useEditorStore } from './store';
import { searchDocument } from './text/textIndex';

export function FindBar() {
  const { pdfjs } = useEditor();
  const open = useEditorStore((s) => s.find.open);
  const hits = useEditorStore((s) => s.find.hits);
  const index = useEditorStore((s) => s.find.index);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Debounced search as the user types.
  useEffect(() => {
    if (!open || !pdfjs) return;
    const id = (requestId.current += 1);
    const timer = setTimeout(() => {
      void searchDocument(pdfjs.doc, query).then((found) => {
        if (requestId.current === id) actions.setFindResults(query, found);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, query, pdfjs]);

  if (!open) return null;

  const count = hits.length;
  const position = count ? `${index + 1} of ${count}` : query.trim() ? 'No matches' : '';

  return (
    <div className="findbar" role="search" aria-label="Find in document">
      <input
        ref={input}
        value={query}
        placeholder="Find in document"
        aria-label="Find text"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) actions.findPrevious();
            else actions.findNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            actions.closeFind();
          }
        }}
      />
      <span className="find-count" aria-live="polite">
        {position}
      </span>
      <button
        type="button"
        onClick={actions.findPrevious}
        disabled={!count}
        aria-label="Previous match"
        title="Shift+Enter"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={actions.findNext}
        disabled={!count}
        aria-label="Next match"
        title="Enter"
      >
        ↓
      </button>
      <button type="button" onClick={actions.closeFind} aria-label="Close find" title="Esc">
        ×
      </button>
    </div>
  );
}
