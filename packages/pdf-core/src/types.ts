/**
 * The markup model. PLAN §3.4.
 *
 * Geometry is always PDF user space in points (CLAUDE.md non-negotiable #2). `raw` is the
 * live pdf-lib dictionary: every key Redline does not own lives there and is written back
 * verbatim (non-negotiable #4).
 */

import type { PDFDict, PDFDocument, PDFRef } from '@cantoo/pdf-lib';
import type { Scale, UnitFormat } from './measure/units.js';
import type { Point, Rect } from './measure/geometry.js';

export type { Point, Rect } from './measure/geometry.js';
export type { Scale, UnitFormat, DisplayFormat, PageUnit, WorldUnit } from './measure/units.js';

/** 0..1 per channel, matching PDF `/C` and `/IC` arrays. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type NativeSubtype =
  | 'Line'
  | 'PolyLine'
  | 'Polygon'
  | 'Square'
  | 'Circle'
  | 'Ink'
  | 'FreeText'
  | 'Highlight'
  | 'Underline'
  | 'StrikeOut'
  | 'Text'
  | 'Stamp';

export type MarkupSubtype = NativeSubtype | 'Unknown';

/** Standard `/LE` line endings. Bluebeam adds `Slash`, which round-trips as a string. */
export type LineEnding =
  | 'None'
  | 'Square'
  | 'Circle'
  | 'Diamond'
  | 'OpenArrow'
  | 'ClosedArrow'
  | 'Butt'
  | 'ROpenArrow'
  | 'RClosedArrow'
  | 'Slash';

/**
 * Geometry, discriminated by `kind`. All coordinates are points in the page's user space.
 * `line` holds `/L`, `poly` holds `/Vertices`, `rect` holds `/Rect`, `ink` holds `/InkList`.
 */
export type Geometry =
  | { kind: 'line'; points: [Point, Point] }
  | { kind: 'poly'; points: Point[]; closed: boolean }
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ink'; paths: Point[][] }
  | { kind: 'quads'; quads: number[]; rect: Rect }
  | { kind: 'none'; rect: Rect };

export interface MarkupStyle {
  stroke?: RGB;
  fill?: RGB;
  /** `/CA` — stroke/overall alpha. */
  opacity: number;
  /** Bluebeam's `/FillOpacity`, preserved when present. */
  fillOpacity?: number;
  /** `/BS /W`. */
  width: number;
  /** `/BS /D` dash array, present when `/BS /S` is `/D`. */
  dash?: number[];
  lineEnds?: [LineEnding, LineEnding];
  font?: { family: string; size: number; color?: RGB };
}

export interface MarkupText {
  contents: string;
  subject: string;
  author: string;
  created?: Date;
  modified?: Date;
  /** `/RC` rich text, kept in sync when `/Contents` is edited. */
  richText?: string;
}

export interface MarkupMeasure {
  scale: Scale;
  units: UnitFormat;
  caption: boolean;
  computed: {
    length?: number;
    area?: number;
    perimeter?: number;
    count?: number;
  };
}

export interface Markup {
  /** === `/NM`. 16 uppercase letters. Assigned once, never regenerated. */
  id: string;
  pageIndex: number;
  subtype: MarkupSubtype;
  /** Raw `/Subtype` name — retains Bluebeam subtypes we do not model. */
  rawSubtype: string;
  /** `/IT`. Bluebeam-only intents pass through as plain strings. */
  intent?: string;
  geometry: Geometry;
  /** `/Rect` as stored in the file. */
  rect: Rect;
  style: MarkupStyle;
  text?: MarkupText;
  measure?: MarkupMeasure;
  /** Custom attributes from `/RLAttrs` (tool attributes, count groups). */
  attrs?: Record<string, string | number | boolean>;
  relations: { groupParent?: string; replyTo?: string; layer?: boolean };
  flags: { locked: boolean; hidden: boolean; print: boolean };
  /** The live dictionary. Unknown keys live here and are written back verbatim. */
  raw: PDFDict;
  ref: PDFRef;
  /** Native subtypes draw from `geometry`; everything else rasterises its `/AP`. */
  render: 'native' | 'ap-bitmap';
}

/** A page's calibration, either parsed from an existing `/VP` or set by the user. */
export interface PageScale {
  scale: Scale;
  units: UnitFormat;
  /** True when this came from the file rather than from Redline. */
  fromDocument: boolean;
}

/** An open document: the pdf-lib model plus everything Redline parsed out of it. */
export interface RedlineDocument {
  pdfDoc: PDFDocument;
  /** The bytes as loaded. `saveIncremental` appends to exactly these. */
  originalBytes: Uint8Array;
  markups: Markup[];
  /** Every `/NM` in the file, so new ones never collide. */
  usedNM: Set<string>;
  /** Known page scale per page index. */
  pageScales: Map<number, PageScale>;
  /** Viewport objects Redline itself wrote, so re-calibrating replaces rather than stacks. */
  ownViewports: Map<number, PDFRef>;
  /** Page sizes in points, `[width, height]`, from the CropBox. */
  pageSizes: { width: number; height: number; rotation: number }[];
  /**
   * Deleted markups, still restorable (undo). They are unlinked from `/Annots` but their
   * objects stay in the document until a finalising save (`saveIncremental(doc, { finalize })`).
   */
  trash: DeletedMarkup[];
  /** Highest object number when the document was opened; anything above it is Redline's. */
  baselineObjectNumber: number;
}

export interface DeletedMarkup {
  markup: Markup;
  /** Position in the page's `/Annots` at deletion time, so restore keeps z-order. */
  annotsIndex: number;
  /** Position in `markups` at deletion time. */
  listIndex: number;
  /** The annotation's `/Popup` ref, unlinked with it. */
  popup?: PDFRef;
}
