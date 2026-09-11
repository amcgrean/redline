/**
 * A `QpdfRunner` over an Emscripten qpdf build (`@jspawn/qpdf-wasm`: single-threaded,
 * exposes `FS` and `callMain`). The module factory and its options are injected so this
 * file has no import of the WASM package: the web app passes a `locateFile` for the
 * `.wasm` URL, tests pass `wasmBinary` read from disk.
 *
 * One module instance per run: after `callMain` the Emscripten runtime may have exited,
 * and a fresh instance is cheap next to the work qpdf does.
 */

import type { QpdfResult, QpdfRunOptions, QpdfRunner } from './optimize.js';

export interface EmscriptenFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string, opts?: { encoding: 'binary' }): Uint8Array;
  unlink(path: string): void;
}

export interface QpdfModule {
  FS: EmscriptenFS;
  callMain(args: string[]): number;
}

export interface QpdfModuleOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string, prefix: string) => string;
  noInitialRun?: boolean;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

export type QpdfModuleFactory = (options: QpdfModuleOptions) => Promise<QpdfModule>;

export function createQpdfRunner(
  factory: QpdfModuleFactory,
  moduleOptions: Omit<QpdfModuleOptions, 'noInitialRun' | 'print' | 'printErr'> = {},
): QpdfRunner {
  return {
    async run(args, input, options: QpdfRunOptions = {}): Promise<QpdfResult> {
      const withOutput = options.output ?? true;
      let log = '';
      const collect = (text: string) => {
        log += `${text}\n`;
      };
      const mod = await factory({
        ...moduleOptions,
        noInitialRun: true,
        print: collect,
        printErr: collect,
      });
      mod.FS.writeFile('/in.pdf', input);
      let code: number;
      try {
        code = mod.callMain([...args, '/in.pdf', ...(withOutput ? ['/out.pdf'] : [])]);
      } catch (error) {
        // Emscripten throws an ExitStatus for a non-zero exit under some builds.
        const status = (error as { status?: unknown }).status;
        code = typeof status === 'number' ? status : 2;
        if (typeof status !== 'number') log += `${(error as Error).message}\n`;
      }
      let output: Uint8Array | undefined;
      if (withOutput) {
        try {
          output = mod.FS.readFile('/out.pdf', { encoding: 'binary' });
        } catch {
          output = undefined;
        }
      }
      return { code, output, log };
    },
  };
}
