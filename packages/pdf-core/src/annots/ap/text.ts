/**
 * Appearance streams for text markups: text box (`/FreeText`), callout (`/FreeText` with
 * `/IT /FreeTextCallout` and a `/CL` leader) and sticky note (`/Text`).
 *
 * Text is laid out in Helvetica with word wrapping measured from the real AFM widths, so
 * what Chrome/Acrobat/Revu draw from the AP is what Redline showed. Revu regenerates its
 * own appearance from `/DS`/`/RC` when the text is edited there.
 */

import type { Point, Rect, RGB } from '../../types.js';
import { ContentBuilder, helveticaCapHeight, helveticaWidth } from './content.js';
import { ALPHA_GS, CAPTION_FONT } from './form.js';
import type { AppearanceResult } from './measurement.js';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextBoxAppearanceSpec {
  rect: Rect;
  text: string;
  fontSize: number;
  fontColor: RGB;
  align: TextAlign;
  /** Border colour; omit for no border. */
  stroke?: RGB;
  /** Box fill; omit for transparent. */
  fill?: RGB;
  borderWidth: number;
  opacity: number;
  /** Inner padding in points. */
  padding: number;
  /** Callout leader: from the target point (`/CL[0..1]`) to the box edge (`/CL[2..3]`, `/CL[4..5]`). */
  leader?: Point[];
}

/** Line height as a multiple of the font size (Revu uses 1.15). */
export const LINE_HEIGHT = 1.15;

/** Word-wrap `text` to `maxWidth` points at `size`. Explicit newlines are honoured. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      if (current && helveticaWidth(candidate.trimEnd(), size) > maxWidth) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
      // A single word longer than the box: break it by characters.
      while (helveticaWidth(current, size) > maxWidth && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && helveticaWidth(current.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

/** Height a wrapped text needs, including padding; used to size boxes to their contents. */
export function textBoxHeight(lines: number, fontSize: number, padding: number): number {
  return Math.max(1, lines) * fontSize * LINE_HEIGHT + padding * 2;
}

/**
 * Draw a callout arrowhead at `tip` pointing away from `from` (a filled triangle).
 */
function arrowhead(builder: ContentBuilder, from: Point, tip: Point, size: number): Point[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const nx = -uy * (size / 2);
  const ny = ux * (size / 2);
  builder
    .moveTo(tip.x, tip.y)
    .lineTo(bx + nx, by + ny)
    .lineTo(bx - nx, by - ny)
    .closePath()
    .fillAndStroke();
  return [tip, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }];
}

export function buildTextBoxAppearance(spec: TextBoxAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const [x0, y0, x1, y1] = spec.rect;
  const touched: Point[] = [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];

  builder.save();
  if (spec.opacity < 1) builder.extGState(ALPHA_GS);

  // Leader first so the box paints over its end.
  if (spec.leader && spec.leader.length >= 2 && spec.stroke) {
    builder
      .strokeColor(spec.stroke)
      .fillColor(spec.stroke)
      .lineWidth(Math.max(spec.borderWidth, 1));
    const [tip, ...rest] = spec.leader;
    builder.moveTo(tip!.x, tip!.y);
    for (const p of rest) builder.lineTo(p.x, p.y);
    builder.stroke();
    touched.push(...arrowhead(builder, rest[0]!, tip!, Math.max(spec.borderWidth, 1) * 5));
  }

  // Box.
  if (spec.fill || (spec.stroke && spec.borderWidth > 0)) {
    if (spec.stroke) builder.strokeColor(spec.stroke);
    if (spec.fill) builder.fillColor(spec.fill);
    builder.lineWidth(spec.borderWidth);
    const inset = spec.stroke && spec.borderWidth > 0 ? spec.borderWidth / 2 : 0;
    builder.rect(x0 + inset, y0 + inset, x1 - x0 - inset * 2, y1 - y0 - inset * 2);
    builder.push(spec.fill && spec.stroke && spec.borderWidth > 0 ? 'B' : spec.fill ? 'f' : 'S');
  }

  // Text, clipped to the box.
  builder.rect(x0, y0, x1 - x0, y1 - y0).push('W n');
  const innerWidth = Math.max(1, x1 - x0 - spec.padding * 2);
  const lines = wrapText(spec.text, spec.fontSize, innerWidth);
  const lineHeight = spec.fontSize * LINE_HEIGHT;
  let baseline =
    y1 - spec.padding - helveticaCapHeight(spec.fontSize) - (lineHeight - spec.fontSize) / 2;
  builder.fillColor(spec.fontColor);
  for (const line of lines) {
    if (line) {
      const width = helveticaWidth(line, spec.fontSize);
      const x =
        spec.align === 'center'
          ? x0 + (x1 - x0) / 2 - width / 2
          : spec.align === 'right'
            ? x1 - spec.padding - width
            : x0 + spec.padding;
      builder.text(CAPTION_FONT, spec.fontSize, x, baseline, line);
    }
    baseline -= lineHeight;
  }
  builder.restore();

  const pad = Math.max(spec.borderWidth, 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of touched) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    content: builder.toString(),
    bounds: [minX - pad, minY - pad, maxX + pad, maxY + pad],
    withFont: true,
  };
}

export interface NoteAppearanceSpec {
  /** Icon rect (Revu/Acrobat draw notes at 20 x 20 pt). */
  rect: Rect;
  color: RGB;
  opacity: number;
}

/** Sticky-note icon: a speech-bubble rectangle with three lines, in the note colour. */
export function buildNoteAppearance(spec: NoteAppearanceSpec): AppearanceResult {
  const builder = new ContentBuilder();
  const [x0, y0, x1, y1] = spec.rect;
  const w = x1 - x0;
  const h = y1 - y0;
  builder.save();
  if (spec.opacity < 1) builder.extGState(ALPHA_GS);
  builder.strokeColor({ r: 0.2, g: 0.2, b: 0.2 }).fillColor(spec.color).lineWidth(1);
  // Bubble body.
  builder.rect(x0 + 1, y0 + h * 0.25, w - 2, h * 0.7).fillAndStroke();
  // Tail.
  builder
    .moveTo(x0 + w * 0.25, y0 + h * 0.25)
    .lineTo(x0 + w * 0.2, y0 + 1)
    .lineTo(x0 + w * 0.45, y0 + h * 0.25)
    .closePath()
    .fillAndStroke();
  // Text lines.
  builder.strokeColor({ r: 0.2, g: 0.2, b: 0.2 }).lineWidth(1);
  for (const f of [0.75, 0.6, 0.45]) {
    builder
      .moveTo(x0 + w * 0.2, y0 + h * f)
      .lineTo(x0 + w * 0.8, y0 + h * f)
      .stroke();
  }
  builder.restore();
  return { content: builder.toString(), bounds: [x0, y0, x1, y1], withFont: false };
}
