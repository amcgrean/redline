/**
 * Editor UI state (Zustand + immer) and the actions that drive it.
 *
 * Only serialisable UI state lives here. Documents are in `session.ts`; every mutation
 * goes through a `Command` on the session's history and bumps `version` so subscribers
 * re-render. The fields that describe the active document (name, page count, dirty,
 * undo state) are mirrored into the store whenever the active session changes.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Markup, PageScale, Point, Scale, UnitFormat } from '@redline/pdf-core';
import { openDocument, saveIncremental } from '@redline/pdf-core';
import { loadPdfjs } from '../pdfjs';
import type { FileTarget } from '../fileTarget';
import { rememberRecent, type AutosaveEntry } from '../db';
import {
  clearAutosave,
  loadAutosave,
  newAutosaveKey,
  scheduleAutosave,
  type AutosaveState,
} from '../autosave';
import {
  addSession,
  getSession,
  getSessionById,
  History,
  listSessions,
  newSessionId,
  removeSession,
  replaceSessionDocument,
  requireSession,
  setActiveSession,
  type Session,
} from './session';
import { addAreaCommand, addLengthCommand, calibrateCommand, moveCommand } from './commands';
import type { FindHit } from '../text/textIndex';
import { printDocument } from '../print';

export type Tool = 'select' | 'text' | 'calibrate' | 'length' | 'area';
/** `custom` is a numeric zoom; the fit modes recompute on resize. */
export type ZoomMode = 'custom' | 'fit-page' | 'fit-width';
export type LayoutMode = 'continuous' | 'single';

export interface DocumentTab {
  id: string;
  name: string;
  dirty: boolean;
}

export interface EditorUiState {
  documents: DocumentTab[];
  activeId?: string;
  hasDoc: boolean;
  fileName?: string;
  pageCount: number;
  tool: Tool;
  selectedId?: string;
  zoom: number;
  zoomMode: ZoomMode;
  layoutMode: LayoutMode;
  /** View-only rotation in degrees (0/90/180/270); never written to the file. */
  viewRotation: number;
  showThumbnails: boolean;
  find: { open: boolean; query: string; hits: FindHit[]; index: number };
  autosave: AutosaveState;
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
    documents: [],
    hasDoc: false,
    pageCount: 0,
    tool: 'select',
    zoom: 0.35,
    zoomMode: 'fit-width',
    layoutMode: 'continuous',
    viewRotation: 0,
    showThumbnails: false,
    find: { open: false, query: '', hits: [], index: 0 },
    autosave: 'idle',
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

/** Mirror the active session's document-level facts into the store. */
function syncActive(s: EditorUiState, session: Session | undefined): void {
  s.documents = listSessions().map((x) => ({ id: x.id, name: x.file.name, dirty: x.dirty }));
  s.activeId = session?.id;
  s.hasDoc = !!session;
  s.fileName = session?.file.name;
  s.pageCount = session ? session.doc.pdfDoc.getPageCount() : 0;
  s.dirty = session?.dirty ?? false;
  s.canUndo = session?.history.canUndo ?? false;
  s.canRedo = session?.history.canRedo ?? false;
  s.undoLabel = session?.history.undoLabel;
  s.redoLabel = session?.history.redoLabel;
}

/** After a document mutation: bump the version, mark dirty, refresh undo state. */
function bump(patch: Partial<EditorUiState> = {}): void {
  const session = requireSession();
  session.dirty = true;
  set((s) => {
    Object.assign(s, patch);
    syncActive(s, session);
    s.version += 1;
  });
  scheduleAutosave(
    {
      key: session.autosaveKey,
      doc: session.doc,
      name: session.file.name,
      ...(session.file.handle && { handle: session.file.handle }),
    },
    setAutosaveState(session.id),
  );
}

/** Only the active document's autosave state is shown. */
function setAutosaveState(sessionId: string): (state: AutosaveState) => void {
  return (state) => {
    set((s) => {
      if (s.activeId === sessionId) s.autosave = state;
    });
  };
}

async function loadBoth(bytes: Uint8Array) {
  return Promise.all([openDocument(bytes), loadPdfjs(bytes)]);
}

export const actions = {
  /** Open a document in a new tab and make it active. */
  async open(
    bytes: Uint8Array,
    file: FileTarget,
    options: { recovered?: AutosaveEntry } = {},
  ): Promise<void> {
    set((s) => {
      s.status = `Opening ${file.name}…`;
    });
    const [doc, pdfjs] = await loadBoth(bytes);
    const session: Session = {
      id: newSessionId(),
      doc,
      pdfjs,
      file,
      history: new History(),
      // A recovered document has changes the user never saved: keep it dirty and keep
      // autosaving into the same slot until they Save.
      dirty: !!options.recovered,
      autosaveKey: options.recovered?.key ?? newAutosaveKey(),
    };
    addSession(session);
    set((s) => {
      syncActive(s, session);
      s.find = { open: false, query: '', hits: [], index: 0 };
      s.autosave = options.recovered ? 'saved' : 'idle';
      s.selectedId = undefined;
      s.tool = 'select';
      s.currentPage = 0;
      s.version += 1;
      s.status = options.recovered
        ? `Recovered ${file.name} — unsaved changes, Save to keep them`
        : `${file.name}: ${s.pageCount} pages, ${doc.markups.length} markups`;
    });
    void rememberRecent({
      name: file.name,
      size: bytes.byteLength,
      pageCount: doc.pdfDoc.getPageCount(),
      ...(file.handle && { handle: file.handle }),
    });
  },

  activate(id: string): void {
    const session = setActiveSession(id);
    if (!session) return;
    set((s) => {
      syncActive(s, session);
      s.find = { open: false, query: '', hits: [], index: 0 };
      s.autosave = session.dirty ? 'saved' : 'idle';
      s.selectedId = undefined;
      s.currentPage = 0;
      s.version += 1;
      s.status = `${session.file.name}: ${s.pageCount} pages, ${session.doc.markups.length} markups`;
    });
  },

  /** Close a tab. Returns false when the document is dirty and `force` is not set. */
  close(id: string, force = false): boolean {
    const session = getSessionById(id);
    if (!session) return true;
    if (session.dirty && !force) return false;
    const next = removeSession(id);
    void clearAutosave(session.autosaveKey);
    set((s) => {
      syncActive(s, next);
      s.find = { open: false, query: '', hits: [], index: 0 };
      s.selectedId = undefined;
      s.currentPage = 0;
      s.version += 1;
      s.status = next ? `${next.file.name}` : 'Drop a PDF to begin';
    });
    return true;
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

  setLayoutMode(mode: LayoutMode): void {
    set((s) => {
      s.layoutMode = mode;
    });
  },

  /** Rotate the view by ±90°. Only the view; page /Rotate is untouched. */
  rotateView(delta: 90 | -90): void {
    set((s) => {
      s.viewRotation = (((s.viewRotation + delta) % 360) + 360) % 360;
    });
  },

  openFind(): void {
    set((s) => {
      s.find.open = true;
    });
  },

  closeFind(): void {
    set((s) => {
      s.find = { open: false, query: '', hits: [], index: 0 };
    });
  },

  /** New results replace the old; the first hit at or after the current page is selected. */
  setFindResults(query: string, hits: FindHit[]): void {
    const { currentPage } = useEditorStore.getState();
    let index = hits.findIndex((h) => h.page >= currentPage);
    if (index < 0) index = 0;
    set((s) => {
      s.find.query = query;
      s.find.hits = hits;
      s.find.index = index;
    });
    const hit = hits[index];
    if (hit && hit.page !== currentPage) actions.goToPage(hit.page);
  },

  findNext(): void {
    actions.stepFind(1);
  },

  findPrevious(): void {
    actions.stepFind(-1);
  },

  stepFind(delta: 1 | -1): void {
    const { find } = useEditorStore.getState();
    if (find.hits.length === 0) return;
    const index = (find.index + delta + find.hits.length) % find.hits.length;
    set((s) => {
      s.find.index = index;
    });
    const hit = find.hits[index];
    if (hit) actions.goToPage(hit.page);
  },

  async print(): Promise<void> {
    const session = getSession();
    if (!session) return;
    set((s) => {
      s.status = 'Preparing print…';
    });
    await printDocument(session.doc);
    set((s) => {
      s.status = 'Sent to print';
    });
  },

  /** Reopen an autosave as a dirty document in a new tab. */
  async recover(entry: AutosaveEntry): Promise<void> {
    const bytes = await loadAutosave(entry);
    if (!bytes) {
      set((s) => {
        s.status = `Autosave for ${entry.name} is no longer available`;
      });
      await clearAutosave(entry.key);
      return;
    }
    await actions.open(
      bytes,
      entry.handle ? { name: entry.name, handle: entry.handle } : { name: entry.name },
      { recovered: entry },
    );
  },

  async discardAutosave(key: string): Promise<void> {
    await clearAutosave(key);
  },

  toggleThumbnails(show?: boolean): void {
    set((s) => {
      s.showThumbnails = show ?? !s.showThumbnails;
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
    const { doc, history } = requireSession();
    history.run(calibrateCommand(doc, pageIndex, scale, units));
    bump({ status: `Page ${pageIndex + 1} scale set` });
  },

  addLength(pageIndex: number, a: Point, b: Point): Markup | undefined {
    const { doc, history } = requireSession();
    const command = addLengthCommand(doc, pageIndex, a, b, {
      subject: 'Length',
      author: useEditorStore.getState().author,
    });
    history.run(command);
    bump({ selectedId: command.id, status: `Length ${command.markup?.text?.contents ?? ''}` });
    return command.markup;
  },

  addArea(pageIndex: number, vertices: Point[]): Markup | undefined {
    const { doc, history } = requireSession();
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
    const { doc, history } = requireSession();
    history.run(moveCommand(doc, id, dx, dy));
    bump({ status: `Moved ${id}` });
  },

  undo(): void {
    const session = getSession();
    const command = session?.history.undo();
    if (!command) return;
    bump({ selectedId: undefined, status: `Undo ${command.label}` });
  },

  redo(): void {
    const session = getSession();
    const command = session?.history.redo();
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
    const [doc, pdfjs] = await loadBoth(bytes);
    replaceSessionDocument(session, doc, pdfjs, target);
    await clearAutosave(session.autosaveKey);
    set((s) => {
      syncActive(s, session);
      s.autosave = 'idle';
      s.version += 1;
      s.status = `Saved ${target.name} (+${update.length} bytes appended)`;
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
