/**
 * The shell: toolbar, document tabs, viewer, and the empty state with recents.
 * Panels, tool chest and menus arrive later in Phase 1/2.
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Viewer } from './Viewer';
import { Panel } from './panels/Panel';
import { Recents } from './Recents';
import { FindBar } from './FindBar';
import { ShortcutHelp } from './ShortcutHelp';
import { ProfileDialog } from './ProfileDialog';
import { CompressDialog } from './CompressDialog';
import { MenuBar } from './MenuBar';
import { LaserPointer, ReviewBar } from './ReviewMode';
import { Recover } from './Recover';
import {
  actions,
  useEditor,
  type LayoutMode,
  type Tool,
  type ZoomMode,
  useEditorStore,
} from './store';
import {
  handleFromDrop,
  pickFileHandle,
  saveBytes,
  supportsSaveInPlace,
  type FileHandleLike,
} from './fileTarget';
import type { RecentEntry } from './db';
import { formatFeetInches, worldUnitsPerPoint } from '@redline/pdf-core';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select (V)', hint: 'Click a markup to select it, then drag to move.' },
  {
    id: 'pan',
    label: 'Pan (H)',
    hint: 'Drag to move the view. Hold Space from any tool, or drag with the middle button. Scroll wheel zooms.',
  },
  {
    id: 'text',
    label: 'Select Text',
    hint: 'Drag across page text to select it; Ctrl+C copies.',
  },
  {
    id: 'calibrate',
    label: 'Calibrate (X)',
    hint: 'Click two points a known distance apart, then type the distance.',
  },
  { id: 'length', label: 'Length (M)', hint: 'Click the two ends of the run.' },
  {
    id: 'polylength',
    label: 'Polylength (Shift+M)',
    hint: 'Click each turn of the run; double-click or press Enter to finish. Esc cancels.',
  },
  {
    id: 'area',
    label: 'Area (A)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish. Esc cancels.',
  },
  {
    id: 'perimeter',
    label: 'Perimeter (Shift+A)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to close the loop.',
  },
  {
    id: 'rectarea',
    label: 'Rect Area',
    hint: 'Click two opposite corners of the rectangle.',
  },
  {
    id: 'count',
    label: 'Count (C)',
    hint: 'Click each item to count it. Re-select the tool to start a new group.',
  },
  { id: 'rectangle', label: 'Rect (R)', hint: 'Press and drag a rectangle.' },
  { id: 'ellipse', label: 'Ellipse (E)', hint: 'Press and drag an ellipse.' },
  { id: 'line', label: 'Line (L)', hint: 'Click the two ends.' },
  { id: 'arrow', label: 'Arrow (Shift+L)', hint: 'Click the tail, then the head.' },
  {
    id: 'polygon',
    label: 'Polygon (G)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish.',
  },
  { id: 'pen', label: 'Pen (P)', hint: 'Press and drag to draw freehand.' },
  {
    id: 'cloud',
    label: 'Cloud (Shift+G)',
    hint: 'Click each corner; click the first corner again, double-click, or press Enter to finish.',
  },
  {
    id: 'highlighter',
    label: 'Highlighter (Shift+H)',
    hint: 'Press and drag to highlight; it multiplies over the drawing.',
  },
  {
    id: 'textbox',
    label: 'Text Box (T)',
    hint: 'Drag a box (or click for a default one), type, then Ctrl+Enter or click away.',
  },
  {
    id: 'callout',
    label: 'Callout (K)',
    hint: 'Click what to point at, then drag the box and type.',
  },
  {
    id: 'stamp',
    label: 'Stamp (S)',
    hint: 'Click where the top-left of the stamp goes. Pick a stamp in the Tools panel.',
  },
  { id: 'note', label: 'Note (N)', hint: 'Click to place a sticky note, type, press Enter.' },
];

async function openFile(file: File, handle?: FileHandleLike): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await actions.open(bytes, handle ? { name: file.name, handle } : { name: file.name });
}

async function openHandle(handle: FileHandleLike): Promise<void> {
  const permission = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (permission !== 'granted') {
    actions.setStatus(`Permission to open ${handle.name} was not granted`);
    return;
  }
  await openFile(await handle.getFile(), handle);
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
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
  if (ctrl && event.shiftKey && key === 'f') {
    event.preventDefault();
    if (hasDoc) actions.toggleReview();
    return;
  }
  if (useEditorStore.getState().review) {
    if (event.key === 'Escape') return actions.toggleReview(false);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return actions.nextPage();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return actions.previousPage();
    if (key === 'l' && !ctrl) return actions.toggleLaser();
  }
  if (ctrl && key === 'f') {
    event.preventDefault();
    if (hasDoc) actions.openFind();
    return;
  }
  if (ctrl && key === 'p') {
    event.preventDefault();
    if (hasDoc) void actions.print();
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
  if (ctrl && event.shiftKey && /^Digit[1-5]$/.test(event.code)) {
    event.preventDefault();
    const tabs = ['tools', 'markups', 'pages', 'properties', 'measure'] as const;
    return actions.setPanel(tabs[Number(event.code.slice(5)) - 1]!);
  }
  // Quick slots: 1–9 fire the first nine chest tools (PLAN §3.8).
  if (!ctrl && !event.altKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code)) {
    event.preventDefault();
    return actions.selectToolSlot(Number(event.code.slice(5)));
  }
  if (event.key === 'Home' && ctrl) return actions.goToPage(0);
  if (event.key === 'End' && ctrl) return actions.goToPage(Number.MAX_SAFE_INTEGER);

  if (ctrl && key === 'a') {
    event.preventDefault();
    if (hasDoc) actions.selectAllOnPage();
    return;
  }
  if (ctrl && key === 'c') {
    if (hasDoc) actions.copy();
    return;
  }
  if (ctrl && key === 'v') {
    if (hasDoc) actions.paste();
    return;
  }
  if (ctrl && key === 'd') {
    event.preventDefault();
    if (hasDoc) actions.duplicate();
    return;
  }
  if (event.key === '?' || (event.shiftKey && event.code === 'Slash')) {
    event.preventDefault();
    actions.toggleHelp();
    return;
  }
  if (event.key === 'Escape') {
    actions.select(undefined);
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    return actions.deleteMarkups();
  }
  if (ctrl || event.altKey) return;
  const plain: Record<string, Tool> = {
    v: 'select',
    h: 'pan',
    x: 'calibrate',
    m: 'length',
    a: 'area',
    c: 'count',
    r: 'rectangle',
    e: 'ellipse',
    l: 'line',
    g: 'polygon',
    p: 'pen',
    t: 'textbox',
    k: 'callout',
    n: 'note',
    s: 'stamp',
  };
  const shifted: Record<string, Tool> = {
    m: 'polylength',
    a: 'perimeter',
    l: 'arrow',
    g: 'cloud',
    h: 'highlighter',
  };
  const next = event.shiftKey ? shifted[key] : plain[key];
  if (next) actions.setTool(next);
}

export function App() {
  const state = useEditor();
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const {
    doc,
    pdfjs,
    tool,
    dirty,
    status,
    zoom,
    zoomMode,
    selectedId,
    selectedIds,
    hasDoc,
    pageCount,
    currentPage,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    documents,
    activeId,
    layoutMode,
    showThumbnails,
    autosave,
    showHelp,
    snapEnabled,
    showProfile,
    profile,
    compress,
    review,
    laser,
  } = state;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => handleShortcut(event, hasDoc, dirty);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasDoc, dirty]);

  // Hold Space to pan from any tool; release to return to it.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      actions.setSpacePan(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') actions.setSpacePan(false);
    };
    const blur = () => actions.setSpacePan(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Profile then tool chest live in IndexedDB; load (or seed) them once.
  useEffect(() => {
    void actions.loadProfile().then(() => actions.loadToolChest());
    void actions.loadStamps();
  }, []);

  // Paste a PDF from the clipboard (e.g. copied in Explorer).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter(isPdf);
      if (files.length === 0) return;
      event.preventDefault();
      void (async () => {
        for (const file of files) await openFile(file);
      })();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

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
      if (documents.some((d) => d.dirty)) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [documents]);

  // Drop anywhere: every dropped PDF opens in its own tab, with a writable handle when
  // the browser hands one over (Chromium).
  const onDrop = useCallback(async (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const items = Array.from(event.dataTransfer.items ?? []);
    const files = Array.from(event.dataTransfer.files);
    for (const [index, file] of files.entries()) {
      if (!isPdf(file)) continue;
      const handle = await handleFromDrop(items[index]);
      await openFile(file, handle);
    }
  }, []);

  const onPick = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    for (const file of files) if (isPdf(file)) await openFile(file);
    event.target.value = '';
  }, []);

  /** Open…: the picker when it can give us a handle, the plain input otherwise. */
  const onOpen = useCallback(async () => {
    if (supportsSaveInPlace()) {
      const handles = await pickFileHandle(true);
      for (const handle of handles) await openFile(await handle.getFile(), handle);
      return;
    }
    fileInput.current?.click();
  }, []);

  const onOpenRecent = useCallback(async (entry: RecentEntry) => {
    if (!entry.handle) return;
    try {
      await openHandle(entry.handle);
    } catch {
      actions.setStatus(`Could not reopen ${entry.name}; it may have moved`);
    }
  }, []);

  const onCloseTab = useCallback((id: string) => {
    if (actions.close(id)) return;
    if (window.confirm('This document has unsaved changes. Close it anyway?')) {
      actions.close(id, true);
    }
  }, []);

  const selected = doc?.markups.find((m) => m.id === selectedId);
  const pageScale = doc?.pageScales.get(currentPage);

  const zoomSelectValue = zoomMode === 'custom' ? 'custom' : zoomMode;
  const onZoomSelect = (value: string) => {
    if (value === '100') actions.setZoomMode('custom');
    else actions.setZoomMode(value as ZoomMode);
  };

  return (
    <div
      className={`app${over ? ' over' : ''}${review ? ' review' : ''}${laser ? ' laser' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false);
      }}
      onDrop={onDrop}
    >
      <MenuBar
        onOpen={() => void onOpen()}
        onSave={() => void actions.save(saveBytes)}
        onPrint={() => void actions.print()}
      />
      <div className="toolbar">
        <strong>Redline</strong>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={onPick}
          style={{ display: 'none' }}
        />
        <button type="button" onClick={onOpen} title="Ctrl+O">
          Open…
        </button>
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
        <select
          value={layoutMode}
          disabled={!hasDoc}
          onChange={(e) => actions.setLayoutMode(e.target.value as LayoutMode)}
          aria-label="Page layout"
        >
          <option value="continuous">Continuous</option>
          <option value="single">Single page</option>
        </select>
        <button
          type="button"
          disabled={!hasDoc}
          onClick={() => actions.rotateView(-90)}
          aria-label="Rotate view left"
          title="Rotate view 90° counter-clockwise (view only)"
        >
          ⟲
        </button>
        <button
          type="button"
          disabled={!hasDoc}
          onClick={() => actions.rotateView(90)}
          aria-label="Rotate view right"
          title="Rotate view 90° clockwise (view only)"
        >
          ⟳
        </button>
        <button
          type="button"
          disabled={!hasDoc}
          className={showThumbnails ? 'active' : ''}
          onClick={() => actions.toggleThumbnails()}
          aria-label="Toggle thumbnails"
          aria-pressed={showThumbnails}
          title="Show page thumbnails"
        >
          Pages
        </button>
        <span className="sep" />
        <button
          type="button"
          disabled={!hasDoc}
          onClick={actions.openFind}
          title="Ctrl+F"
          aria-label="Find"
        >
          Find
        </button>
        <button
          type="button"
          disabled={!hasDoc}
          onClick={() => void actions.print()}
          title="Ctrl+P"
          aria-label="Print"
        >
          Print
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
        <button
          type="button"
          onClick={() => actions.toggleProfile(true)}
          title="Profile: author name, default units and style"
          aria-label="Profile"
          className={profile.author ? 'profile' : 'profile attention'}
        >
          {profile.author || 'Set your name…'}
        </button>
        <button
          type="button"
          onClick={() => actions.toggleSnap()}
          aria-pressed={snapEnabled}
          className={snapEnabled ? 'active' : ''}
          title="Snap to endpoints and midpoints while drawing (hold Alt to override, Shift to constrain)"
        >
          Snap
        </button>
        <button
          type="button"
          onClick={() => actions.toggleHelp()}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
        <span className="spacer" />
        <span className="status">{status}</span>
        {hasDoc && autosave !== 'idle' && (
          <span className="autosave" data-autosave={autosave} title="Autosave">
            {autosave === 'saved'
              ? 'autosaved'
              : autosave === 'error'
                ? 'autosave failed'
                : 'autosaving…'}
          </span>
        )}
      </div>
      {documents.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Open documents">
          {documents.map((d) => (
            <div
              key={d.id}
              role="tab"
              aria-selected={d.id === activeId}
              className={`tab${d.id === activeId ? ' active' : ''}`}
              onClick={() => actions.activate(d.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onCloseTab(d.id);
              }}
              title={d.name}
            >
              <span className="tab-name">
                {d.name}
                {d.dirty ? ' *' : ''}
              </span>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${d.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(d.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <FindBar />
      {showHelp && <ShortcutHelp onClose={() => actions.toggleHelp(false)} />}
      {showProfile && (
        <ProfileDialog profile={profile} onClose={() => actions.toggleProfile(false)} />
      )}
      {compress && <CompressDialog onClose={() => actions.closeCompress()} />}
      <div className="hint">
        {hasDoc
          ? TOOLS.find((t) => t.id === tool)?.hint
          : 'Drop a PDF (try a Revu-marked set), paste one, or use Open.'}
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
        {selectedIds.length > 1 && (
          <>
            {' '}
            · <strong>{selectedIds.length} selected</strong>
          </>
        )}
        {selected && selectedIds.length <= 1 && (
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
        <div className="main">
          <Viewer key={pdfjs.doc.fingerprints[0] ?? activeId} pdfjs={pdfjs.doc} />
          <Panel key={`panel-${activeId}`} pdfjs={pdfjs.doc} />
          {review && <ReviewBar />}
          {review && laser && <LaserPointer />}
        </div>
      ) : (
        <div className="empty">
          <div className={`dropzone${over ? ' over' : ''}`}>Drop a PDF here</div>
          <Recover excludeKeys={[]} />
          <Recents onOpenHandle={onOpenRecent} onPick={() => void onOpen()} />
        </div>
      )}
    </div>
  );
}
