/**
 * Print: hand the current document state (original bytes + an incremental update, the
 * same bytes Save would write) to the browser's PDF engine in a hidden iframe and print
 * from there. Markups print because they carry /F 4 and a real /AP — this is interop
 * checklist row 12 exercised from inside the app. The open session is not modified.
 */

import type { RedlineDocument } from '@redline/pdf-core';
import { saveIncremental } from '@redline/pdf-core';

let frame: HTMLIFrameElement | undefined;
let objectUrl: string | undefined;

export async function printDocument(doc: RedlineDocument): Promise<void> {
  const { bytes } = await saveIncremental(doc);
  if (frame) frame.remove();
  if (objectUrl) URL.revokeObjectURL(objectUrl);

  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  objectUrl = URL.createObjectURL(blob);

  frame = document.createElement('iframe');
  frame.setAttribute('data-print', 'true');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  frame.src = objectUrl;
  const target = frame;
  target.addEventListener('load', () => {
    try {
      target.contentWindow?.focus();
      target.contentWindow?.print();
    } catch {
      // Some engines refuse scripted print from a PDF frame; the user can print from the tab.
      window.open(objectUrl, '_blank', 'noopener');
    }
  });
  document.body.appendChild(frame);
}
