/**
 * Stamp library glue for the web app: built-in text stamps from pdf-core, user stamps
 * (PNG/JPEG/SVG/PDF) kept in IndexedDB, SVG rasterised here (pdf-core is DOM-free).
 */

import { bakeFields, builtinStamp, type StampArtwork } from '@redline/pdf-core';
import { db, type StampRow } from './db';
import { newId } from '@redline/toolchest';

export interface ActiveStamp {
  kind: 'builtin' | 'user';
  id: string;
}

export interface ResolvedStamp {
  artwork: StampArtwork;
  /** `/Name`. */
  name: string;
  /** `/Contents`. */
  contents: string;
}

const SVG_RASTER_WIDTH = 800;

/** Rasterise an SVG to PNG bytes with an off-screen canvas. */
export async function rasterizeSvg(
  svgText: string,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('SVG could not be decoded'));
      img.src = url;
    });
    const naturalWidth = image.naturalWidth || 400;
    const naturalHeight = image.naturalHeight || 200;
    const scale = SVG_RASTER_WIDTH / naturalWidth;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(naturalWidth * scale);
    canvas.height = Math.round(naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG encode failed');
    return {
      bytes: new Uint8Array(await png.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Import a file as a user stamp: PNG/JPEG as-is, SVG rasterised, PDF kept as vector. */
export async function importStampFile(file: File): Promise<StampRow> {
  const name = file.name.replace(/\.[^.]+$/, '') || 'Stamp';
  const lower = file.name.toLowerCase();
  let row: StampRow;
  if (lower.endsWith('.svg')) {
    const raster = await rasterizeSvg(await file.text());
    row = {
      id: newId(),
      name,
      kind: 'png',
      blob: new Blob([raster.bytes as BlobPart], { type: 'image/png' }),
      createdAt: Date.now(),
    };
  } else if (lower.endsWith('.pdf')) {
    row = { id: newId(), name, kind: 'pdf', blob: file, createdAt: Date.now() };
  } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    row = { id: newId(), name, kind: 'jpg', blob: file, createdAt: Date.now() };
  } else if (lower.endsWith('.png')) {
    row = { id: newId(), name, kind: 'png', blob: file, createdAt: Date.now() };
  } else {
    throw new Error('Stamps can be PNG, JPEG, SVG or PDF files');
  }
  try {
    await db.stamps.put(row);
  } catch {
    // Storage unavailable: the stamp lives for this session only.
  }
  return row;
}

export async function listUserStamps(): Promise<StampRow[]> {
  try {
    return await db.stamps.orderBy('createdAt').toArray();
  } catch {
    return [];
  }
}

export async function removeUserStamp(id: string): Promise<void> {
  try {
    await db.stamps.delete(id);
  } catch {
    // ignore
  }
}

/** Turn the active stamp into artwork plus the baked name/contents for this placement. */
export async function resolveStamp(
  active: ActiveStamp,
  userStamps: readonly StampRow[],
  context: { user: string; customText: string; file?: string; now?: Date },
): Promise<ResolvedStamp> {
  const now = context.now ?? new Date();
  if (active.kind === 'builtin') {
    const stamp = builtinStamp(active.id);
    if (!stamp) throw new Error(`Unknown stamp ${active.id}`);
    const lines = stamp.lines
      .map((line) => line.replace(/\{text\}/g, context.customText || 'STAMP'))
      .map((line) => bakeFields(line, { now, user: context.user, file: context.file }));
    const name = `Redline${stamp.title.replace(/[^A-Za-z0-9]/g, '')}`;
    return {
      artwork: { kind: 'text', lines, color: stamp.color, border: true },
      name,
      contents: lines.join(' '),
    };
  }
  const row = userStamps.find((s) => s.id === active.id);
  if (!row) throw new Error('That stamp is no longer in the library');
  const bytes = new Uint8Array(await row.blob.arrayBuffer());
  const name = `Redline${row.name.replace(/[^A-Za-z0-9]/g, '') || 'Stamp'}`;
  if (row.kind === 'pdf') {
    return { artwork: { kind: 'pdf', bytes }, name, contents: row.name };
  }
  return { artwork: { kind: 'image', format: row.kind, bytes }, name, contents: row.name };
}
