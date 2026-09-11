/**
 * Inline text editor: a textarea positioned over a page rectangle (page-local CSS px),
 * used to type a new text box / callout / note or to edit an existing one.
 * Ctrl+Enter or clicking away commits; Escape cancels; a note is single-line (Enter commits).
 */

import { useEffect, useRef, useState } from 'react';

export interface TextEditorProps {
  left: number;
  top: number;
  width: number;
  height: number;
  /** CSS font size (already zoom-scaled). */
  fontSize: number;
  initial: string;
  singleLine?: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function TextEditor({
  left,
  top,
  width,
  height,
  fontSize,
  initial,
  singleLine,
  onCommit,
  onCancel,
}: TextEditorProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const text = value.trim();
    if (text) onCommit(text);
    else onCancel();
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Markup text"
      value={value}
      style={{
        left,
        top,
        width: Math.max(60, width),
        height: Math.max(fontSize * 1.6, height),
        fontSize,
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || singleLine)) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}
