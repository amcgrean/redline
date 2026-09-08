/**
 * The POC shell: one plain page with a drop zone, the viewer, and three tool buttons.
 * Panels, tool chest and menus arrive in Phase 1 (docs/POC-KICKOFF.md).
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Viewer } from './Viewer';
import { actions, useEditor, type Tool } from './store';
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

export function App() {
  const state = useEditor();
  const [over, setOver] = useState(false);
  const { doc, pdfjs, tool, dirty, status, zoom, selectedId } = state;

  // Single-key tools, as in PLAN Appendix B.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (doc) void actions.save(saveBytes);
        return;
      }
      const map: Record<string, Tool> = { v: 'select', x: 'calibrate', m: 'length', a: 'area' };
      const next = map[event.key.toLowerCase()];
      if (next && !event.ctrlKey && !event.metaKey) actions.setTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc]);

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
  const firstScale = doc ? [...doc.pageScales.entries()].sort((a, b) => a[0] - b[0])[0] : undefined;

  return (
    <>
      <div className="toolbar">
        <strong>Redline POC</strong>
        <label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={onPick}
            style={{ display: 'none' }}
          />
          <span
            role="button"
            className="linklike"
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
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
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'active' : ''}
            disabled={!doc}
            onClick={() => actions.setTool(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
        <button type="button" disabled={!doc} onClick={() => actions.setZoom(zoom / 1.25)}>
          −
        </button>
        <span className="status" style={{ minWidth: 48, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" disabled={!doc} onClick={() => actions.setZoom(zoom * 1.25)}>
          +
        </button>
        <button
          type="button"
          disabled={!doc || !dirty}
          onClick={() => void actions.save(saveBytes)}
          title="Ctrl+S"
        >
          Save{dirty ? ' *' : ''}
        </button>
        <span className="spacer" />
        <span className="status">{status}</span>
      </div>
      <div className="hint">
        {doc
          ? TOOLS.find((t) => t.id === tool)?.hint
          : 'Drop a PDF (try a Revu-marked set) or use Open.'}
        {firstScale && (
          <>
            {' '}
            · page {firstScale[0] + 1} scale: 1 in = {firstScale[1].scale.worldLength.toFixed(3)} ft
            ({firstScale[1].fromDocument ? 'from document' : 'calibrated'}) ·{' '}
            {formatFeetInches(worldUnitsPerPoint(firstScale[1].scale) * 72)} per inch
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
