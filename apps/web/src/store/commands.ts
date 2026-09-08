/**
 * Commands: every document mutation the UI performs, with its inverse. pdf-core does
 * the work; a command only remembers what it needs to undo.
 */

import type {
  Markup,
  MeasurementOptions,
  PageScale,
  Point,
  RedlineDocument,
  Scale,
  UnitFormat,
} from '@redline/pdf-core';
import {
  addAreaMeasurement,
  addLengthMeasurement,
  clearPageScale,
  deleteMarkup,
  moveMarkup,
  setPageScale,
} from '@redline/pdf-core';

export interface Command {
  readonly label: string;
  do(): void;
  undo(): void;
}

/** Calibrate a page. Undo restores the previous Redline scale, or the document's own. */
export function calibrateCommand(
  doc: RedlineDocument,
  pageIndex: number,
  scale: Scale,
  units: UnitFormat,
): Command {
  let previous: PageScale | undefined;
  let hadOwnViewport = false;
  return {
    label: `Calibrate page ${pageIndex + 1}`,
    do() {
      hadOwnViewport = doc.ownViewports.has(pageIndex);
      previous = doc.pageScales.get(pageIndex);
      setPageScale(doc, pageIndex, scale, units);
    },
    undo() {
      if (hadOwnViewport && previous) setPageScale(doc, pageIndex, previous.scale, previous.units);
      else clearPageScale(doc, pageIndex);
    },
  };
}

export interface AddCommand extends Command {
  /** The `/NM` of the markup this command creates. Stable across undo/redo. */
  readonly id: string;
  /** The markup as last created (the object changes on redo). */
  markup: Markup | undefined;
}

function addCommand(
  label: string,
  create: (nm: string | undefined) => Markup,
  doc: RedlineDocument,
): AddCommand {
  let nm: string | undefined;
  const command: AddCommand = {
    label,
    get id() {
      return nm ?? '';
    },
    markup: undefined,
    do() {
      // Redo re-creates the markup under the SAME /NM so identity survives undo/redo.
      command.markup = create(nm);
      nm = command.markup.id;
    },
    undo() {
      if (nm) deleteMarkup(doc, nm);
      command.markup = undefined;
    },
  };
  return command;
}

export function addLengthCommand(
  doc: RedlineDocument,
  pageIndex: number,
  start: Point,
  end: Point,
  options: MeasurementOptions,
): AddCommand {
  return addCommand(
    'Length',
    (nm) => addLengthMeasurement(doc, pageIndex, start, end, nm ? { ...options, nm } : options),
    doc,
  );
}

export function addAreaCommand(
  doc: RedlineDocument,
  pageIndex: number,
  vertices: Point[],
  options: MeasurementOptions,
): AddCommand {
  return addCommand(
    'Area',
    (nm) => addAreaMeasurement(doc, pageIndex, vertices, nm ? { ...options, nm } : options),
    doc,
  );
}

/** Move a markup. Undo moves it back and restores its previous `/M`. */
export function moveCommand(doc: RedlineDocument, id: string, dx: number, dy: number): Command {
  let previousModified: Date | undefined;
  return {
    label: 'Move',
    do() {
      previousModified = doc.markups.find((m) => m.id === id)?.text?.modified;
      moveMarkup(doc, id, dx, dy);
    },
    undo() {
      moveMarkup(doc, id, -dx, -dy, previousModified ?? new Date());
    },
  };
}
