/**
 * `/AP /N` form XObject construction. PLAN §3.6 "Appearance streams" + Appendix A.
 *
 * Chrome's PDFium synthesises appearances only for Square, Circle, Ink, Highlight,
 * Underline, StrikeOut, Squiggly, Text and Popup — a `/Line` or `/Polygon` without an
 * `/AP` renders NOTHING there. So every markup Redline writes gets one, regenerated on
 * every edit (CLAUDE.md non-negotiable #3).
 *
 * Following PLAN Appendix A, `/BBox` equals `/Rect` and `/Matrix` is the identity, so the
 * content stream is written in page user-space coordinates. (BBox and Matrix only have to
 * agree with each other; the identity form keeps the stream readable and matches the
 * example in the plan.)
 */

import type { PDFDict } from '@cantoo/pdf-lib';
import { PDFArray, PDFName, PDFNumber, type PDFContext, type PDFRef } from '@cantoo/pdf-lib';
import type { Rect } from '../../types.js';
import { numArray, round } from '../dict.js';

/** Resource name for the caption font inside an appearance stream. */
export const CAPTION_FONT = 'Helv';
/** Resource name for the alpha ExtGState. */
export const ALPHA_GS = 'GSa';

/**
 * The standard-14 Helvetica font dictionary. No embedding needed and every viewer has it
 * (PLAN §3.6 "Fonts"), so the AP stays self-contained.
 */
function helveticaFontDict(context: PDFContext): PDFDict {
  const font = context.obj({}) as PDFDict;
  font.set(PDFName.of('Type'), PDFName.of('Font'));
  font.set(PDFName.of('Subtype'), PDFName.of('Type1'));
  font.set(PDFName.of('BaseFont'), PDFName.of('Helvetica'));
  font.set(PDFName.of('Encoding'), PDFName.of('WinAnsiEncoding'));
  return font;
}

/** `<< /Type /ExtGState /CA a /ca a [/BM /Multiply] >>` — alpha and, for highlighters, blend. */
function alphaExtGState(
  context: PDFContext,
  strokeAlpha: number,
  fillAlpha: number,
  blend?: 'Multiply',
): PDFDict {
  const gs = context.obj({}) as PDFDict;
  gs.set(PDFName.of('Type'), PDFName.of('ExtGState'));
  gs.set(PDFName.of('CA'), PDFNumber.of(round(strokeAlpha)));
  gs.set(PDFName.of('ca'), PDFNumber.of(round(fillAlpha)));
  if (blend) gs.set(PDFName.of('BM'), PDFName.of(blend));
  return gs;
}

export interface FormXObjectOptions {
  /** `/BBox`, which equals the annotation's `/Rect`. */
  bbox: Rect;
  /** The content stream operators. */
  content: string;
  /** Include the Helvetica font resource (needed whenever a caption is drawn). */
  withFont?: boolean;
  /** When set, adds an `/ExtGState` named `ALPHA_GS` with these alphas (and blend mode). */
  alpha?: { stroke: number; fill: number; blend?: 'Multiply' };
  /** Form or image XObjects the content draws with `/Name Do` (stamps). */
  xobjects?: Record<string, PDFRef>;
}

/**
 * Build the `/AP /N` stream object. Returns the unregistered stream; callers register it
 * and set `/AP << /N ref >>`.
 */
export function buildFormXObject(context: PDFContext, options: FormXObjectOptions) {
  const resources = context.obj({}) as PDFDict;

  const procSet = PDFArray.withContext(context);
  procSet.push(PDFName.of('PDF'));
  if (options.withFont) procSet.push(PDFName.of('Text'));
  resources.set(PDFName.of('ProcSet'), procSet);

  if (options.withFont) {
    const fonts = context.obj({}) as PDFDict;
    fonts.set(PDFName.of(CAPTION_FONT), context.register(helveticaFontDict(context)));
    resources.set(PDFName.of('Font'), fonts);
  }
  if (options.alpha) {
    const states = context.obj({}) as PDFDict;
    states.set(
      PDFName.of(ALPHA_GS),
      context.register(
        alphaExtGState(context, options.alpha.stroke, options.alpha.fill, options.alpha.blend),
      ),
    );
    resources.set(PDFName.of('ExtGState'), states);
  }

  if (options.xobjects) {
    const xobjects = context.obj({}) as PDFDict;
    for (const [name, ref] of Object.entries(options.xobjects)) {
      xobjects.set(PDFName.of(name), ref);
    }
    resources.set(PDFName.of('XObject'), xobjects);
  }

  const identityMatrix = numArray(context, [1, 0, 0, 1, 0, 0]);

  return context.flateStream(options.content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: numArray(context, options.bbox),
    Matrix: identityMatrix,
    Resources: resources,
  });
}

/** Register a form XObject and attach it as the annotation's `/AP /N`. */
export function setAppearance(context: PDFContext, annot: PDFDict, streamRef: PDFRef): void {
  const ap = context.obj({}) as PDFDict;
  ap.set(PDFName.of('N'), streamRef);
  annot.set(PDFName.of('AP'), ap);
}
