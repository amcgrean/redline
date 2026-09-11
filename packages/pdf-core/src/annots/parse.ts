/**
 * Annotation dictionary -> `Markup`. PLAN §3.4.
 *
 * Everything read here is a copy for the UI's benefit; `markup.raw` stays the live
 * dictionary so unknown keys survive (CLAUDE.md non-negotiable #4). The parser is
 * deliberately total: an annotation it does not understand still becomes a `Markup`
 * with `render: 'ap-bitmap'` so it can be selected, moved and saved without loss.
 */

import { PDFArray, PDFDict, PDFName, PDFRef, type PDFPage } from '@cantoo/pdf-lib';
import type {
  Geometry,
  LineEnding,
  Markup,
  MarkupStyle,
  MarkupSubtype,
  NativeSubtype,
  Rect,
} from '../types.js';
import { boundsOf, toPoints } from '../measure/geometry.js';
import {
  lookupArray,
  lookupBool,
  lookupColor,
  lookupDict,
  lookupName,
  lookupNumber,
  lookupText,
  numberArray,
  numberArrayOfArrays,
  parsePdfDate,
} from './dict.js';

/** Subtypes Redline draws itself. Anything else falls back to rasterising its `/AP`. */
const NATIVE_SUBTYPES = new Set<string>([
  'Line',
  'PolyLine',
  'Polygon',
  'Square',
  'Circle',
  'Ink',
  'FreeText',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Text',
  'Stamp',
]);

/** Subtypes the Konva layer can draw from geometry alone (PLAN §3.5). */
const GEOMETRY_RENDERABLE = new Set<string>([
  'Line',
  'PolyLine',
  'Polygon',
  'Square',
  'Circle',
  'Ink',
  'FreeText',
]);

/** Annotation `/F` bit 2 (value 2) is Hidden, bit 3 (value 4) is Print. */
const FLAG_HIDDEN = 1 << 1;
const FLAG_PRINT = 1 << 2;
const FLAG_LOCKED = 1 << 7;

function toRect(values: number[] | undefined): Rect {
  if (!values || values.length < 4) return [0, 0, 0, 0];
  const [a = 0, b = 0, c = 0, d = 0] = values;
  // /Rect is not required to be normalised; Revu sometimes writes y1 < y0.
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

function parseLineEndings(dict: PDFDict): [LineEnding, LineEnding] | undefined {
  const arr = lookupArray(dict, 'LE');
  if (!arr || arr.size() < 2) return undefined;
  const read = (index: number): LineEnding => {
    const item = arr.lookup(index);
    return item instanceof PDFName ? (item.asString().replace(/^\//, '') as LineEnding) : 'None';
  };
  return [read(0), read(1)];
}

function parseStyle(dict: PDFDict): MarkupStyle {
  const border = lookupDict(dict, 'BS');
  const dashArray = border ? numberArray(border, 'D') : undefined;
  const style: MarkupStyle = {
    opacity: lookupNumber(dict, 'CA') ?? 1,
    width: border ? (lookupNumber(border, 'W') ?? 1) : 1,
  };
  const stroke = lookupColor(dict, 'C');
  if (stroke) style.stroke = stroke;
  const fill = lookupColor(dict, 'IC');
  if (fill) style.fill = fill;
  // Bluebeam's own fill alpha; read for display, never rewritten (not an owned key).
  const fillOpacity = lookupNumber(dict, 'FillOpacity');
  if (fillOpacity !== undefined) style.fillOpacity = fillOpacity;
  if (dashArray && dashArray.length) style.dash = dashArray;
  const ends = parseLineEndings(dict);
  if (ends) style.lineEnds = ends;
  if (lookupName(dict, 'BM') === 'Multiply') style.blend = 'Multiply';
  const be = lookupDict(dict, 'BE');
  if (be && lookupName(be, 'S') === 'C') style.cloud = { intensity: lookupNumber(be, 'I') ?? 1 };
  return style;
}

function parseGeometry(subtype: string, dict: PDFDict, rect: Rect): Geometry {
  switch (subtype) {
    case 'Line': {
      const l = numberArray(dict, 'L');
      if (l && l.length >= 4) {
        const [p0, p1] = toPoints(l.slice(0, 4));
        if (p0 && p1) return { kind: 'line', points: [p0, p1] };
      }
      return { kind: 'none', rect };
    }
    case 'PolyLine':
    case 'Polygon': {
      const vertices = numberArray(dict, 'Vertices');
      if (vertices && vertices.length >= 4) {
        return { kind: 'poly', points: toPoints(vertices), closed: subtype === 'Polygon' };
      }
      return { kind: 'none', rect };
    }
    case 'Ink': {
      const paths = numberArrayOfArrays(dict, 'InkList');
      if (paths) return { kind: 'ink', paths: paths.map(toPoints) };
      return { kind: 'none', rect };
    }
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly': {
      const quads = numberArray(dict, 'QuadPoints');
      if (quads) return { kind: 'quads', quads, rect };
      return { kind: 'none', rect };
    }
    case 'Square':
    case 'Circle':
    case 'FreeText':
    case 'Stamp':
    case 'Text':
      return { kind: 'rect', rect };
    default:
      return { kind: 'none', rect };
  }
}

/**
 * `/RT /Group` means the annotation is a member of a Bluebeam group whose parent is
 * `/IRT`; `/RT /R` means it is a reply. Both are read-only for the POC.
 */
function parseRelations(dict: PDFDict): Markup['relations'] {
  const relations: Markup['relations'] = {};
  const replyType = lookupName(dict, 'RT');
  const inReplyTo = dict.get(PDFName.of('IRT'));
  const parentNM =
    inReplyTo instanceof PDFRef
      ? lookupText(dict.context.lookup(inReplyTo, PDFDict), 'NM')
      : inReplyTo instanceof PDFDict
        ? lookupText(inReplyTo, 'NM')
        : undefined;
  if (parentNM) {
    if (replyType === 'Group') relations.groupParent = parentNM;
    else relations.replyTo = parentNM;
  }
  if (dict.has(PDFName.of('OC'))) relations.layer = true;
  return relations;
}

/** Parse one annotation dictionary. `nm` must already be resolved by the caller. */
export function parseAnnotation(ref: PDFRef, dict: PDFDict, pageIndex: number, nm: string): Markup {
  const rawSubtype = lookupName(dict, 'Subtype') ?? 'Unknown';
  const subtype: MarkupSubtype = NATIVE_SUBTYPES.has(rawSubtype)
    ? (rawSubtype as NativeSubtype)
    : 'Unknown';
  const rect = toRect(numberArray(dict, 'Rect'));
  const geometry = parseGeometry(rawSubtype, dict, rect);
  const flagBits = lookupNumber(dict, 'F') ?? 0;

  const markup: Markup = {
    id: nm,
    pageIndex,
    subtype,
    rawSubtype,
    geometry,
    rect,
    style: parseStyle(dict),
    relations: parseRelations(dict),
    flags: {
      hidden: (flagBits & FLAG_HIDDEN) !== 0,
      print: (flagBits & FLAG_PRINT) !== 0,
      locked: (flagBits & FLAG_LOCKED) !== 0,
    },
    raw: dict,
    ref,
    // A geometry-renderable subtype still needs real geometry; otherwise use its /AP.
    render:
      GEOMETRY_RENDERABLE.has(rawSubtype) && geometry.kind !== 'none' ? 'native' : 'ap-bitmap',
  };

  const intent = lookupName(dict, 'IT');
  if (intent) markup.intent = intent;

  const cl = numberArray(dict, 'CL');
  if (cl && cl.length >= 4) markup.callout = toPoints(cl);

  // Redline's own extension key: JSON attributes (docs/extension-keys.md).
  const tool = lookupText(dict, 'RLTool');
  if (tool) markup.tool = tool;
  const attrsJson = lookupText(dict, 'RLAttrs');
  if (attrsJson) {
    try {
      const parsed = JSON.parse(attrsJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        markup.attrs = parsed as Record<string, string | number | boolean>;
      }
    } catch {
      // Malformed JSON is preserved in `raw` and simply not surfaced.
    }
  }

  const contents = lookupText(dict, 'Contents');
  const subject = lookupText(dict, 'Subj');
  const author = lookupText(dict, 'T');
  const richText = lookupText(dict, 'RC');
  if (
    contents !== undefined ||
    subject !== undefined ||
    author !== undefined ||
    richText !== undefined
  ) {
    markup.text = {
      contents: contents ?? '',
      subject: subject ?? '',
      author: author ?? '',
      ...(parsePdfDate(lookupText(dict, 'CreationDate')) && {
        created: parsePdfDate(lookupText(dict, 'CreationDate')),
      }),
      ...(parsePdfDate(lookupText(dict, 'M')) && { modified: parsePdfDate(lookupText(dict, 'M')) }),
      ...(richText !== undefined && { richText }),
    };
  }

  // `/Cap` is Revu's "show the caption" flag; the measure block is filled in by
  // `openDocument`, which knows the page's scale.
  if (intent?.endsWith('Dimension') || dict.has(PDFName.of('Measure'))) {
    markup.measure = {
      scale: { pageLength: 1, pageUnit: 'in', worldLength: 1, worldUnit: 'ft' },
      units: { display: 'ft-in', precision: 16 },
      caption: lookupBool(dict, 'Cap') ?? false,
      computed: {},
    };
  }
  return markup;
}

/** Every `/NM` already used in the document, so new markups never collide. */
export function collectUsedNM(pages: PDFPage[]): Set<string> {
  const used = new Set<string>();
  for (const page of pages) {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const dict = annots.lookup(i);
      if (!(dict instanceof PDFDict)) continue;
      const nm = lookupText(dict, 'NM');
      if (nm) used.add(nm);
    }
  }
  return used;
}

/** Bounds of a markup's geometry, or its `/Rect` when it has none. */
export function geometryBounds(markup: Markup): Rect {
  const { geometry } = markup;
  switch (geometry.kind) {
    case 'line':
      return boundsOf(geometry.points);
    case 'poly':
      return boundsOf(geometry.points);
    case 'ink':
      return boundsOf(geometry.paths.flat());
    case 'rect':
    case 'quads':
    case 'none':
      return markup.rect;
  }
}
