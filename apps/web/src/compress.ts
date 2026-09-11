/**
 * Compress from the app: a `QpdfRunner` whose work happens in `qpdf.worker.ts`.
 */

import type { QpdfResult, QpdfRunOptions, QpdfRunner } from '@redline/pdf-core';
import type { QpdfRequest, QpdfResponse } from './workers/qpdf.worker';

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, (r: QpdfResult) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./workers/qpdf.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<QpdfResponse>) => {
      const { id, code, output, log, error } = event.data;
      const resolve = pending.get(id);
      pending.delete(id);
      resolve?.({ code, output, log: error ? `${log}\n${error}` : log });
    };
    worker.onerror = (event) => {
      for (const [id, resolve] of pending) {
        pending.delete(id);
        resolve({ code: 2, log: event.message });
      }
    };
  }
  return worker;
}

export const workerQpdf: QpdfRunner = {
  run(args, input, options: QpdfRunOptions = {}): Promise<QpdfResult> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      // Copy: the caller keeps its bytes; the worker gets its own buffer.
      const copy = new Uint8Array(input);
      const request: QpdfRequest = {
        id,
        args: [...args],
        input: copy,
        output: options.output ?? true,
      };
      getWorker().postMessage(request, [copy.buffer]);
    });
  },
};
