/**
 * Markups summary (PLAN §3.10): a PDF for sending to a customer or a subcontractor. One
 * section per page that carries markups: a thumbnail of the page with its markups drawn,
 * then a table (subject, type, value, author, date, comment). Built with pdf-lib and the
 * standard Helvetica, so the file is small and opens anywhere.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { countGroupOf, saveIncremental, type RedlineDocument } from '@redline/pdf-core';
import { loadPdfjs } from './pdfjs';
import { canvasToPng, renderPageCanvas } from './exportPng';
import { markupRows, type ExportRow } from './export';

const PAGE: [number, number] = [792, 612]; // Letter landscape
const MARGIN = 36;
const THUMB_W = 300;
const BODY = 9;
const LINE = 12;

interface Layout {
  pdf: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  pageNo: number;
  title: string;
}

function newPage(layout: Layout): void {
  layout.page = layout.pdf.addPage(PAGE);
  layout.pageNo += 1;
  layout.y = PAGE[1] - MARGIN;
  layout.page.drawText(layout.title, {
    x: MARGIN,
    y: layout.y - 10,
    size: 10,
    font: layout.bold,
    color: rgb(0.2, 0.2, 0.2),
  });
  layout.page.drawText(`Page ${layout.pageNo}`, {
    x: PAGE[0] - MARGIN - 40,
    y: layout.y - 10,
    size: 9,
    font: layout.font,
    color: rgb(0.4, 0.4, 0.4),
  });
  layout.y -= 28;
}

function ensure(layout: Layout, height: number): void {
  if (layout.y - height < MARGIN) newPage(layout);
}

/** Greedy word wrap for one column. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** Characters WinAnsi cannot carry are replaced so `drawText` never throws. */
const EXTRA = new Set(['–', '—', '‘', '’', '“', '”', '•', '…']);
function safe(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += (code >= 0x20 && code <= 0xff) || EXTRA.has(ch) ? ch : '?';
  }
  return out;
}

const COLUMNS: { key: keyof ExportRow | 'comment'; label: string; width: number }[] = [
  { key: 'subject', label: 'Subject', width: 110 },
  { key: 'type', label: 'Type', width: 70 },
  { key: 'value', label: 'Value', width: 80 },
  { key: 'author', label: 'Author', width: 90 },
  { key: 'modified', label: 'Date', width: 64 },
  { key: 'comment', label: 'Comment', width: 0 }, // fills the rest
];

export interface SummaryOptions {
  fileName: string;
  /** Thumbnail scale (× 72 dpi). */
  thumbScale?: number;
}

/** Build the summary PDF for every page of `doc` that has markups. */
export async function buildMarkupsSummary(
  doc: RedlineDocument,
  options: SummaryOptions,
): Promise<Uint8Array> {
  const rows = markupRows(doc);
  const byPage = new Map<number, ExportRow[]>();
  for (const r of rows) {
    const list = byPage.get(r.page) ?? [];
    list.push(r);
    byPage.set(r.page, list);
  }
  const comments = new Map<string, string>();
  for (const m of doc.markups) {
    comments.set(m.id, countGroupOf(m) ? '' : (m.text?.contents ?? ''));
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const layout: Layout = {
    pdf,
    font,
    bold,
    page: undefined as unknown as PDFPage,
    y: 0,
    pageNo: 0,
    title: `Markups summary — ${options.fileName} — ${new Date().toLocaleDateString()} — ${rows.length} markup${rows.length === 1 ? '' : 's'} on ${byPage.size} page${byPage.size === 1 ? '' : 's'}`,
  };
  newPage(layout);
  if (rows.length === 0) {
    layout.page.drawText('No markups.', { x: MARGIN, y: layout.y, size: BODY, font });
    return pdf.save({ useObjectStreams: false });
  }

  const { bytes } = await saveIncremental(doc);
  const handle = await loadPdfjs(bytes);
  try {
    const tableX = MARGIN + THUMB_W + 16;
    const tableW = PAGE[0] - MARGIN - tableX;
    const fixed = COLUMNS.reduce((n, c) => n + c.width, 0);
    const widths = COLUMNS.map((c) => (c.width || Math.max(80, tableW - fixed)) - 6);

    for (const [pageNumber, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      // Section heading + thumbnail.
      const render = await renderPageCanvas(handle, pageNumber, options.thumbScale ?? 0.5);
      const png = await pdf.embedPng(await canvasToPng(render.canvas));
      render.canvas.width = 0;
      render.canvas.height = 0;
      const ratio = Math.min(THUMB_W / png.width, 220 / png.height);
      const thumbH = png.height * ratio;
      ensure(layout, Math.max(thumbH, 40) + 30);
      layout.page.drawText(
        `Sheet page ${pageNumber} · ${pageRows.length} markup${pageRows.length === 1 ? '' : 's'}`,
        {
          x: MARGIN,
          y: layout.y,
          size: 11,
          font: bold,
        },
      );
      layout.y -= 16;
      const sectionTop = layout.y;
      layout.page.drawImage(png, {
        x: MARGIN,
        y: sectionTop - thumbH,
        width: png.width * ratio,
        height: thumbH,
      });
      layout.page.drawRectangle({
        x: MARGIN,
        y: sectionTop - thumbH,
        width: png.width * ratio,
        height: thumbH,
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 0.5,
      });

      // Table header.
      let x = tableX;
      COLUMNS.forEach((c, i) => {
        layout.page.drawText(c.label, { x, y: layout.y, size: BODY, font: bold });
        x += widths[i]! + 6;
      });
      layout.y -= LINE + 2;
      let tableBottom = layout.y;

      for (const r of pageRows) {
        const cells = COLUMNS.map((c, i) => {
          const raw =
            c.key === 'comment'
              ? (comments.get(r.id) ?? '')
              : c.key === 'modified'
                ? r.modified.slice(0, 10)
                : String(r[c.key] ?? '');
          return wrap(font, safe(raw), BODY, widths[i]!);
        });
        const lines = Math.max(...cells.map((c) => c.length));
        const height = lines * LINE + 3;
        if (layout.y - height < MARGIN) {
          newPage(layout);
          layout.page.drawText(`Sheet page ${pageNumber} (continued)`, {
            x: MARGIN,
            y: layout.y,
            size: 11,
            font: bold,
          });
          layout.y -= 16;
          let hx = tableX;
          COLUMNS.forEach((c, i) => {
            layout.page.drawText(c.label, { x: hx, y: layout.y, size: BODY, font: bold });
            hx += widths[i]! + 6;
          });
          layout.y -= LINE + 2;
        }
        let cx = tableX;
        cells.forEach((cellLines, i) => {
          cellLines.forEach((line, k) => {
            layout.page.drawText(line, { x: cx, y: layout.y - k * LINE, size: BODY, font });
          });
          cx += widths[i]! + 6;
        });
        layout.y -= height;
        tableBottom = layout.y;
      }
      layout.y = Math.min(tableBottom, sectionTop - thumbH) - 18;
    }
  } finally {
    await handle.destroy();
  }
  return pdf.save({ useObjectStreams: false });
}
