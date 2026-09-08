/**
 * Open documents and their companions, kept OUTSIDE the reactive store.
 *
 * pdf-core mutates `RedlineDocument` in place and immer freezes whatever it produces, so
 * documents must never pass through the Zustand state tree. Components learn about
 * changes through the store's `version` counter and read the live objects from here.
 *
 * Several documents can be open at once (tabs); each has its own undo history.
 */

import type { RedlineDocument } from '@redline/pdf-core';
import type { PdfjsHandle } from '../pdfjs';
import type { FileTarget } from '../fileTarget';
import type { Command } from './commands';

/**
 * Linear undo history. Every user action that touches the document is a `Command`
 * (CLAUDE.md "Undo"); UI-only changes (tool, zoom, selection) are not recorded.
 */
export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  private readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  run(command: Command): void {
    command.do();
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(): Command | undefined {
    const command = this.past.pop();
    if (!command) return undefined;
    command.undo();
    this.future.push(command);
    return command;
  }

  redo(): Command | undefined {
    const command = this.future.pop();
    if (!command) return undefined;
    command.do();
    this.past.push(command);
    return command;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }
}

export interface Session {
  /** App-level id for the tab; unrelated to anything in the PDF. */
  id: string;
  doc: RedlineDocument;
  pdfjs: PdfjsHandle;
  file: FileTarget;
  history: History;
  dirty: boolean;
}

const sessions = new Map<string, Session>();
let activeId: string | undefined;
let counter = 0;

export function newSessionId(): string {
  counter += 1;
  return `doc-${counter}`;
}

/** The active session, if any. */
export function getSession(): Session | undefined {
  return activeId ? sessions.get(activeId) : undefined;
}

export function requireSession(): Session {
  const session = getSession();
  if (!session) throw new Error('No document is open');
  return session;
}

export function getSessionById(id: string): Session | undefined {
  return sessions.get(id);
}

export function listSessions(): Session[] {
  return [...sessions.values()];
}

export function addSession(session: Session): void {
  sessions.set(session.id, session);
  activeId = session.id;
}

export function setActiveSession(id: string): Session | undefined {
  if (!sessions.has(id)) return undefined;
  activeId = id;
  return sessions.get(id);
}

/** Remove a session; returns the session that became active (if any). */
export function removeSession(id: string): Session | undefined {
  const order = [...sessions.keys()];
  const index = order.indexOf(id);
  const closing = sessions.get(id);
  sessions.delete(id);
  closing?.pdfjs.destroy().catch(() => undefined);
  if (activeId === id) {
    const neighbour = order[index + 1] ?? order[index - 1];
    activeId = neighbour && sessions.has(neighbour) ? neighbour : undefined;
  }
  return getSession();
}

/** Swap the document behind a session (after a save re-opens from the saved bytes). */
export function replaceSessionDocument(
  session: Session,
  doc: RedlineDocument,
  pdfjs: PdfjsHandle,
  file: FileTarget,
): void {
  session.pdfjs.destroy().catch(() => undefined);
  session.doc = doc;
  session.pdfjs = pdfjs;
  session.file = file;
  session.history.clear();
  session.dirty = false;
}
