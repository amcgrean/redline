/**
 * Commands: every document mutation the UI performs, with its inverse. pdf-core does
 * the work; a command only remembers what it needs to undo.
 */

import type {
  CountOptions,
  Geometry,
  ShapeGeometry,
  ShapeOptions,
  TextOptions,
  NoteOptions,
  Rect,
  Markup,
  MarkupPatch,
  MeasurementOptions,
  PageScale,
  Point,
  PolylineOptions,
  RedlineDocument,
  Scale,
  UnitFormat,
  StampSource,
  StampOptions,
  StampPlacement,
  MarkupOrder,
} from '@redline/pdf-core';
import {
  addAreaMeasurement,
  addCountMarkup,
  addLengthMeasurement,
  addPolylineMeasurement,
  addShapeMarkup,
  addTextBox,
  addCallout,
  addNote,
  setMarkupText,
  duplicateMarkup,
  setMarkupLocked,
  addStamp,
  stampPages,
  setMarkupHidden,
  reorderMarkup,
  setMarkupOrder,
  setMeasurementCaption,
  restoreMarkup,
  clearPageScale,
  deleteMarkup,
  moveMarkup,
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

export function addShapeCommand(
  doc: RedlineDocument,
  pageIndex: number,
  geometry: ShapeGeometry,
  options: ShapeOptions,
  label: string,
): AddCommand {
  return addCommand(
    label,
    (nm) => addShapeMarkup(doc, pageIndex, geometry, nm ? { ...options, nm } : options),
    doc,
  );
}

export function addTextBoxCommand(
  doc: RedlineDocument,
  pageIndex: number,
  rect: Rect,
  options: TextOptions,
): AddCommand {
  return addCommand(
    'Text box',
    (nm) => addTextBox(doc, pageIndex, rect, nm ? { ...options, nm } : options),
    doc,
  );
}

export function addCalloutCommand(
  doc: RedlineDocument,
  pageIndex: number,
  rect: Rect,
  target: Point,
  options: TextOptions,
): AddCommand {
  return addCommand(
    'Callout',
    (nm) => addCallout(doc, pageIndex, rect, target, nm ? { ...options, nm } : options),
    doc,
  );
}

export function addNoteCommand(
  doc: RedlineDocument,
  pageIndex: number,
  at: Point,
  options: NoteOptions,
): AddCommand {
  return addCommand(
    'Note',
    (nm) => addNote(doc, pageIndex, at, nm ? { ...options, nm } : options),
    doc,
  );
}

/** Change a markup's text. Undo restores the previous text and /M. */
export function setTextCommand(doc: RedlineDocument, id: string, text: string): Command {
  let previous: string | undefined;
  let previousModified: Date | undefined;
  return {
    label: 'Edit text',
    do() {
      const m = doc.markups.find((x) => x.id === id);
      if (!m) return;
      previous = m.text?.contents ?? '';
      previousModified = m.text?.modified;
      setMarkupText(doc, id, text);
    },
    undo() {
      if (previous !== undefined) setMarkupText(doc, id, previous, previousModified ?? new Date());
    },
  };
}

export function addStampCommand(
  doc: RedlineDocument,
  pageIndex: number,
  rect: Rect,
  source: StampSource,
  options: StampOptions,
): AddCommand {
  return addCommand(
    'Stamp',
    (nm) => addStamp(doc, pageIndex, rect, source, nm ? { ...options, nm } : options),
    doc,
  );
}

/** Stamp every page; undo removes them all; redo re-creates them under the same /NMs. */
export function stampPagesCommand(
  doc: RedlineDocument,
  source: StampSource,
  placement: StampPlacement,
  options: Omit<StampOptions, 'nm'>,
): Command & { created: string[] } {
  let nms: string[] | undefined;
  const command = {
    label: `Stamp ${doc.pageSizes.length} pages`,
    created: [] as string[],
    do() {
      const marks = stampPages(doc, source, placement, nms ? { ...options, nms } : options);
      nms = marks.map((m) => m.id);
      command.created = [...nms];
    },
    undo() {
      for (const nm of [...command.created].reverse()) deleteMarkup(doc, nm);
    },
  };
  return command;
}

/**
 * Duplicate / paste: clones of `ids` on `pageIndex`, offset by (dx, dy). Redo re-creates
 * the clones under the same /NMs; undo deletes them.
 */
export function duplicateCommand(
  doc: RedlineDocument,
  ids: string[],
  pageIndex: number | undefined,
  dx: number,
  dy: number,
  label: string,
): Command & { created: string[] } {
  const nms: (string | undefined)[] = ids.map(() => undefined);
  const command = {
    label,
    created: [] as string[],
    do() {
      command.created = [];
      ids.forEach((id, i) => {
        if (!doc.markups.some((m) => m.id === id)) return;
        const nm = nms[i];
        const copy = duplicateMarkup(doc, id, {
          ...(pageIndex !== undefined && { pageIndex }),
          dx,
          dy,
          ...(nm && { nm }),
        });
        nms[i] = copy.id;
        command.created.push(copy.id);
      });
    },
    undo() {
      for (const nm of [...command.created].reverse()) deleteMarkup(doc, nm);
    },
  };
  return command;
}

export function lockCommand(doc: RedlineDocument, ids: string[], locked: boolean): Command {
  const previous = new Map<string, boolean>();
  return {
    label: locked ? 'Lock' : 'Unlock',
    do() {
      for (const id of ids) {
        const m = doc.markups.find((x) => x.id === id);
        if (!m) continue;
        if (!previous.has(id)) previous.set(id, m.flags.locked);
        setMarkupLocked(doc, id, locked);
      }
    },
    undo() {
      for (const [id, was] of previous) {
        if (doc.markups.some((x) => x.id === id)) setMarkupLocked(doc, id, was);
      }
    },
  };
}

export function hideCommand(doc: RedlineDocument, ids: string[], hidden: boolean): Command {
  const previous = new Map<string, boolean>();
  return {
    label: hidden ? 'Hide' : 'Show',
    do() {
      for (const id of ids) {
        const m = doc.markups.find((x) => x.id === id);
        if (!m) continue;
        if (!previous.has(id)) previous.set(id, m.flags.hidden);
        setMarkupHidden(doc, id, hidden);
      }
    },
    undo() {
      for (const [id, was] of previous) {
        if (doc.markups.some((x) => x.id === id)) setMarkupHidden(doc, id, was);
      }
    },
  };
}

export function reorderCommand(doc: RedlineDocument, id: string, where: 'front' | 'back'): Command {
  let previous: MarkupOrder | undefined;
  return {
    label: where === 'front' ? 'Bring to front' : 'Send to back',
    do() {
      previous = reorderMarkup(doc, id, where);
    },
    undo() {
      if (previous && doc.markups.some((x) => x.id === id)) setMarkupOrder(doc, id, previous);
    },
  };
}

export function captionCommand(doc: RedlineDocument, ids: string[], show: boolean): Command {
  const previous = new Map<string, boolean>();
  return {
    label: show ? 'Show caption' : 'Hide caption',
    do() {
      for (const id of ids) {
        const m = doc.markups.find((x) => x.id === id);
        if (!m?.measure) continue;
        if (!previous.has(id)) previous.set(id, m.measure.caption !== false);
        setMeasurementCaption(doc, id, show);
      }
    },
    undo() {
      for (const [id, was] of previous) {
        if (doc.markups.some((x) => x.id === id)) setMeasurementCaption(doc, id, was);
      }
    },
  };
}

/**
 * Convert a plain rectangle into an area measurement, or a plain line into a length.
 * The original goes to the trash (restored on undo); the measurement is a new markup
 * that keeps the subject, author and colours.
 */
export function convertCommand(
  doc: RedlineDocument,
  id: string,
  to: 'area' | 'length',
): Command & { created?: string } {
  let nm: string | undefined;
  const command = {
    label: to === 'area' ? 'Convert to area' : 'Convert to length',
    created: undefined as string | undefined,
    do() {
      const old = doc.markups.find((x) => x.id === id);
      if (!old) return;
      const options = {
        subject: old.text?.subject || (to === 'area' ? 'Area' : 'Length'),
        author: old.text?.author ?? '',
        style: { stroke: old.style.stroke, width: old.style.width, opacity: old.style.opacity },
        ...(old.tool && { tool: old.tool }),
        ...(old.attrs && { attrs: old.attrs }),
        ...(nm && { nm }),
      };
      const pageIndex = old.pageIndex;
      deleteMarkup(doc, id);
      let made;
      if (to === 'area') {
        const [x0, y0, x1, y1] = old.geometry.kind === 'rect' ? old.geometry.rect : old.rect;
        made = addAreaMeasurement(
          doc,
          pageIndex,
          [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
          options,
        );
      } else {
        const [a, b] =
          old.geometry.kind === 'line'
            ? old.geometry.points
            : [
                { x: old.rect[0], y: old.rect[1] },
                { x: old.rect[2], y: old.rect[3] },
              ];
        made = addLengthMeasurement(doc, pageIndex, a, b, options);
      }
      nm = made.id;
      command.created = made.id;
    },
    undo() {
      if (command.created) deleteMarkup(doc, command.created);
      restoreMarkup(doc, id);
      command.created = undefined;
    },
  };
  return command;
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

/** Move several markups by the same delta (group drag). One undo restores all. */
export function moveManyCommand(
  doc: RedlineDocument,
  ids: string[],
  dx: number,
  dy: number,
): Command {
  const previous = new Map<string, Date | undefined>();
  return {
    label: ids.length === 1 ? 'Move' : `Move ${ids.length} markups`,
    do() {
      for (const id of ids) {
        const m = doc.markups.find((x) => x.id === id);
        if (!m) continue;
        if (!previous.has(id)) previous.set(id, m.text?.modified);
        moveMarkup(doc, id, dx, dy);
      }
    },
    undo() {
      for (const id of [...ids].reverse()) {
        if (!doc.markups.some((x) => x.id === id)) continue;
        moveMarkup(doc, id, -dx, -dy, previous.get(id) ?? new Date());
      }
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
