/**
 * The shell: one plain page with a drop zone, the viewer, and a toolbar. Panels, tool
 * chest and menus arrive later in Phase 1/2; this pass adds undo/redo, zoom presets,
 * page navigation and the Appendix B shortcuts.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Viewer } from './Viewer';
import { actions, useEditor, type Tool, type ZoomMode } from './store';
import { pickFileHandle, saveBytes, supportsSaveInPlace, type FileHandleLike } from './fileTarget';
import { formatFeetInches, worldUnitsPerPoint } from '@redline/pdf-core';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select (V)', hint: 'Click a markup to select it, then drag to move.' },
  {
    id: 'calibrate',
    label: 'Calibrate (X)',
    hint: 'Click two points a known distance apart, then type the distance.',
  },
  { id: 'length', label: 'Length (M)', hint: 'Click the two ends of the run.' },
  {
    id: 'area',
    label: 'Area (A)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish. Esc cancels.',
  },
];

async function openFile(file: File, handle?: FileHandleLike): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await actions.open(bytes, handle ? { name: file.name, handle } : { name: file.name });
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** PLAN Appendix B, the subset the shell supports today. */
function handleShortcut(event: KeyboardEvent, hasDoc: boolean, dirty: boolean): void {
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && key === 's') {
    event.preventDefault();
    if (hasDoc && dirty) void actions.save(saveBytes);
    return;
  }
  if (ctrl && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    actions.undo();
    return;
  }
  if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
    event.preventDefault();
    actions.redo();
    return;
  }
  if (!hasDoc) return;

  if (ctrl && (key === '=' || key === '+')) {
    event.preventDefault();
    actions.zoomIn();
    return;
  }
  if (ctrl && key === '-') {
    event.preventDefault();
    actions.zoomOut();
    return;
  }
  if (ctrl && key === '0') {
    event.preventDefault();
    actions.setZoomMode('custom');
    return;
  }
  if (event.shiftKey && !ctrl) {
    // Shift+digit reports "!" / "@" as key; use the physical key instead.
    if (event.code === 'Digit1') return actions.setZoomMode('fit-page');
    if (event.code === 'Digit2') return actions.setZoomMode('fit-width');
    if (event.code === 'Digit0') return actions.setZoomMode('custom');
  }
  if (event.key === 'PageDown') {
    event.preventDefault();
    return actions.nextPage();
  }
  if (event.key === 'PageUp') {
    event.preventDefault();
    return actions.previousPage();
  }
  if (event.key === 'Home' && ctrl) return actions.goToPage(0);
  if (event.key === 'End' && ctrl) return actions.goToPage(Number.MAX_SAFE_INTEGER);

  if (ctrl || event.altKey) return;
  const map: Record<string, Tool> = { v: 'select', x: 'calibrate', m: 'length', a: 'area' };
  const next = map[key];
  if (next) actions.setTool(next);
}

export function App() {
  const state = useEditor();
  const [over, setOver] = useState(false);
  const {
    doc,
    pdfjs,
    tool,
    dirty,
    status,
    zoom,
    zoomMode,
    selectedId,
    hasDoc,
    pageCount,
    currentPage,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
  } = state;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleShortcut(event, hasDoc, dirty);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasDoc, dirty]);

  // Dev convenience: `?fixture=<name>` opens a file from `fixtures/` (served by vite.config.ts).
  // The ref guards against StrictMode's double effect run, which would open the file twice.
  const fixtureRequested = useRef(false);
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get('fixture');
    if (!name || fixtureRequested.current) return;
    fixtureRequested.current = true;
    void (async () => {
      const response = await fetch(`/__fixtures/${encodeURIComponent(name)}`);
      if (!response.ok) {
        actions.setStatus(`Fixture not found: ${name}`);
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await actions.open(bytes, { name });
    })();
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onDrop = useCallback(async (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) await openFile(file);
  }, []);

  const onPick = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await openFile(file);
    event.target.value = '';
  }, []);

  const onOpenInPlace = useCallback(async () => {
    const handle = await pickFileHandle();
    if (!handle) return;
    await openFile(await handle.getFile(), handle);
  }, []);

  const selected = doc?.markups.find((m) => m.id === selectedId);
  const pageScale = doc?.pageScales.get(currentPage);

  const zoomSelectValue = zoomMode === 'custom' ? 'custom' : zoomMode;
  const onZoomSelect = (value: string) => {
    if (value === '100') actions.setZoomMode('custom');
    else actions.setZoomMode(value as ZoomMode);
  };

  return (
    <>
      <div className="toolbar">
        <strong>Redline</strong>
        <label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={onPick}
            style={{ display: 'none' }}
          />
          <span role="button" className="linklike">
            Open…
          </span>
        </label>
        {supportsSaveInPlace() && (
          <button
            type="button"
            onClick={onOpenInPlace}
            title="Open with a writable handle so Save writes in place"
          >
            Open (save in place)…
          </button>
        )}
        <span className="sep" />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'active' : ''}
            disabled={!hasDoc}
            onClick={() => actions.setTool(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
        <span className="sep" />
        <button
          type="button"
          disabled={!canUndo}
          onClick={actions.undo}
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
          aria-label="Undo"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={actions.redo}
          title={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
          aria-label="Redo"
        >
          ↷ Redo
        </button>
        <span className="sep" />
        <button type="button" disabled={!hasDoc} onClick={actions.zoomOut} aria-label="Zoom out">
          −
        </button>
        <span className="status" style={{ minWidth: 48, textAlign: 'center' }} aria-label="Zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" disabled={!hasDoc} onClick={actions.zoomIn} aria-label="Zoom in">
          +
        </button>
        <select
          value={zoomSelectValue}
          disabled={!hasDoc}
          onChange={(e) => onZoomSelect(e.target.value)}
          aria-label="Zoom preset"
          title="Fit page: Shift+1 · Fit width: Shift+2 · 100%: Ctrl+0"
        >
          <option value="fit-page">Fit page</option>
          <option value="fit-width">Fit width</option>
          <option value="custom">Custom</option>
          <option value="100">100%</option>
        </select>
        <span className="sep" />
        <button
          type="button"
          disabled={!hasDoc || currentPage === 0}
          onClick={actions.previousPage}
          aria-label="Previous page"
          title="PageUp"
        >
          ‹
        </button>
        <label className="page-indicator">
          <input
            type="number"
            min={1}
            max={Math.max(1, pageCount)}
            disabled={!hasDoc}
            value={hasDoc ? currentPage + 1 : ''}
            aria-label="Page"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) actions.goToPage(n - 1);
            }}
          />{' '}
          of {pageCount || '–'}
        </label>
        <button
          type="button"
          disabled={!hasDoc || currentPage >= pageCount - 1}
          onClick={actions.nextPage}
          aria-label="Next page"
          title="PageDown"
        >
          ›
        </button>
        <span className="sep" />
        <button
          type="button"
          disabled={!hasDoc || !dirty}
          onClick={() => void actions.save(saveBytes)}
          title="Ctrl+S"
        >
          Save{dirty ? ' *' : ''}
        </button>
        <span className="spacer" />
        <span className="status">{status}</span>
      </div>
      <div className="hint">
        {hasDoc
          ? TOOLS.find((t) => t.id === tool)?.hint
          : 'Drop a PDF (try a Revu-marked set) or use Open.'}
        {hasDoc && (
          <>
            {' '}
            · page {currentPage + 1} scale:{' '}
            {pageScale
              ? `1 in = ${pageScale.scale.worldLength.toFixed(3)} ft (${
                  pageScale.fromDocument ? 'from document' : 'calibrated'
                }) · ${formatFeetInches(worldUnitsPerPoint(pageScale.scale) * 72)} per inch`
              : 'not set'}
          </>
        )}
        {selected && (
          <>
            {' '}
            · selected {selected.rawSubtype}
            {selected.intent ? `/${selected.intent}` : ''}{' '}
            {selected.text?.subject ? `“${selected.text.subject}”` : ''}
            {selected.text?.contents ? ` ${selected.text.contents}` : ''} · /NM {selected.id}
          </>
        )}
      </div>
      {doc && pdfjs ? (
        <Viewer key={pdfjs.doc.fingerprints[0] ?? 'doc'} pdfjs={pdfjs.doc} />
      ) : (
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          Drop a PDF here
        </div>
      )}
    </>
  );
}
