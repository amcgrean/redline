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
import type {
  Geometry,
  Markup,
  MarkupPatch,
  OptimizeReport,
  PageScale,
  Point,
  RedlineDocument,
  Scale,
  Rect,
  ShapeGeometry,
  ShapeStyle,
  StampCorner,
  TextStyle,
  UnitFormat,
} from '@redline/pdf-core';
import {
  BUILTIN_STAMPS,
  groupMembers,
  countGroupOf,
  embedStampArtwork,
  flattenMarkups,
  everyN,
  parseRanges,
  splitDocument,
  optimizePdf,
  describeSavings,
  generateNM,
  openDocument,
  rectAt,
  saveFull,
  saveIncremental,
} from '@redline/pdf-core';

/** How many page-structure changes stay undoable (each holds a copy of the file). */
const PAGE_HISTORY_LIMIT = 5;
import { loadPdfjs } from '../pdfjs';
import type { FileTarget } from '../fileTarget';
import { db, rememberRecent, type AutosaveEntry } from '../db';
import {
  defaultToolChest,
  newId,
  parseToolChest,
  serializeToolChest,
  type Tool as ChestTool,
  type ToolChest,
  defaultProfile,
  parseProfile,
  serializeProfile,
} from '@redline/toolchest';
import type { Profile } from '@redline/toolchest';
import { countGroupOf as isCount, type MeasurementStyle, type CountStyle } from '@redline/pdf-core';
import { fromHex, toHex } from '../color';
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
import {
  addAreaCommand,
  addCountCommand,
  addLengthCommand,
  addPolylineCommand,
  addShapeCommand,
  addTextBoxCommand,
  addCalloutCommand,
  addNoteCommand,
  addStampCommand,
  stampPagesCommand,
  setTextCommand,
  duplicateCommand,
  lockCommand,
  hideCommand,
  markupScaleCommand,
  groupCommand,
  ungroupCommand,
  reorderCommand,
  captionCommand,
  convertCommand,
  calibratePagesCommand,
  deleteCommand,
  geometryCommand,
  moveCommand,
  moveManyCommand,
  updateCommand,
} from './commands';
import type { FindHit } from '../text/textIndex';
import {
  importStampFile,
  listUserStamps,
  removeUserStamp,
  resolveStamp,
  type ActiveStamp,
} from '../stamps';
import type { StampRow } from '../db';
import { downloadBytes } from '../download';
import { renderPagePng } from '../exportPng';
import { buildMarkupsSummary } from '../summary';
import { downloadMarkupsCsv, downloadMarkupsXlsx } from '../export';
import { workerQpdf } from '../compress';
import { reduceImages } from '../reduceImages';
import { printDocument } from '../print';

export type Tool =
  | 'select'
  | 'pan'
  | 'text'
  | 'calibrate'
  | 'length'
  | 'polylength'
  | 'perimeter'
  | 'area'
  | 'rectarea'
  | 'count'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'polygon'
  | 'pen'
  | 'textbox'
  | 'callout'
  | 'note'
  | 'cloud'
  | 'highlighter'
  | 'stamp';
/** `custom` is a numeric zoom; the fit modes recompute on resize. */
export type ZoomMode = 'custom' | 'fit-page' | 'fit-width';
export type LayoutMode = 'continuous' | 'single';
export type PanelTab = 'tools' | 'markups' | 'pages' | 'properties' | 'measure';
/** Which pages a new scale applies to (PLAN §3.7 "Scope"). */
export type ScaleScope = 'page' | 'like' | 'all';

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
  /** Primary (last clicked) selection; `selectedIds` is the whole set, primary included. */
  selectedId?: string;
  selectedIds: string[];
  zoom: number;
  zoomMode: ZoomMode;
  layoutMode: LayoutMode;
  /** View-only rotation in degrees (0/90/180/270); never written to the file. */
  viewRotation: number;
  showThumbnails: boolean;
  panel: { open: boolean; tab: PanelTab };
  scaleScope: ScaleScope;
  /** The active tool chest (persisted in Dexie). */
  chest?: ToolChest;
  /** The chest tool whose subject/style new markups take. */
  activeToolId?: string;
  find: { open: boolean; query: string; hits: FindHit[]; index: number };
  autosave: AutosaveState;
  /** 0-based page the viewer considers current (tracks scrolling). */
  currentPage: number;
  /** Set by `goToPage`; the viewer scrolls there and clears it. */
  scrollTo?: { page: number; nonce: number };
  /** The count group in progress while the Count tool is active. */
  countGroup?: string;
  /** In-app clipboard: markup ids to paste (Ctrl+C / Ctrl+V), with their source page. */
  clipboard: { ids: string[]; page: number };
  /** `?` overlay. */
  showHelp: boolean;
  /** Review mode (PLAN §3.10): chrome hidden, floating bar. */
  review: boolean;
  laser: boolean;
  /** Profile dialog. */
  showProfile: boolean;
  /** The user's profile (author, default units, default style). */
  profile: Profile;
  /** Snap to endpoints/midpoints while drawing (Alt overrides for one point). */
  snapEnabled: boolean;
  /** Selected page indices in the Pages panel. */
  pageSelection: number[];
  /** Stamp library state. */
  activeStamp: ActiveStamp;
  userStamps: StampRow[];
  stampText: string;
  stampCorner: StampCorner;
  /** Width in points a placed stamp gets. */
  stampWidth: number;
  /** A page operation (full rewrite + reload) is in flight. */
  pageBusy: boolean;
  /** Compress dialog state. */
  compress?: {
    phase: 'idle' | 'running' | 'done' | 'error';
    mode: 'optimize' | 'reduce';
    dpi: number;
    quality: number;
    before: number;
    progress?: string;
    report?: OptimizeReport & { images?: number; skipped?: number };
    error?: string;
  };
  /** Space is held: pan from any tool without switching (Appendix B "hold Space"). */
  spacePan: boolean;
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
    selectedIds: [],
    hasDoc: false,
    pageCount: 0,
    tool: 'select',
    zoom: 0.35,
    zoomMode: 'fit-width',
    layoutMode: 'continuous',
    viewRotation: 0,
    showThumbnails: false,
    panel: { open: true, tab: 'tools' },
    scaleScope: 'page',
    find: { open: false, query: '', hits: [], index: 0 },
    autosave: 'idle',
    spacePan: false,
    clipboard: { ids: [], page: 0 },
    showHelp: false,
    review: false,
    laser: false,
    showProfile: false,
    profile: defaultProfile('local'),
    snapEnabled: true,
    pageSelection: [],
    activeStamp: { kind: 'builtin', id: 'approved' },
    userStamps: [],
    stampText: '',
    stampCorner: 'top-right',
    stampWidth: 216,
    pageBusy: false,
    currentPage: 0,
    version: 0,
    dirty: false,
    status: 'Drop a PDF to begin',
    author: '',
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
  s.canUndo = (session?.history.canUndo || (session?.pageHistory.length ?? 0) > 0) ?? false;
  s.canRedo = session?.history.canRedo ?? false;
  s.undoLabel =
    session?.history.undoLabel ?? session?.pageHistory[session.pageHistory.length - 1]?.label;
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
      pageHistory: [],
      // A recovered document has changes the user never saved: keep it dirty and keep
      // autosaving into the same slot until they Save.
      dirty: !!options.recovered,
      autosaveKey: options.recovered?.key ?? newAutosaveKey(),
    };
    addSession(session);
    set((s) => {
      syncActive(s, session);
      s.find = { open: false, query: '', hits: [], index: 0 };
      s.pageSelection = [];
      s.autosave = options.recovered ? 'saved' : 'idle';
      s.selectedId = undefined;
      s.selectedIds = [];
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
      s.selectedIds = [];
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
      s.selectedIds = [];
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
      s.selectedIds = [];
      // Every activation of the Count tool starts a fresh group.
      s.countGroup = tool === 'count' ? generateNM() : undefined;
      // A chest tool only stays active while its kind is the tool in use.
      const active = s.chest?.tools.find((t) => t.id === s.activeToolId);
      if (active && active.kind !== tool) s.activeToolId = undefined;
    });
  },

  // ---- stamps ----

  async loadStamps(): Promise<void> {
    const rows = await listUserStamps();
    set((s) => {
      s.userStamps = rows;
    });
  },

  setActiveStamp(stamp: ActiveStamp): void {
    const title =
      stamp.kind === 'builtin'
        ? BUILTIN_STAMPS.find((b) => b.id === stamp.id)?.title
        : useEditorStore.getState().userStamps.find((u) => u.id === stamp.id)?.name;
    set((s) => {
      s.activeStamp = stamp;
      s.tool = 'stamp';
      s.selectedId = undefined;
      s.selectedIds = [];
      s.status = `Stamp: ${title ?? stamp.id} — click the page to place it`;
    });
  },

  setStampText(text: string): void {
    set((s) => {
      s.stampText = text;
    });
  },

  setStampCorner(corner: StampCorner): void {
    set((s) => {
      s.stampCorner = corner;
    });
  },

  async importStamp(file: File): Promise<void> {
    try {
      const row = await importStampFile(file);
      set((s) => {
        s.userStamps = [...s.userStamps, row];
        s.activeStamp = { kind: 'user', id: row.id };
        s.tool = s.hasDoc ? 'stamp' : s.tool;
        s.status = `Added stamp "${row.name}"`;
      });
    } catch (error) {
      set((s) => {
        s.status = (error as Error).message;
      });
    }
  },

  async removeUserStamp(id: string): Promise<void> {
    await removeUserStamp(id);
    set((s) => {
      s.userStamps = s.userStamps.filter((u) => u.id !== id);
      if (s.activeStamp.kind === 'user' && s.activeStamp.id === id) {
        s.activeStamp = { kind: 'builtin', id: 'approved' };
      }
    });
  },

  /** Place the active stamp with its top-left at `at`. */
  async addStampAt(pageIndex: number, at: Point): Promise<void> {
    const session = getSession();
    if (!session) return;
    const state = useEditorStore.getState();
    try {
      const resolved = await resolveStamp(state.activeStamp, state.userStamps, {
        user: state.author,
        customText: state.stampText,
        file: session.file.name,
      });
      const source = await embedStampArtwork(session.doc, resolved.artwork);
      const command = addStampCommand(
        session.doc,
        pageIndex,
        rectAt(source, at, state.stampWidth),
        source,
        { name: resolved.name, contents: resolved.contents, author: state.author },
      );
      session.history.run(command);
      bump({ selectedId: command.id, selectedIds: [command.id], status: 'Stamp' });
    } catch (error) {
      set((s) => {
        s.status = `Stamp failed: ${(error as Error).message}`;
      });
    }
  },

  /** Place the active stamp on every page at the chosen corner. */
  async stampAllPages(): Promise<void> {
    const session = getSession();
    if (!session) return;
    const state = useEditorStore.getState();
    try {
      const resolved = await resolveStamp(state.activeStamp, state.userStamps, {
        user: state.author,
        customText: state.stampText,
        file: session.file.name,
      });
      const source = await embedStampArtwork(session.doc, resolved.artwork);
      const command = stampPagesCommand(
        session.doc,
        source,
        { corner: state.stampCorner, width: state.stampWidth, margin: 36 },
        { name: resolved.name, contents: resolved.contents, author: state.author },
      );
      session.history.run(command);
      bump({
        selectedId: command.created[0],
        selectedIds: [...command.created],
        status: command.label,
      });
    } catch (error) {
      set((s) => {
        s.status = `Stamp failed: ${(error as Error).message}`;
      });
    }
  },

  // ---- compress ----

  /** Open the Compress dialog with the current size and the last-used options. */
  async optimize(): Promise<void> {
    const session = getSession();
    if (!session) return;
    const current = (await saveIncremental(session.doc)).bytes;
    const previous = useEditorStore.getState().compress;
    set((s) => {
      s.compress = {
        phase: 'idle',
        mode: previous?.mode ?? 'optimize',
        dpi: previous?.dpi ?? 200,
        quality: previous?.quality ?? 0.75,
        before: current.length,
      };
    });
  },

  setCompressOptions(patch: {
    mode?: 'optimize' | 'reduce';
    dpi?: number;
    quality?: number;
  }): void {
    set((s) => {
      if (!s.compress) return;
      Object.assign(s.compress, patch);
      s.compress.phase = 'idle';
      s.compress.report = undefined;
      s.compress.error = undefined;
    });
  },

  /** Run the chosen mode on the current bytes (unsaved markups included). */
  async runCompress(): Promise<void> {
    const session = getSession();
    const options = useEditorStore.getState().compress;
    if (!session || !options) return;
    const current = (await saveIncremental(session.doc)).bytes;
    set((s) => {
      if (!s.compress) return;
      s.compress.phase = 'running';
      s.compress.before = current.length;
      s.compress.progress = options.mode === 'reduce' ? 'Finding images…' : 'Optimizing…';
    });
    try {
      const report =
        options.mode === 'reduce'
          ? await reduceImages(
              current,
              { dpi: options.dpi, quality: options.quality },
              (done, total) => {
                set((s) => {
                  if (s.compress) s.compress.progress = `Re-encoding image ${done} of ${total}…`;
                });
              },
            )
          : await optimizePdf(workerQpdf, current);
      set((s) => {
        if (!s.compress) return;
        s.compress.phase = 'done';
        s.compress.report = report;
        s.compress.progress = undefined;
      });
    } catch (error) {
      set((s) => {
        if (!s.compress) return;
        s.compress.phase = 'error';
        s.compress.error = (error as Error).message;
        s.compress.progress = undefined;
      });
    }
  },

  closeCompress(): void {
    set((s) => {
      s.compress = undefined;
    });
  },

  downloadOptimized(): void {
    const session = getSession();
    const report = useEditorStore.getState().compress?.report;
    if (!session || !report) return;
    downloadBytes(
      report.bytes,
      `${session.file.name.replace(/\.pdf$/i, '')}.compressed.pdf`,
      'application/pdf',
    );
    set((s) => {
      s.status = `Downloaded compressed copy: ${describeSavings(report)}`;
      s.compress = undefined;
    });
  },

  /** Replace the open document with the optimized bytes; the next Save writes them. */
  async applyOptimized(): Promise<void> {
    const session = getSession();
    const report = useEditorStore.getState().compress?.report;
    if (!session || !report) return;
    set((s) => {
      s.pageBusy = true;
    });
    const before = (await saveIncremental(session.doc)).bytes;
    const [doc, pdfjs] = await loadBoth(report.bytes);
    replaceSessionDocument(session, doc, pdfjs, session.file);
    session.pageHistory.push({ label: 'Compress', bytes: before });
    if (session.pageHistory.length > PAGE_HISTORY_LIMIT) session.pageHistory.shift();
    bump({
      status: `Compressed: ${describeSavings(report)}`,
      selectedId: undefined,
      selectedIds: [],
      pageSelection: [],
      pageBusy: false,
      compress: undefined,
    });
  },

  // ---- split ----

  /** `spec` is a number (every N pages) or ranges like `1-3, 4, 7-`. Downloads one file per part. */
  async split(spec: string): Promise<void> {
    const session = getSession();
    if (!session) return;
    const pageCount = session.doc.pdfDoc.getPageCount();
    try {
      const ranges = /^\s*\d+\s*$/.test(spec)
        ? everyN(pageCount, Number(spec))
        : parseRanges(spec, pageCount);
      set((s) => {
        s.status = `Splitting into ${ranges.length} files…`;
      });
      const parts = await splitDocument(session.doc, ranges);
      const base = session.file.name.replace(/\.pdf$/i, '');
      parts.forEach((part, k) => {
        const range = part.from === part.to ? `p${part.from}` : `p${part.from}-${part.to}`;
        // Stagger the downloads: browsers drop a burst of simultaneous downloads.
        setTimeout(
          () => downloadBytes(part.bytes, `${base}.${range}.pdf`, 'application/pdf'),
          k * 150,
        );
      });
      set((s) => {
        s.status = `Split into ${parts.length} file${parts.length === 1 ? '' : 's'}`;
      });
    } catch (error) {
      set((s) => {
        s.status = `Split failed: ${(error as Error).message}`;
      });
    }
  },

  // ---- flatten ----

  /**
   * Download a flattened copy (PLAN §3.9: the open file stays unflattened). The copy is
   * built from the current bytes so unsaved markups are included.
   */
  async exportFlattened(): Promise<void> {
    const session = getSession();
    if (!session) return;
    set((s) => {
      s.status = 'Flattening…';
    });
    try {
      const current = (await saveIncremental(session.doc)).bytes;
      const copy = await openDocument(current);
      const count = flattenMarkups(copy);
      const out = await saveFull(copy);
      const name = `${session.file.name.replace(/\.pdf$/i, '')}.flattened.pdf`;
      downloadBytes(out, name, 'application/pdf');
      set((s) => {
        s.status = `Flattened ${count} markup${count === 1 ? '' : 's'} into ${name}`;
      });
    } catch (error) {
      set((s) => {
        s.status = `Flatten failed: ${(error as Error).message}`;
      });
    }
  },

  /** Flatten the given markups into the open document (a rewrite; undo via page history). */
  flattenSelected(ids: string[]): void {
    if (ids.length === 0) return;
    void actions.pageOperation(
      ids.length === 1 ? 'Flatten markup' : `Flatten ${ids.length} markups`,
      (doc) => {
        flattenMarkups(doc, { ids });
      },
    );
  },

  // ---- pages ----

  selectPages(indices: number[]): void {
    set((s) => {
      s.pageSelection = [...new Set(indices)].sort((a, b) => a - b);
    });
  },

  togglePageSelection(index: number): void {
    set((s) => {
      s.pageSelection = s.pageSelection.includes(index)
        ? s.pageSelection.filter((i) => i !== index)
        : [...s.pageSelection, index].sort((a, b) => a - b);
    });
  },

  /** Shift-click: select the range from the current page (or last selected) to `index`. */
  extendPageSelection(index: number): void {
    set((s) => {
      const anchor = s.pageSelection.length
        ? s.pageSelection[s.pageSelection.length - 1]!
        : s.currentPage;
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
      const range = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      s.pageSelection = [...new Set([...s.pageSelection, ...range])].sort((x, y) => x - y);
    });
  },

  /**
   * Apply a page-structure change: run `fn` on the live document, rewrite it in full,
   * and re-open the result (pdf.js included). The bytes from before the change go on the
   * session's page-history stack so Ctrl+Z can bring them back.
   */
  async pageOperation(
    label: string,
    fn: (doc: RedlineDocument) => void | Promise<void>,
    after: { select?: number[]; goTo?: number } = {},
  ): Promise<void> {
    const session = getSession();
    if (!session || useEditorStore.getState().pageBusy) return;
    set((s) => {
      s.pageBusy = true;
      s.status = `${label}…`;
    });
    try {
      const before = (await saveIncremental(session.doc)).bytes;
      await fn(session.doc);
      const bytes = await saveFull(session.doc);
      const [doc, pdfjs] = await loadBoth(bytes);
      replaceSessionDocument(session, doc, pdfjs, session.file);
      session.pageHistory.push({ label, bytes: before });
      if (session.pageHistory.length > PAGE_HISTORY_LIMIT) session.pageHistory.shift();
      const pageCount = doc.pdfDoc.getPageCount();
      const goTo = Math.max(
        0,
        Math.min(after.goTo ?? useEditorStore.getState().currentPage, pageCount - 1),
      );
      bump({
        status: label,
        selectedId: undefined,
        selectedIds: [],
        pageSelection: (after.select ?? []).filter((i) => i >= 0 && i < pageCount),
        currentPage: goTo,
        pageBusy: false,
        find: { open: false, query: '', hits: [], index: 0 },
      });
      actions.goToPage(goTo);
    } catch (error) {
      set((s) => {
        s.pageBusy = false;
        s.status = `${label} failed: ${(error as Error).message}`;
      });
    }
  },

  async undoPageOperation(): Promise<void> {
    const session = getSession();
    const entry = session?.pageHistory.pop();
    if (!session || !entry) return;
    set((s) => {
      s.pageBusy = true;
    });
    const [doc, pdfjs] = await loadBoth(entry.bytes);
    replaceSessionDocument(session, doc, pdfjs, session.file);
    const pageCount = doc.pdfDoc.getPageCount();
    bump({
      status: `Undo ${entry.label}`,
      selectedId: undefined,
      selectedIds: [],
      pageSelection: [],
      currentPage: Math.min(useEditorStore.getState().currentPage, pageCount - 1),
      pageBusy: false,
    });
  },

  // ---- profile ----

  /** Load the newest stored profile, or seed the default. Runs before the chest. */
  async loadProfile(): Promise<void> {
    let profile: Profile | undefined;
    try {
      const rows = await db.profiles.orderBy('updatedAt').reverse().toArray();
      for (const row of rows) {
        try {
          profile = parseProfile(row.json);
          break;
        } catch {
          // skip a corrupt row
        }
      }
    } catch {
      // IndexedDB unavailable: in-memory default.
    }
    if (!profile) {
      profile = defaultProfile(newId());
      await persistProfile(profile);
    }
    set((s) => {
      s.profile = profile;
      s.author = profile.author;
    });
  },

  updateProfile(patch: Partial<Omit<Profile, 'version' | 'id'>>): void {
    const { profile } = useEditorStore.getState();
    const next: Profile = { ...profile, ...patch, updatedAt: new Date().toISOString() };
    set((s) => {
      s.profile = next;
      s.author = next.author;
      s.status = 'Profile saved';
    });
    void persistProfile(next);
  },

  toggleProfile(show?: boolean): void {
    set((s) => {
      s.showProfile = show ?? !s.showProfile;
    });
  },

  exportProfile(): void {
    const { profile } = useEditorStore.getState();
    const blob = new Blob([serializeProfile(profile)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(profile.author || profile.name).replace(/[^\w.-]+/g, '_')}.profile.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  async importProfile(text: string): Promise<void> {
    try {
      const profile = parseProfile(text);
      await persistProfile(profile);
      set((s) => {
        s.profile = profile;
        s.author = profile.author;
        s.status = `Imported profile "${profile.name}"`;
      });
    } catch (error) {
      set((s) => {
        s.status = `Not a valid profile: ${(error as Error).message.split('\n')[0]}`;
      });
    }
  },

  // ---- tool chest ----

  async loadToolChest(): Promise<void> {
    let chest: ToolChest | undefined;
    try {
      const rows = await db.toolchests.orderBy('updatedAt').reverse().toArray();
      for (const row of rows) {
        try {
          chest = parseToolChest(row.json);
          break;
        } catch {
          // skip a corrupt row
        }
      }
    } catch {
      // IndexedDB unavailable: fall through to the default chest, in memory only.
    }
    if (!chest) {
      chest = defaultToolChest(useEditorStore.getState().author);
      await persistChest(chest);
    }
    set((s) => {
      s.chest = chest;
    });
  },

  /** Make a chest tool active: switch to its kind and draw with its subject/style. */
  selectTool(id: string): void {
    const { chest } = useEditorStore.getState();
    const tool = chest?.tools.find((t) => t.id === id);
    if (!tool) return;
    set((s) => {
      s.tool = tool.kind;
      s.selectedId = undefined;
      s.selectedIds = [];
      s.countGroup = tool.kind === 'count' ? generateNM() : undefined;
      s.activeToolId = tool.id;
      s.status = `Tool: ${tool.name}`;
    });
  },

  /** Quick slot 1..9. */
  selectToolSlot(slot: number): void {
    const { chest } = useEditorStore.getState();
    const tool = chest?.tools[slot - 1];
    if (tool) actions.selectTool(tool.id);
  },

  updateTool(id: string, patch: Partial<ChestTool>): void {
    const { chest } = useEditorStore.getState();
    if (!chest) return;
    const next: ToolChest = {
      ...chest,
      updatedAt: new Date().toISOString(),
      tools: chest.tools.map((t) => (t.id === id ? { ...t, ...patch, id } : t)),
    };
    set((s) => {
      s.chest = next;
    });
    void persistChest(next);
  },

  removeTool(id: string): void {
    const { chest } = useEditorStore.getState();
    if (!chest) return;
    const next: ToolChest = {
      ...chest,
      updatedAt: new Date().toISOString(),
      tools: chest.tools.filter((t) => t.id !== id),
    };
    set((s) => {
      s.chest = next;
      if (s.activeToolId === id) s.activeToolId = undefined;
    });
    void persistChest(next);
  },

  /** "Add to Tool Chest": the selected markup's kind, subject and style become a tool. */
  addToolFromMarkup(markupId: string): void {
    const session = getSession();
    const { chest } = useEditorStore.getState();
    if (!session || !chest) return;
    const m = session.doc.markups.find((x) => x.id === markupId);
    if (!m) return;
    const kind = toolKindOf(m);
    if (!kind) {
      set((s) => {
        s.status = 'Only measurements and counts can become tools for now';
      });
      return;
    }
    const subject = m.text?.subject || kind;
    const tool: ChestTool = {
      id: newId(),
      name: subject,
      subject,
      kind,
      mode: 'properties',
      style: {
        stroke: toHex(m.style.stroke),
        ...(m.style.fill && { fill: toHex(m.style.fill) }),
        ...(m.style.fillOpacity !== undefined && { fillOpacity: m.style.fillOpacity }),
        opacity: m.style.opacity,
        lineWidth: m.style.width,
        ...(m.style.lineEnds && { lineEnds: m.style.lineEnds }),
        ...(m.style.dash && { dash: m.style.dash }),
      },
      measure: {
        display: m.measure?.units.display ?? 'ft-in',
        precision: m.measure?.units.precision ?? 16,
        caption: m.measure?.caption ?? true,
        captionPosition: 'top',
      },
      attributes: [],
      formulas: [],
      icon: 'auto',
    };
    const next: ToolChest = {
      ...chest,
      updatedAt: new Date().toISOString(),
      tools: [...chest.tools, tool],
    };
    set((s) => {
      s.chest = next;
      s.activeToolId = tool.id;
      s.panel = { open: true, tab: 'tools' };
      s.status = `Added "${tool.name}" to the tool chest`;
    });
    void persistChest(next);
  },

  exportToolChest(): void {
    const { chest } = useEditorStore.getState();
    if (!chest) return;
    const blob = new Blob([serializeToolChest(chest)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chest.name.replace(/[^\w.-]+/g, '_')}.toolchest.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  async importToolChest(text: string): Promise<void> {
    try {
      const chest = parseToolChest(text);
      await persistChest(chest);
      set((s) => {
        s.chest = chest;
        s.activeToolId = undefined;
        s.status = `Imported tool chest "${chest.name}" (${chest.tools.length} tools)`;
      });
    } catch (error) {
      set((s) => {
        s.status = `Not a valid tool chest: ${(error as Error).message.split('\n')[0]}`;
      });
    }
  },

  setSpacePan(active: boolean): void {
    set((s) => {
      if (s.spacePan !== active) s.spacePan = active;
    });
  },

  /** Add one count symbol to the group in progress and report the group's total. */
  addCount(pageIndex: number, center: Point): Markup | undefined {
    const { doc, history } = requireSession();
    const state = useEditorStore.getState();
    const group = state.countGroup ?? generateNM();
    const active = state.chest?.tools.find((t) => t.id === state.activeToolId);
    const command = addCountCommand(doc, pageIndex, center, {
      subject: active?.subject ?? 'Count',
      author: state.author,
      group,
      ...(active && { style: countStyleOf(active), ...toolKeys(active) }),
    });
    history.run(command);
    const total = doc.markups.filter((m) => countGroupOf(m) === group).length;
    bump({
      countGroup: group,
      selectedId: command.id,
      selectedIds: [command.id],
      status: `Count ${total}`,
    });
    return command.markup;
  },

  /** Selecting any member of a group selects the whole group (Revu behaviour). */
  select(id: string | undefined): void {
    const ids = id ? expandGroups([id]) : [];
    set((s) => {
      s.selectedId = id;
      s.selectedIds = ids;
    });
  },

  /** Shift/Ctrl-click: add to or remove from the selection (whole groups at a time). */
  toggleSelect(id: string): void {
    const members = expandGroups([id]);
    set((s) => {
      if (s.selectedIds.includes(id)) {
        s.selectedIds = s.selectedIds.filter((x) => !members.includes(x));
        s.selectedId = s.selectedIds[s.selectedIds.length - 1];
      } else {
        s.selectedIds = [...s.selectedIds, ...members.filter((m) => !s.selectedIds.includes(m))];
        s.selectedId = id;
      }
    });
  },

  /** Marquee result. `additive` keeps the existing selection (Shift held). */
  selectMany(ids: string[], additive = false): void {
    const expanded = expandGroups(ids);
    set((s) => {
      const base = additive ? s.selectedIds : [];
      const merged = [...base, ...expanded.filter((id) => !base.includes(id))];
      s.selectedIds = merged;
      s.selectedId = merged[merged.length - 1];
    });
  },

  /** Ctrl+G: group the selection under its first markup. */
  group(): void {
    const session = getSession();
    const { selectedIds } = useEditorStore.getState();
    if (!session || selectedIds.length < 2) return;
    const pages = new Set(
      selectedIds.map((id) => session.doc.markups.find((m) => m.id === id)?.pageIndex),
    );
    if (pages.size !== 1) {
      actions.setStatus('A group stays on one page');
      return;
    }
    const command = groupCommand(session.doc, selectedIds);
    session.history.run(command);
    bump({ status: command.label });
  },

  /** Ctrl+Shift+G: dissolve every group in the selection. */
  ungroup(): void {
    const session = getSession();
    const { selectedIds } = useEditorStore.getState();
    if (!session || selectedIds.length === 0) return;
    const command = ungroupCommand(session.doc, selectedIds);
    session.history.run(command);
    bump({ status: command.label });
  },

  /** Ctrl+A: every visible markup on the current page. */
  selectAllOnPage(): void {
    const session = getSession();
    if (!session) return;
    const page = useEditorStore.getState().currentPage;
    const ids = session.doc.markups
      .filter((m) => m.pageIndex === page && !m.flags.hidden)
      .map((m) => m.id);
    actions.selectMany(ids);
    set((s) => {
      s.status = `${ids.length} selected on page ${page + 1}`;
    });
  },

  /**
   * A drag on `draggedId`: if it belongs to a multi-selection the whole selection moves
   * together as one undoable command.
   */
  moveSelected(draggedId: string, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const { selectedIds } = useEditorStore.getState();
    if (selectedIds.length > 1 && selectedIds.includes(draggedId)) {
      const { doc, history } = requireSession();
      const command = moveManyCommand(doc, selectedIds, dx, dy);
      history.run(command);
      bump({ status: command.label });
      return;
    }
    actions.move(draggedId, dx, dy);
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

  /** The Pages tab in the panel replaces the old left thumbnail strip. */
  toggleThumbnails(show?: boolean): void {
    const { panel } = useEditorStore.getState();
    const showing = panel.open && panel.tab === 'pages';
    const next = show ?? !showing;
    set((s) => {
      s.showThumbnails = next;
      if (next) s.panel = { open: true, tab: 'pages' };
      else if (s.panel.tab === 'pages') s.panel.open = false;
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

  /** Calibrate per the current scope: this page, pages like it, or all pages. */
  calibrate(pageIndex: number, scale: Scale, units: UnitFormat): void {
    const { doc, history } = requireSession();
    const pages = pagesInScope(doc.pageSizes, pageIndex, useEditorStore.getState().scaleScope);
    const command = calibratePagesCommand(doc, pages, scale, units);
    history.run(command);
    bump({ status: pages.length === 1 ? `Page ${pageIndex + 1} scale set` : `${command.label}` });
  },

  setScaleScope(scope: ScaleScope): void {
    set((s) => {
      s.scaleScope = scope;
    });
  },

  setPanel(tab: PanelTab): void {
    set((s) => {
      s.panel = { open: true, tab };
    });
  },

  togglePanel(open?: boolean): void {
    set((s) => {
      s.panel.open = open ?? !s.panel.open;
    });
  },

  addLength(pageIndex: number, a: Point, b: Point): Markup | undefined {
    const { doc, history } = requireSession();
    const command = addLengthCommand(doc, pageIndex, a, b, {
      ...measurementOptions('Length'),
    });
    history.run(command);
    bump({
      selectedId: command.id,
      selectedIds: [command.id],
      status: `Length ${command.markup?.text?.contents ?? ''}`,
    });
    return command.markup;
  },

  addArea(pageIndex: number, vertices: Point[]): Markup | undefined {
    const { doc, history } = requireSession();
    const command = addAreaCommand(doc, pageIndex, vertices, {
      ...measurementOptions('Area'),
    });
    history.run(command);
    bump({
      selectedId: command.id,
      selectedIds: [command.id],
      status: `Area ${command.markup?.text?.contents ?? ''}`,
    });
    return command.markup;
  },

  /** Polylength (open) or perimeter (closed) through the given vertices. */
  addPolyline(pageIndex: number, vertices: Point[], closed: boolean): Markup | undefined {
    const { doc, history } = requireSession();
    const command = addPolylineCommand(doc, pageIndex, vertices, {
      ...measurementOptions(closed ? 'Perimeter' : 'Polylength'),
      closed,
    });
    history.run(command);
    bump({
      selectedId: command.id,
      selectedIds: [command.id],
      status: `${command.label} ${command.markup?.text?.contents ?? ''}`,
    });
    return command.markup;
  },

  move(id: string, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const { doc, history } = requireSession();
    if (doc.markups.find((m) => m.id === id)?.flags.locked) return;
    history.run(moveCommand(doc, id, dx, dy));
    bump({ status: `Moved ${id}` });
  },

  /** A plain shape (rectangle, ellipse, line, arrow, polygon, pen). No scale needed. */
  addShape(pageIndex: number, geometry: ShapeGeometry): Markup | undefined {
    const { doc, history } = requireSession();
    const label = SHAPE_LABEL[geometry.kind];
    const state = useEditorStore.getState();
    const active = state.chest?.tools.find((t) => t.id === state.activeToolId);
    const options = {
      subject: active?.kind === geometry.kind ? active.subject : label,
      author: state.author,
      ...(active?.kind === geometry.kind && { style: shapeStyleOf(active), ...toolKeys(active) }),
    };
    const command = addShapeCommand(doc, pageIndex, geometry, options, label);
    history.run(command);
    bump({ selectedId: command.id, selectedIds: [command.id], status: label });
    return command.markup;
  },

  addTextBox(pageIndex: number, rect: Rect, text: string): Markup | undefined {
    const { doc, history } = requireSession();
    const command = addTextBoxCommand(doc, pageIndex, rect, textOptions('textbox', 'Text', text));
    history.run(command);
    bump({ selectedId: command.id, selectedIds: [command.id], status: 'Text box' });
    return command.markup;
  },

  addCallout(pageIndex: number, rect: Rect, target: Point, text: string): Markup | undefined {
    const { doc, history } = requireSession();
    const command = addCalloutCommand(
      doc,
      pageIndex,
      rect,
      target,
      textOptions('callout', 'Callout', text),
    );
    history.run(command);
    bump({ selectedId: command.id, selectedIds: [command.id], status: 'Callout' });
    return command.markup;
  },

  addNote(pageIndex: number, at: Point, text: string): Markup | undefined {
    const { doc, history } = requireSession();
    const state = useEditorStore.getState();
    const active = state.chest?.tools.find((t) => t.id === state.activeToolId);
    const command = addNoteCommand(doc, pageIndex, at, {
      subject: active?.kind === 'note' ? active.subject : 'Note',
      author: state.author,
      text,
      ...(active?.kind === 'note' && { color: fromHex(active.style.fill ?? active.style.stroke) }),
    });
    history.run(command);
    bump({ selectedId: command.id, selectedIds: [command.id], status: 'Note' });
    return command.markup;
  },

  copy(): void {
    const { selectedIds, currentPage } = useEditorStore.getState();
    if (selectedIds.length === 0) return;
    set((s) => {
      s.clipboard = { ids: [...selectedIds], page: currentPage };
      s.status = `Copied ${selectedIds.length}`;
    });
  },

  /** Paste onto the current page. Same page: offset 12 pt; other page: same position. */
  paste(): void {
    const session = getSession();
    const { clipboard, currentPage } = useEditorStore.getState();
    if (!session || clipboard.ids.length === 0) return;
    const ids = clipboard.ids.filter((id) => session.doc.markups.some((m) => m.id === id));
    if (ids.length === 0) return;
    const samePage = clipboard.page === currentPage;
    const command = duplicateCommand(
      session.doc,
      ids,
      currentPage,
      samePage ? 12 : 0,
      samePage ? -12 : 0,
      ids.length === 1 ? 'Paste' : `Paste ${ids.length} markups`,
    );
    session.history.run(command);
    bump({
      selectedId: command.created[command.created.length - 1],
      selectedIds: [...command.created],
      status: command.label,
    });
  },

  /** Ctrl+D: duplicate the selection in place, offset 12 pt. */
  duplicate(): void {
    const session = getSession();
    const { selectedIds } = useEditorStore.getState();
    if (!session || selectedIds.length === 0) return;
    const command = duplicateCommand(
      session.doc,
      selectedIds,
      undefined,
      12,
      -12,
      selectedIds.length === 1 ? 'Duplicate' : `Duplicate ${selectedIds.length} markups`,
    );
    session.history.run(command);
    bump({
      selectedId: command.created[command.created.length - 1],
      selectedIds: [...command.created],
      status: command.label,
    });
  },

  setLocked(ids: string[], locked: boolean): void {
    const session = getSession();
    if (!session || ids.length === 0) return;
    const command = lockCommand(session.doc, ids, locked);
    session.history.run(command);
    bump({ status: command.label });
  },

  setHidden(ids: string[], hidden: boolean): void {
    const session = getSession();
    if (!session || ids.length === 0) return;
    const command = hideCommand(session.doc, ids, hidden);
    session.history.run(command);
    bump({
      status: hidden
        ? `Hid ${ids.length === 1 ? 'markup' : `${ids.length} markups`}`
        : command.label,
      ...(hidden && { selectedId: undefined, selectedIds: [] }),
    });
  },

  /** View › Show hidden markups. */
  showAllHidden(): void {
    const session = getSession();
    if (!session) return;
    const ids = session.doc.markups.filter((m) => m.flags.hidden).map((m) => m.id);
    if (ids.length === 0) {
      actions.setStatus('No hidden markups');
      return;
    }
    actions.setHidden(ids, false);
  },

  reorder(id: string, where: 'front' | 'back'): void {
    const session = getSession();
    if (!session) return;
    const command = reorderCommand(session.doc, id, where);
    session.history.run(command);
    bump({ status: command.label });
  },

  /** Per-markup scale (PLAN §3.7). `scale` null = back to the page scale. */
  setMarkupScale(ids: string[], scale: Scale | null, units?: UnitFormat): void {
    const session = getSession();
    if (!session || ids.length === 0) return;
    const command = markupScaleCommand(session.doc, ids, scale, units);
    session.history.run(command);
    bump({ status: command.label });
  },

  setCaption(ids: string[], show: boolean): void {
    const session = getSession();
    if (!session || ids.length === 0) return;
    const command = captionCommand(session.doc, ids, show);
    session.history.run(command);
    bump({ status: command.label });
  },

  convert(id: string, to: 'area' | 'length'): void {
    const session = getSession();
    if (!session) return;
    const markup = session.doc.markups.find((m) => m.id === id);
    if (!markup) return;
    if (!session.doc.pageScales.get(markup.pageIndex)) {
      actions.setStatus('Calibrate this page first');
      return;
    }
    const command = convertCommand(session.doc, id, to);
    session.history.run(command);
    bump({
      status: command.label,
      selectedId: command.created,
      selectedIds: command.created ? [command.created] : [],
    });
  },

  /** Tool chest: copy a tool right after itself. */
  duplicateTool(id: string): void {
    const { chest } = useEditorStore.getState();
    const tool = chest?.tools.find((t) => t.id === id);
    if (!chest || !tool) return;
    const copy = { ...tool, id: newId(), name: `${tool.name} copy` };
    const at = chest.tools.indexOf(tool) + 1;
    const next: ToolChest = {
      ...chest,
      updatedAt: new Date().toISOString(),
      tools: [...chest.tools.slice(0, at), copy, ...chest.tools.slice(at)],
    };
    set((s) => {
      s.chest = next;
      s.status = `Duplicated "${tool.name}"`;
    });
    void persistChest(next);
  },

  /** Tool chest: move a tool up (-1) or down (+1); quick slots follow the order. */
  moveTool(id: string, delta: -1 | 1): void {
    const { chest } = useEditorStore.getState();
    if (!chest) return;
    const at = chest.tools.findIndex((t) => t.id === id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= chest.tools.length) return;
    const tools = [...chest.tools];
    const [tool] = tools.splice(at, 1);
    tools.splice(to, 0, tool!);
    const next: ToolChest = { ...chest, updatedAt: new Date().toISOString(), tools };
    set((s) => {
      s.chest = next;
    });
    void persistChest(next);
  },

  toggleSnap(): void {
    set((s) => {
      s.snapEnabled = !s.snapEnabled;
      s.status = s.snapEnabled ? 'Snap on' : 'Snap off';
    });
  },

  toggleReview(show?: boolean): void {
    set((s) => {
      s.review = show ?? !s.review;
      if (!s.review) s.laser = false;
      if (s.review) {
        s.tool = 'select';
        s.selectedId = undefined;
        s.selectedIds = [];
        s.status = 'Review mode — Esc to exit';
      }
    });
  },

  toggleLaser(): void {
    set((s) => {
      s.laser = !s.laser;
    });
  },

  /** Current page as PNG at 150 dpi, markups drawn from their appearance streams. */
  async exportPng(): Promise<void> {
    const session = getSession();
    if (!session) return;
    const pageIndex = useEditorStore.getState().currentPage;
    set((s) => {
      s.status = `Rendering page ${pageIndex + 1}…`;
    });
    try {
      const { png, width, height } = await renderPagePng(session.doc, pageIndex, 150);
      const name = `${session.file.name.replace(/\.pdf$/i, '')}.p${pageIndex + 1}.png`;
      downloadBytes(png, name, 'image/png');
      set((s) => {
        s.status = `Exported page ${pageIndex + 1} as ${width}×${height} PNG`;
      });
    } catch (error) {
      set((s) => {
        s.status = `PNG export failed: ${(error as Error).message}`;
      });
    }
  },

  /** Markups summary PDF: thumbnails and a table per marked-up page. */
  async exportSummary(): Promise<void> {
    const session = getSession();
    if (!session) return;
    set((s) => {
      s.status = 'Building markups summary…';
    });
    try {
      const bytes = await buildMarkupsSummary(session.doc, { fileName: session.file.name });
      const name = `${session.file.name.replace(/\.pdf$/i, '')}.summary.pdf`;
      downloadBytes(bytes, name, 'application/pdf');
      set((s) => {
        s.status = `Exported markups summary (${session.doc.markups.length} markups)`;
      });
    } catch (error) {
      set((s) => {
        s.status = `Summary export failed: ${(error as Error).message}`;
      });
    }
  },

  exportCsv(): void {
    const session = getSession();
    if (session)
      downloadMarkupsCsv(session.doc, session.file.name, useEditorStore.getState().chest);
  },

  exportXlsx(): void {
    const session = getSession();
    if (session)
      downloadMarkupsXlsx(session.doc, session.file.name, useEditorStore.getState().chest);
  },

  toggleHelp(show?: boolean): void {
    set((s) => {
      s.showHelp = show ?? !s.showHelp;
    });
  },

  /** Edit the text of a text box, callout or note. */
  setText(id: string, text: string): void {
    const { doc, history } = requireSession();
    const m = doc.markups.find((x) => x.id === id);
    if (!m || (m.text?.contents ?? '') === text) return;
    const command = setTextCommand(doc, id, text);
    history.run(command);
    bump({ status: command.label });
  },

  /** Vertex edit / resize of one markup. */
  setGeometry(id: string, geometry: Geometry): void {
    const { doc, history } = requireSession();
    history.run(geometryCommand(doc, id, geometry));
    const m = doc.markups.find((x) => x.id === id);
    bump({ status: `Edit shape${m?.text?.contents ? ` ${m.text.contents}` : ''}` });
  },

  /** Edit subject/style of the given markups (default: the selection). */
  updateProperties(patch: MarkupPatch, ids?: string[], label?: string): void {
    const session = getSession();
    if (!session) return;
    const targets = ids ?? useEditorStore.getState().selectedIds;
    if (targets.length === 0) return;
    const command = updateCommand(session.doc, targets, patch, label);
    session.history.run(command);
    bump({ status: command.label });
  },

  /** Delete the selected markup (or the given ids). */
  deleteMarkups(ids?: string[]): void {
    const session = getSession();
    if (!session) return;
    const targets = ids ?? useEditorStore.getState().selectedIds;
    const deletable = targets.filter((id) => {
      const m = session.doc.markups.find((x) => x.id === id);
      return m && !m.flags.locked;
    });
    if (deletable.length === 0) return;
    const command = deleteCommand(session.doc, deletable);
    session.history.run(command);
    bump({ selectedId: undefined, selectedIds: [], status: command.label });
  },

  undo(): void {
    const session = getSession();
    if (session && !session.history.canUndo && session.pageHistory.length > 0) {
      void actions.undoPageOperation();
      return;
    }
    const command = session?.history.undo();
    if (!command) return;
    // Keep the selection: a property edit undone should stay editable. A markup that
    // no longer exists simply reads as unselected.
    bump({ status: `Undo ${command.label}` });
  },

  redo(): void {
    const session = getSession();
    const command = session?.history.redo();
    if (!command) return;
    bump({ status: `Redo ${command.label}` });
  },

  async save(
    saveFn: (target: FileTarget, bytes: Uint8Array) => Promise<FileTarget>,
  ): Promise<void> {
    const session = getSession();
    if (!session) return;
    set((s) => {
      s.status = 'Saving…';
    });
    const { bytes, update } = await saveIncremental(session.doc, { finalize: true });
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

async function persistProfile(profile: Profile): Promise<void> {
  try {
    await db.profiles.put({
      id: profile.id,
      json: serializeProfile(profile),
      updatedAt: Date.now(),
    });
  } catch {
    // Storage unavailable: the profile lives for this session only.
  }
}

async function persistChest(chest: ToolChest): Promise<void> {
  try {
    await db.toolchests.put({
      id: chest.id,
      json: serializeToolChest(chest),
      updatedAt: Date.now(),
    });
  } catch {
    // Storage unavailable: the chest lives for this session only.
  }
}

/** Every id plus the other members of the groups they belong to, in order, without repeats. */
function expandGroups(ids: string[]): string[] {
  const doc = getSession()?.doc;
  if (!doc) return ids;
  const out: string[] = [];
  for (const id of ids) {
    const members = doc.markups.some((m) => m.id === id) ? groupMembers(doc, id) : [id];
    for (const m of members) if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** The subject/author/style new measurements take: the active chest tool's, else defaults. */
function measurementOptions(fallbackSubject: string): {
  subject: string;
  author: string;
  style?: Partial<MeasurementStyle>;
  tool?: string;
  attrs?: Record<string, string | number | boolean>;
} {
  const state = useEditorStore.getState();
  const active = state.chest?.tools.find((t) => t.id === state.activeToolId);
  if (!active) return { subject: fallbackSubject, author: state.author };
  return {
    subject: active.subject,
    author: state.author,
    style: measurementStyleOf(active),
    ...toolKeys(active),
  };
}

/** `/RLTool` and the attribute defaults a markup made with `tool` starts with. */
function toolKeys(tool: ChestTool): {
  tool: string;
  attrs?: Record<string, string | number | boolean>;
} {
  const attrs: Record<string, string | number | boolean> = {};
  for (const a of tool.attributes) if (a.default !== undefined) attrs[a.key] = a.default;
  return { tool: tool.id, ...(Object.keys(attrs).length > 0 && { attrs }) };
}

function measurementStyleOf(tool: ChestTool): Partial<MeasurementStyle> {
  const s = tool.style;
  return {
    stroke: fromHex(s.stroke),
    ...(s.fill && { fill: fromHex(s.fill) }),
    ...(s.fillOpacity !== undefined && { fillOpacity: s.fillOpacity }),
    opacity: s.opacity,
    width: s.lineWidth,
    ...(s.lineEnds && { lineEnds: s.lineEnds }),
    ...(s.dash && s.dash.length > 0 && { dash: s.dash }),
    ...(tool.style.font?.size && { captionSize: tool.style.font.size }),
  };
}

function countStyleOf(tool: ChestTool): Partial<CountStyle> {
  const s = tool.style;
  return {
    stroke: fromHex(s.stroke),
    fill: fromHex(s.fill ?? s.stroke),
    ...(s.fillOpacity !== undefined && { fillOpacity: s.fillOpacity }),
    opacity: s.opacity,
    width: s.lineWidth,
  };
}

/** Subject/author/style for a text markup: the active chest tool's when it matches. */
function textOptions(kind: 'textbox' | 'callout', fallbackSubject: string, text: string) {
  const state = useEditorStore.getState();
  const active = state.chest?.tools.find((t) => t.id === state.activeToolId);
  if (!active || active.kind !== kind) {
    return { subject: fallbackSubject, author: state.author, text };
  }
  const s = active.style;
  const style: Partial<TextStyle> = {
    stroke: fromHex(s.stroke),
    ...(s.fill && { fill: fromHex(s.fill) }),
    borderWidth: s.lineWidth,
    opacity: s.opacity,
    ...(s.font?.size && { fontSize: s.font.size }),
  };
  return { subject: active.subject, author: state.author, text, style, ...toolKeys(active) };
}

const SHAPE_LABEL: Record<ShapeGeometry['kind'], string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  polyline: 'Polyline',
  polygon: 'Polygon',
  cloud: 'Cloud',
  pen: 'Pen',
  highlighter: 'Highlight',
};

function shapeStyleOf(tool: ChestTool): Partial<ShapeStyle> {
  const s = tool.style;
  return {
    ...(tool.kind === 'highlighter' && { blend: 'Multiply' as const }),
    stroke: fromHex(s.stroke),
    ...(s.fill && { fill: fromHex(s.fill) }),
    ...(s.fillOpacity !== undefined && { fillOpacity: s.fillOpacity }),
    opacity: s.opacity,
    width: s.lineWidth,
    ...(s.lineEnds && { lineEnds: s.lineEnds }),
    ...(s.dash && s.dash.length > 0 && { dash: s.dash }),
  };
}

/** Which chest kind a markup corresponds to, if any. */
function toolKindOf(m: Markup): ChestTool['kind'] | undefined {
  if (isCount(m)) return 'count';
  if (m.intent === 'LineDimension') return 'length';
  if (m.intent === 'PolygonDimension') return 'area';
  if (m.intent === 'PolyLineDimension') {
    if (m.geometry.kind !== 'poly') return 'polylength';
    const p = m.geometry.points;
    const a = p[0];
    const b = p[p.length - 1];
    return a && b && p.length > 2 && a.x === b.x && a.y === b.y ? 'perimeter' : 'polylength';
  }
  switch (m.rawSubtype) {
    case 'FreeText':
      return m.intent === 'FreeTextCallout' ? 'callout' : 'textbox';
    case 'Text':
      return 'note';
    case 'Square':
      return 'rectangle';
    case 'Circle':
      return 'ellipse';
    case 'Line':
      return m.intent === 'LineArrow' ? 'arrow' : 'line';
    case 'Polygon':
      return m.intent === 'PolygonCloud' || m.style.cloud ? 'cloud' : 'polygon';
    case 'Ink':
      return m.style.blend === 'Multiply' ? 'highlighter' : 'pen';
    default:
      return undefined;
  }
}

/** Pages a scale applies to. "like" = same size and orientation as `pageIndex`. */
function pagesInScope(
  sizes: { width: number; height: number; rotation: number }[],
  pageIndex: number,
  scope: ScaleScope,
): number[] {
  if (scope === 'page') return [pageIndex];
  if (scope === 'all') return sizes.map((_, i) => i);
  const me = sizes[pageIndex];
  if (!me) return [pageIndex];
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return sizes
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) => same(s.width, me.width) && same(s.height, me.height) && s.rotation === me.rotation,
    )
    .map(({ i }) => i);
}

/** UI state plus the live document objects, in the shape the POC components expect. */
export function useEditor() {
  const state = useEditorStore();
  return useMemo(() => {
    const session = getSession();
    return { ...state, doc: session?.doc, pdfjs: session?.pdfjs, file: session?.file };
  }, [state]);
}
