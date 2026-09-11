/**
 * qpdf in a Web Worker so a multi-megabyte optimize never blocks the UI. One message in,
 * one message out; the module instance is created per run (see pdf-core emscripten.ts).
 *
 * The package's ESM wrapper expects the UMD script to have written `exports.Module` on
 * the global; under Vite's CommonJS interop that never happens, so the script text is
 * evaluated here and the factory taken from its `Module` binding. The `.wasm` is served
 * as an asset and found through `locateFile`.
 */

import qpdfSource from '@jspawn/qpdf-wasm/qpdf.js?raw';
import wasmUrl from '@jspawn/qpdf-wasm/qpdf.wasm?url';
import { createQpdfRunner, type QpdfModuleFactory } from '@redline/pdf-core';

export interface QpdfRequest {
  id: number;
  args: string[];
  input: Uint8Array;
  output: boolean;
}

export interface QpdfResponse {
  id: number;
  code: number;
  output?: Uint8Array;
  log: string;
  error?: string;
}

const factory = new Function(`${qpdfSource}
return Module;`)() as QpdfModuleFactory;

const runner = createQpdfRunner(factory, {
  locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
});

self.onmessage = async (event: MessageEvent<QpdfRequest>) => {
  const { id, args, input, output } = event.data;
  try {
    const result = await runner.run(args, input, { output });
    const response: QpdfResponse = {
      id,
      code: result.code,
      output: result.output,
      log: result.log,
    };
    const transfer = result.output ? [result.output.buffer] : [];
    (self as unknown as Worker).postMessage(response, transfer as Transferable[]);
  } catch (error) {
    const response: QpdfResponse = { id, code: 2, log: '', error: (error as Error).message };
    (self as unknown as Worker).postMessage(response);
  }
};
