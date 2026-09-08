/**
 * The open document and its companions, kept OUTSIDE the reactive store.
 *
 * pdf-core mutates `RedlineDocument` in place and immer freezes whatever it produces, so
 * the document must never pass through the Zustand state tree. Components learn about
 * changes through the store's `version` counter and read the live objects from here.
 */

import type { RedlineDocument } from '@redline/pdf-core';
import type { PdfjsHandle } from '../pdfjs';
import type { FileTarget } from '../fileTarget';
import type { Command } from './commands';

export interface Session {
  doc: RedlineDocument;
  pdfjs: PdfjsHandle;
  file: FileTarget;
}

let current: Session | undefined;

export function getSession(): Session | undefined {
  return current;
}

export function requireSession(): Session {
  if (!current) throw new Error('No document is open');
  return current;
}

export function setSession(session: Session | undefined): void {
  current = session;
}

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

export const history = new History();
