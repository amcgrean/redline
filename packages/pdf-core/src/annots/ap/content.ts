/**
 * A tiny PDF content-stream builder for appearance streams.
 *
 * Every operator this emits is PDF 1.4-era and universally supported, which is the point:
 * an `/AP` that Chrome's PDFium, Acrobat and Revu all render identically (PLAN §3.6).
 */

import { StandardFontEmbedder } from '@cantoo/pdf-lib';
import type { RGB } from '../../types.js';
import { round } from '../dict.js';

/** pdf-lib types this parameter with an enum from a transitive package; the value is the name. */
type StandardFontName = Parameters<typeof StandardFontEmbedder.for>[0];

/** Helvetica metrics, used to centre captions. No document state, so it is a module const. */
const HELVETICA = StandardFontEmbedder.for('Helvetica' as StandardFontName);

/** Width of `text` in points at `size`, using Helvetica's real advance widths. */
export function helveticaWidth(text: string, size: number): number {
  return HELVETICA.widthOfTextAtSize(text, size);
}

/** Cap height for Helvetica, near enough for vertically centring a one-line caption. */
export function helveticaCapHeight(size: number): number {
  return size * 0.717;
}

/**
 * Escape a string for a PDF literal string `(...)`.
 *
 * Characters above U+00FF cannot be represented in WinAnsi and are dropped rather than
 * emitted as mojibake; captions only ever contain digits, `'`, `"`, `-`, `/` and unit
 * labels, so this never bites in practice.
 */
export function escapeLiteral(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === '\\' || char === '(' || char === ')') out += `\\${char}`;
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code < 0x20) out += `\\${code.toString(8).padStart(3, '0')}`;
    else if (code <= 0xff) out += code >= 0x80 ? `\\${code.toString(8).padStart(3, '0')}` : char;
  }
  return out;
}

const n = (value: number): string => String(round(value));

/** Accumulates content-stream operators. */
export class ContentBuilder {
  private readonly ops: string[] = [];

  push(op: string): this {
    this.ops.push(op);
    return this;
  }

  save(): this {
    return this.push('q');
  }

  restore(): this {
    return this.push('Q');
  }

  /** Reference an `/ExtGState` in the AP's resources, e.g. for `/CA` and `/ca`. */
  extGState(name: string): this {
    return this.push(`/${name} gs`);
  }

  strokeColor(color: RGB): this {
    return this.push(`${n(color.r)} ${n(color.g)} ${n(color.b)} RG`);
  }

  fillColor(color: RGB): this {
    return this.push(`${n(color.r)} ${n(color.g)} ${n(color.b)} rg`);
  }

  lineWidth(width: number): this {
    return this.push(`${n(width)} w`);
  }

  /** `/BS /D` dashes. An empty array restores a solid line. */
  dash(pattern: readonly number[], phase = 0): this {
    return this.push(`[${pattern.map(n).join(' ')}] ${n(phase)} d`);
  }

  /** Round joins and caps read better on drawing markup than the default mitre. */
  roundJoins(): this {
    return this.push('1 J').push('1 j');
  }

  moveTo(x: number, y: number): this {
    return this.push(`${n(x)} ${n(y)} m`);
  }

  lineTo(x: number, y: number): this {
    return this.push(`${n(x)} ${n(y)} l`);
  }

  rect(x: number, y: number, width: number, height: number): this {
    return this.push(`${n(x)} ${n(y)} ${n(width)} ${n(height)} re`);
  }

  closePath(): this {
    return this.push('h');
  }

  stroke(): this {
    return this.push('S');
  }

  fill(): this {
    return this.push('f');
  }

  fillAndStroke(): this {
    return this.push('B');
  }

  /** Draw a one-line caption in Helvetica. `x`,`y` is the text baseline origin. */
  text(fontName: string, size: number, x: number, y: number, value: string): this {
    return this.push('BT')
      .push(`/${fontName} ${n(size)} Tf`)
      .push(`${n(x)} ${n(y)} Td`)
      .push(`(${escapeLiteral(value)}) Tj`)
      .push('ET');
  }

  toString(): string {
    return this.ops.join('\n');
  }
}
