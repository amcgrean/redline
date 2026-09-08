// pdf.js 6 uses Promise.withResolvers, which arrived in Node 22. Polyfill for Node 20.
type WithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const promiseCtor = Promise as unknown as { withResolvers?: WithResolvers };
if (typeof promiseCtor.withResolvers !== 'function') {
  promiseCtor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// pdf.js 6 also calls ArrayBuffer#transferToFixedLength (Node 21+). Copy semantics are enough.
const abProto = ArrayBuffer.prototype as unknown as {
  transferToFixedLength?: (newLength?: number) => ArrayBuffer;
};
if (typeof abProto.transferToFixedLength !== 'function') {
  abProto.transferToFixedLength = function transferToFixedLength(
    this: ArrayBuffer,
    newLength?: number,
  ): ArrayBuffer {
    const length = newLength ?? this.byteLength;
    const out = new ArrayBuffer(length);
    new Uint8Array(out).set(new Uint8Array(this).subarray(0, Math.min(length, this.byteLength)));
    return out;
  };
}

// pdf.js 6 loads @napi-rs/canvas through process.getBuiltinModule (Node 22.3+).
import { createRequire } from 'node:module';
const proc = process as unknown as { getBuiltinModule?: (name: string) => unknown };
if (typeof proc.getBuiltinModule !== 'function') {
  const require = createRequire(import.meta.url);
  proc.getBuiltinModule = (name: string) =>
    require(name.startsWith('node:') ? name : `node:${name}`);
}

// pdf.js's canvas renderer reaches for browser globals; @napi-rs/canvas provides them.
import * as napiCanvas from '@napi-rs/canvas';

const g = globalThis as unknown as Record<string, unknown>;
for (const name of ['Path2D', 'DOMMatrix', 'ImageData'] as const) {
  if (!g[name] && (napiCanvas as unknown as Record<string, unknown>)[name]) {
    g[name] = (napiCanvas as unknown as Record<string, unknown>)[name];
  }
}

// Dictionary snapshots contain `/CreationDate` and `/M`, which `pdfDate` renders in the local
// timezone. Pin the offset to US Central Daylight Time (UTC-5, what Aaron's PC and the
// checked-in snapshots use) so the same snapshot passes on the UTC CI runner.
Date.prototype.getTimezoneOffset = () => 300;
