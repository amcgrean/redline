/**
 * Commands: every document mutation the UI performs, with its inverse. pdf-core does
 * the work; a command only remembers what it needs to undo.
 */

import type {
  CountOptions,
  Geometry,
  Markup,
  MarkupPatch,
  MeasurementOptions,
  PageScale,
  Point,
  PolylineOptions,
  RedlineDocument,
  Scale,
  UnitFormat,
} from '@redline/pdf-core';
import {
  addAreaMeasurement,
  addCountMarkup,
  addLengthMeasurement,
  addPolylineMeasurement,
  clearPageScale,
  deleteMarkup,
  moveMarkup,
  restoreMarkup,
  setMarkupGeometry,
  setPageScale,
  updateMarkupProperties,
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

/** Calibrate several pages at once (scope "all" / "like"); one undo restores every page. */
export function calibratePagesCommand(
  doc: RedlineDocument,
  pages: number[],
  scale: Scale,
  units: UnitFormat,
): Command {
  const commands = pages.map((p) => calibrateCommand(doc, p, scale, units));
  return {
    label:
      pages.length === 1 ? `Calibrate page ${pages[0]! + 1}` : `Calibrate ${pages.length} pages`,
    do() {
      for (const c of commands) c.do();
    },
    undo() {
      for (const c of [...commands].reverse()) c.undo();
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

export function addPolylineCommand(
  doc: RedlineDocument,
  pageIndex: number,
  vertices: Point[],
  options: PolylineOptions,
): AddCommand {
  return addCommand(
    options.closed ? 'Perimeter' : 'Polylength',
    (nm) => addPolylineMeasurement(doc, pageIndex, vertices, nm ? { ...options, nm } : options),
    doc,
  );
}

export function addCountCommand(
  doc: RedlineDocument,
  pageIndex: number,
  center: Point,
  options: CountOptions,
): AddCommand {
  return addCommand(
    'Count',
    (nm) => addCountMarkup(doc, pageIndex, center, nm ? { ...options, nm } : options),
    doc,
  );
}

/** Delete markups (Delete key). Undo re-links them at their old positions. */
export function deleteCommand(doc: RedlineDocument, ids: string[]): Command {
  return {
    label: ids.length === 1 ? 'Delete' : `Delete ${ids.length} markups`,
    do() {
      for (const id of ids) deleteMarkup(doc, id);
    },
    undo() {
      // Restore in reverse so list/annots indices land where they were.
      for (const id of [...ids].reverse()) restoreMarkup(doc, id);
    },
  };
}

/** Snapshot of the editable properties, for undo. */
function propertiesOf(m: Markup): MarkupPatch {
  return {
    subject: m.text?.subject ?? '',
    stroke: m.style.stroke ?? { r: 0, g: 0, b: 0 },
    fill: m.style.fill ?? null,
    width: m.style.width,
    opacity: m.style.opacity,
    dash: m.style.dash ?? [],
  };
}

/** Change subject/style on one or more markups; undo restores each one's previous values. */
export function updateCommand(
  doc: RedlineDocument,
  ids: string[],
  patch: MarkupPatch,
  label = 'Edit properties',
): Command {
  const previous = new Map<string, MarkupPatch>();
  return {
    label,
    do() {
      for (const id of ids) {
        const m = doc.markups.find((x) => x.id === id);
        if (!m) continue;
        if (!previous.has(id)) previous.set(id, propertiesOf(m));
        updateMarkupProperties(doc, id, patch);
      }
    },
    undo() {
      for (const id of [...ids].reverse()) {
        const was = previous.get(id);
        if (was) updateMarkupProperties(doc, id, was);
      }
    },
  };
}

/** Deep copy so undo is not affected by later in-place edits. */
function cloneGeometry(g: Geometry): Geometry {
  return JSON.parse(JSON.stringify(g)) as Geometry;
}

/** Vertex edit / resize. Undo puts the previous geometry (and /M) back. */
export function geometryCommand(doc: RedlineDocument, id: string, geometry: Geometry): Command {
  let previous: Geometry | undefined;
  let previousModified: Date | undefined;
  return {
    label: 'Edit shape',
    do() {
      const m = doc.markups.find((x) => x.id === id);
      if (!m) return;
      previous = cloneGeometry(m.geometry);
      previousModified = m.text?.modified;
      setMarkupGeometry(doc, id, cloneGeometry(geometry));
    },
    undo() {
      if (previous)
        setMarkupGeometry(doc, id, cloneGeometry(previous), previousModified ?? new Date());
    },
  };
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
