/**
 * Minimal document/editor state for the POC. Phase 1 replaces this with Zustand + a
 * command stack (CLAUDE.md "Undo: every user action is a command"); the POC keeps a
 * single mutable RedlineDocument and a version counter so React re-renders after
 * pdf-core mutates it in place.
 */

import { useSyncExternalStore } from 'react';
import type {
  Markup,
  PageScale,
  RedlineDocument,
  Scale,
  UnitFormat,
  Point,
} from '@redline/pdf-core';
import {
  addAreaMeasurement,
  addLengthMeasurement,
  moveMarkup,
  openDocument,
  saveIncremental,
  setPageScale,
} from '@redline/pdf-core';
import type { PdfjsHandle } from './pdfjs';
import { loadPdfjs } from './pdfjs';
import type { FileTarget } from './fileTarget';

export type Tool = 'select' | 'calibrate' | 'length' | 'area';

export interface EditorState {
  doc?: RedlineDocument;
  pdfjs?: PdfjsHandle;
  file?: FileTarget;
  tool: Tool;
  selectedId?: string;
  zoom: number;
  /** Bumps on every mutation so subscribers re-render. */
  version: number;
  dirty: boolean;
  status: string;
  author: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let state: EditorState = {
  tool: 'select',
  zoom: 0.35,
  version: 0,
  dirty: false,
  status: 'Drop a PDF to begin',
  author: 'Aaron McGrean',
};

function emit(): void {
  for (const l of listeners) l();
}

function set(patch: Partial<EditorState>): void {
  state = { ...state, ...patch };
  emit();
}

function bump(patch: Partial<EditorState> = {}): void {
  set({ ...patch, version: state.version + 1, dirty: true });
}

export function useEditor(): EditorState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function getState(): EditorState {
  return state;
}

export const actions = {
  async open(bytes: Uint8Array, file: FileTarget): Promise<void> {
    set({ status: `Opening ${file.name}…` });
    state.pdfjs?.destroy().catch(() => undefined);
    const [doc, pdfjs] = await Promise.all([openDocument(bytes), loadPdfjs(bytes)]);
    set({
      doc,
      pdfjs,
      file,
      selectedId: undefined,
      tool: 'select',
      version: state.version + 1,
      dirty: false,
      status: `${file.name}: ${doc.pdfDoc.getPageCount()} pages, ${doc.markups.length} markups`,
    });
  },

  setTool(tool: Tool): void {
    set({ tool, selectedId: undefined });
  },

  select(id: string | undefined): void {
    set({ selectedId: id });
  },

  setZoom(zoom: number): void {
    set({ zoom: Math.min(8, Math.max(0.05, zoom)) });
  },

  setStatus(status: string): void {
    set({ status });
  },

  pageScale(pageIndex: number): PageScale | undefined {
    return state.doc?.pageScales.get(pageIndex);
  },

  calibrate(pageIndex: number, scale: Scale, units: UnitFormat): void {
    if (!state.doc) return;
    setPageScale(state.doc, pageIndex, scale, units);
    bump({ status: `Page ${pageIndex + 1} scale set` });
  },

  addLength(pageIndex: number, a: Point, b: Point): Markup | undefined {
    if (!state.doc) return undefined;
    const markup = addLengthMeasurement(state.doc, pageIndex, a, b, {
      subject: 'Length',
      author: state.author,
    });
    bump({ selectedId: markup.id, status: `Length ${markup.text?.contents ?? ''}` });
    return markup;
  },

  addArea(pageIndex: number, vertices: Point[]): Markup | undefined {
    if (!state.doc) return undefined;
    const markup = addAreaMeasurement(state.doc, pageIndex, vertices, {
      subject: 'Area',
      author: state.author,
    });
    bump({ selectedId: markup.id, status: `Area ${markup.text?.contents ?? ''}` });
    return markup;
  },

  move(id: string, dx: number, dy: number): void {
    if (!state.doc || (dx === 0 && dy === 0)) return;
    moveMarkup(state.doc, id, dx, dy);
    bump({ status: `Moved ${id}` });
  },

  async save(
    saveFn: (target: FileTarget, bytes: Uint8Array) => Promise<FileTarget>,
  ): Promise<void> {
    if (!state.doc || !state.file) return;
    set({ status: 'Saving…' });
    const { bytes, update } = await saveIncremental(state.doc);
    const target = await saveFn(state.file, bytes);
    // Dev only: mirror browser saves into fixtures/out/browser/ for the interop checklist.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')) {
      const name = target.name.replace(/\.pdf$/i, '') + '.browser.pdf';
      await fetch(`/__fixtures/out/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: bytes as BodyInit,
      }).catch(() => undefined);
    }
    // Re-open from the saved bytes so the next save is incremental on top of this one.
    const [doc, pdfjs] = await Promise.all([openDocument(bytes), loadPdfjs(bytes)]);
    state.pdfjs?.destroy().catch(() => undefined);
    set({
      doc,
      pdfjs,
      file: target,
      version: state.version + 1,
      dirty: false,
      status: `Saved ${target.name} (+${update.length} bytes appended)`,
    });
  },
};
