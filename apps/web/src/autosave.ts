/**
 * Autosave and crash recovery. PLAN §4 Phase 1: "Autosave of the working state to
 * OPFS/IndexedDB with crash recovery."
 *
 * What is saved is the same thing Save writes — original bytes plus an incremental
 * update — so a recovered document is a plain PDF and nothing in the file format is
 * Redline-specific. Bytes go to the Origin Private File System when it is writable
 * (Chromium, Firefox); otherwise into an IndexedDB blob via Dexie. Metadata always
 * lives in Dexie so the empty state can list what is recoverable.
 */

import type { RedlineDocument } from '@redline/pdf-core';
import { saveIncremental } from '@redline/pdf-core';
import { db, type AutosaveEntry } from './db';
import type { FileHandleLike } from './fileTarget';

const DEBOUNCE_MS = 1500;
const DIR = 'autosave';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function newAutosaveKey(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

// ---------------------------------------------------------------------------
// Storage

interface OpfsWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface OpfsFileHandle {
  createWritable(): Promise<OpfsWritable>;
  getFile(): Promise<File>;
}

interface OpfsDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
}

async function opfsDirectory(): Promise<OpfsDirectory | undefined> {
  try {
    const storage = navigator.storage as unknown as { getDirectory?: () => Promise<OpfsDirectory> };
    if (typeof storage?.getDirectory !== 'function') return undefined;
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return undefined;
  }
}

async function writeBytes(key: string, bytes: Uint8Array): Promise<'opfs' | 'idb'> {
  const dir = await opfsDirectory();
  if (dir) {
    try {
      const file = await dir.getFileHandle(`${key}.pdf`, { create: true });
      const writable = await file.createWritable();
      await writable.write(bytes);
      await writable.close();
      return 'opfs';
    } catch {
      // Fall through to IndexedDB (e.g. Safari has no createWritable on the main thread).
    }
  }
  await db.autosaveBlobs.put({
    key,
    blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
  });
  return 'idb';
}

async function readBytes(entry: AutosaveEntry): Promise<Uint8Array | undefined> {
  if (entry.store === 'opfs') {
    const dir = await opfsDirectory();
    if (!dir) return undefined;
    try {
      const file = await (await dir.getFileHandle(`${entry.key}.pdf`)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return undefined;
    }
  }
  const row = await db.autosaveBlobs.get(entry.key);
  return row ? new Uint8Array(await row.blob.arrayBuffer()) : undefined;
}

async function removeBytes(entry: AutosaveEntry): Promise<void> {
  if (entry.store === 'opfs') {
    const dir = await opfsDirectory();
    await dir?.removeEntry(`${entry.key}.pdf`).catch(() => undefined);
  } else {
    await db.autosaveBlobs.delete(entry.key).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Public API

export interface AutosaveTarget {
  key: string;
  doc: RedlineDocument;
  name: string;
  handle?: FileHandleLike;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<void>>();

/** Save now (awaits any save in progress for the same key first). */
export async function autosaveNow(
  target: AutosaveTarget,
  onState: (state: AutosaveState) => void,
): Promise<void> {
  const previous = inflight.get(target.key);
  if (previous) await previous.catch(() => undefined);
  const run = (async () => {
    onState('saving');
    try {
      const { bytes } = await saveIncremental(target.doc);
      const store = await writeBytes(target.key, bytes);
      await db.autosaves.put({
        key: target.key,
        name: target.name,
        savedAt: Date.now(),
        size: bytes.byteLength,
        pageCount: target.doc.pdfDoc.getPageCount(),
        store,
        ...(target.handle && { handle: target.handle }),
      });
      onState('saved');
    } catch {
      onState('error');
    }
  })();
  inflight.set(target.key, run);
  try {
    await run;
  } finally {
    if (inflight.get(target.key) === run) inflight.delete(target.key);
  }
}

/** Debounced autosave: many edits in quick succession produce one write. */
export function scheduleAutosave(
  target: AutosaveTarget,
  onState: (state: AutosaveState) => void,
): void {
  const existing = timers.get(target.key);
  if (existing) clearTimeout(existing);
  onState('pending');
  timers.set(
    target.key,
    setTimeout(() => {
      timers.delete(target.key);
      void autosaveNow(target, onState);
    }, DEBOUNCE_MS),
  );
}

/** Drop a pending or stored autosave (after Save, or when the document is closed). */
export async function clearAutosave(key: string): Promise<void> {
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
  await inflight.get(key)?.catch(() => undefined);
  const entry = await db.autosaves.get(key).catch(() => undefined);
  if (entry) await removeBytes(entry);
  await db.autosaves.delete(key).catch(() => undefined);
}

export async function listAutosaves(): Promise<AutosaveEntry[]> {
  try {
    return await db.autosaves.orderBy('savedAt').reverse().toArray();
  } catch {
    return [];
  }
}

/** The bytes of a stored autosave, or undefined when the blob is gone. */
export async function loadAutosave(entry: AutosaveEntry): Promise<Uint8Array | undefined> {
  return readBytes(entry);
}
