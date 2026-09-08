/**
 * Editor UI state (Zustand + immer) and the actions that drive it.
 *
 * Only serialisable UI state lives here. The document itself is in `session.ts`; every
 * mutation goes through a `Command` on the `history` stack and bumps `version` so
 * subscribers re-render.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Markup, PageScale, Point, Scale, UnitFormat } from '@redline/pdf-core';
import { openDocument, saveIncremental } from '@redline/pdf-core';
import { loadPdfjs } from '../pdfjs';
import type { FileTarget } from '../fileTarget';
import { getSession, history, requireSession, setSession, type Session } from './session';
import { addAreaCommand, addLengthCommand, calibrateCommand, moveCommand } from './commands';

export type Tool = 'select' | 'calibrate' | 'length' | 'area';
/** `custom` is a numeric zoom; the fit modes recompute on resize. */
export type ZoomMode = 'custom' | 'fit-page' | 'fit-width';

export interface EditorUiState {
  hasDoc: boolean;
  fileName?: string;
  pageCount: number;
  tool: Tool;
  selectedId?: string;
  zoom: number;
  zoomMode: ZoomMode;
  /** 0-based page the viewer considers current (tracks scrolling). */
  currentPage: number;
  /** Set by `goToPage`; the viewer scrolls there and clears it. */
  scrollTo?: { page: number; nonce: number };
  /** Bumps on every document mutation so subscribers re-render. */
  version: number;
  dirty: boolean;
  status: string;
  author: string;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

export const useEditorStore = create<EditorUiState>()(
  immer(() => ({
    hasDoc: false,
    pageCount: 0,
    tool: 'select',
    zoom: 0.35,
    zoomMode: 'fit-width',
    currentPage: 0,
    version: 0,
    dirty: false,
    status: 'Drop a PDF to begin',
    author: 'Aaron McGrean',
    canUndo: false,
    canRedo: false,
  })),
);

const set = useEditorStore.setState;

function historyFlags(): Pick<EditorUiState, 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel'> {
  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
  };
}

/** After a document mutation: bump the version, mark dirty, refresh undo state. */
function bump(patch: Partial<EditorUiState> = {}): void {
  set((s) => {
    Object.assign(s, patch, historyFlags());
    s.version += 1;
    s.dirty = true;
  });
}

async function installSession(bytes: Uint8Array, file: FileTarget): Promise<Session> {
  const previous = getSession();
  const [doc, pdfjs] = await Promise.all([openDocument(bytes), loadPdfjs(bytes)]);
  previous?.pdfjs.destroy().catch(() => undefined);
  const session: Session = { doc, pdfjs, file };
  setSession(session);
  return session;
}

export const actions = {
  async open(bytes: Uint8Array, file: FileTarget): Promise<void> {
    set((s) => {
      s.status = `Opening ${file.name}…`;
    });
    const session = await installSession(bytes, file);
    history.clear();
    set((s) => {
      s.hasDoc = true;
      s.fileName = file.name;
      s.pageCount = session.doc.pdfDoc.getPageCount();
      s.selectedId = undefined;
      s.tool = 'select';
      s.currentPage = 0;
      s.version += 1;
      s.dirty = false;
      s.status = `${file.name}: ${s.pageCount} pages, ${session.doc.markups.length} markups`;
      Object.assign(s, historyFlags());
    });
  },

  setTool(tool: Tool): void {
    set((s) => {
      s.tool = tool;
      s.selectedId = undefined;
    });
  },

  select(id: string | undefined): void {
    set((s) => {
      s.selectedId = id;
    });
  },

  /** A numeric zoom always switches to custom mode. */
  setZoom(zoom: number): void {
    set((s) => {
      s.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      s.zoomMode = 'custom';
    });
  },

  zoomIn(): void {
    actions.setZoom(useEditorStore.getState().zoom * ZOOM_STEP);
  },

  zoomOut(): void {
    actions.setZoom(useEditorStore.getState().zoom / ZOOM_STEP);
  },

  setZoomMode(mode: ZoomMode): void {
    set((s) => {
      s.zoomMode = mode;
      if (mode === 'custom') s.zoom = 1;
    });
  },

  /** The viewer reports the zoom a fit mode resolved to; the mode is kept. */
  applyFittedZoom(zoom: number): void {
    set((s) => {
      if (s.zoomMode !== 'custom') s.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    });
  },

  setCurrentPage(page: number): void {
    set((s) => {
      if (s.currentPage !== page) s.currentPage = page;
    });
  },

  goToPage(page: number): void {
    const { pageCount } = useEditorStore.getState();
    const clamped = Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
    set((s) => {
      s.scrollTo = { page: clamped, nonce: (s.scrollTo?.nonce ?? 0) + 1 };
    });
  },

  nextPage(): void {
    actions.goToPage(useEditorStore.getState().currentPage + 1);
  },

  previousPage(): void {
    actions.goToPage(useEditorStore.getState().currentPage - 1);
  },

  clearScrollRequest(): void {
    set((s) => {
      s.scrollTo = undefined;
    });
  },

  setStatus(status: string): void {
    set((s) => {
      s.status = status;
    });
  },

  pageScale(pageIndex: number): PageScale | undefined {
    return getSession()?.doc.pageScales.get(pageIndex);
  },

  calibrate(pageIndex: number, scale: Scale, units: UnitFormat): void {
    const { doc } = requireSession();
    history.run(calibrateCommand(doc, pageIndex, scale, units));
    bump({ status: `Page ${pageIndex + 1} scale set` });
  },

  addLength(pageIndex: number, a: Point, b: Point): Markup | undefined {
    const { doc } = requireSession();
    const command = addLengthCommand(doc, pageIndex, a, b, {
      subject: 'Length',
      author: useEditorStore.getState().author,
    });
    history.run(command);
    bump({ selectedId: command.id, status: `Length ${command.markup?.text?.contents ?? ''}` });
    return command.markup;
  },

  addArea(pageIndex: number, vertices: Point[]): Markup | undefined {
    const { doc } = requireSession();
    const command = addAreaCommand(doc, pageIndex, vertices, {
      subject: 'Area',
      author: useEditorStore.getState().author,
    });
    history.run(command);
    bump({ selectedId: command.id, status: `Area ${command.markup?.text?.contents ?? ''}` });
    return command.markup;
  },

  move(id: string, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const { doc } = requireSession();
    history.run(moveCommand(doc, id, dx, dy));
    bump({ status: `Moved ${id}` });
  },

  undo(): void {
    const command = history.undo();
    if (!command) return;
    bump({ selectedId: undefined, status: `Undo ${command.label}` });
  },

  redo(): void {
    const command = history.redo();
    if (!command) return;
    bump({ selectedId: undefined, status: `Redo ${command.label}` });
  },

  async save(
    saveFn: (target: FileTarget, bytes: Uint8Array) => Promise<FileTarget>,
  ): Promise<void> {
    const session = getSession();
    if (!session) return;
    set((s) => {
      s.status = 'Saving…';
    });
    const { bytes, update } = await saveIncremental(session.doc);
    const target = await saveFn(session.file, bytes);
    // Dev only: mirror browser saves into fixtures/out/browser/ for the interop checklist.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')) {
      const name = target.name.replace(/\.pdf$/i, '') + '.browser.pdf';
      await fetch(`/__fixtures/out/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: bytes as BodyInit,
      }).catch(() => undefined);
    }
    // Re-open from the saved bytes so the next save is incremental on top of this one.
    // The command stack refers to the old document, so it is cleared (undo across a save
    // is a Phase 2 item).
    await installSession(bytes, target);
    history.clear();
    set((s) => {
      s.fileName = target.name;
      s.version += 1;
      s.dirty = false;
      s.status = `Saved ${target.name} (+${update.length} bytes appended)`;
      Object.assign(s, historyFlags());
    });
  },
};

/** UI state plus the live document objects, in the shape the POC components expect. */
export function useEditor() {
  const state = useEditorStore();
  return useMemo(() => {
    const session = getSession();
    return { ...state, doc: session?.doc, pdfjs: session?.pdfjs, file: session?.file };
  }, [state]);
}
