/**
 * Local persistence (Dexie / IndexedDB). PLAN §3.2 "Persistence".
 *
 * Only `recents` for now; profiles, tool chests, stamps and autosave arrive with their
 * phases. File System Access handles are structured-cloneable, so a recent entry can
 * carry the handle and reopen the file in place after a permission prompt.
 */

import Dexie, { type EntityTable } from 'dexie';
import type { FileHandleLike } from './fileTarget';

export interface RecentEntry {
  id?: number;
  name: string;
  openedAt: number;
  size: number;
  pageCount: number;
  /** Present when opened through the File System Access API. */
  handle?: FileHandleLike;
}

const MAX_RECENTS = 20;

export const db = new Dexie('redline') as Dexie & {
  recents: EntityTable<RecentEntry, 'id'>;
};

db.version(1).stores({
  recents: '++id, openedAt, name',
});

/** Record an open. Same-named entries collapse into one so the list stays useful. */
export async function rememberRecent(entry: Omit<RecentEntry, 'id' | 'openedAt'>): Promise<void> {
  try {
    await db.transaction('rw', db.recents, async () => {
      const existing = await db.recents.where('name').equals(entry.name).toArray();
      for (const old of existing) if (old.id !== undefined) await db.recents.delete(old.id);
      await db.recents.add({ ...entry, openedAt: Date.now() });
      const all = await db.recents.orderBy('openedAt').reverse().toArray();
      for (const stale of all.slice(MAX_RECENTS)) {
        if (stale.id !== undefined) await db.recents.delete(stale.id);
      }
    });
  } catch {
    // IndexedDB can be unavailable (private mode, blocked storage); recents are a convenience.
  }
}

export async function listRecents(): Promise<RecentEntry[]> {
  try {
    return await db.recents.orderBy('openedAt').reverse().toArray();
  } catch {
    return [];
  }
}

export async function forgetRecent(id: number): Promise<void> {
  try {
    await db.recents.delete(id);
  } catch {
    // ignore
  }
}
