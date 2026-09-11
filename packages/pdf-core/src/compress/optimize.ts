/**
 * Compress — Optimize mode (PLAN §3.9): lossless rewrite through qpdf. Object streams,
 * flate level 9, unreferenced objects dropped. Typically 10–30% on vector plan sets.
 *
 * pdf-core stays DOM- and WASM-free: the caller supplies a `QpdfRunner` (the web app runs
 * `@jspawn/qpdf-wasm` in a Web Worker; tests run it in Node). This module only decides
 * the qpdf arguments and interprets the result.
 */

export interface QpdfResult {
  /** qpdf exit status: 0 ok, 3 ok with warnings, anything else failed. */
  code: number;
  output?: Uint8Array;
  /** Everything qpdf printed. */
  log: string;
}

export interface QpdfRunOptions {
  /** Append an output file name (default true). `--check` and friends take none. */
  output?: boolean;
}

export interface QpdfRunner {
  /** Run `qpdf <args> in.pdf [out.pdf]` on `input`; `args` excludes the file names. */
  run(args: readonly string[], input: Uint8Array, options?: QpdfRunOptions): Promise<QpdfResult>;
}

export interface OptimizeOptions {
  /** Also linearize (fast web view). Off by default: Revu and Acrobat gain nothing. */
  linearize?: boolean;
}

export const OPTIMIZE_ARGS: readonly string[] = [
  '--object-streams=generate',
  '--compress-streams=y',
  '--recompress-flate',
  '--compression-level=9',
  '--remove-unreferenced-resources=yes',
  '--coalesce-contents',
];

export interface OptimizeReport {
  bytes: Uint8Array;
  before: number;
  after: number;
  /** 0..1, share of the original size saved (negative when qpdf grew the file). */
  saved: number;
  warnings: string[];
}

/** Lossless optimize. Throws when qpdf fails; warnings (exit 3) are returned. */
export async function optimizePdf(
  runner: QpdfRunner,
  input: Uint8Array,
  options: OptimizeOptions = {},
): Promise<OptimizeReport> {
  const args = [...OPTIMIZE_ARGS, ...(options.linearize ? ['--linearize'] : [])];
  const result = await runner.run(args, input);
  if ((result.code !== 0 && result.code !== 3) || !result.output) {
    throw new Error(`qpdf failed (exit ${result.code}): ${firstLine(result.log)}`);
  }
  const warnings = result.log
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return {
    bytes: result.output,
    before: input.length,
    after: result.output.length,
    saved: input.length > 0 ? 1 - result.output.length / input.length : 0,
    warnings,
  };
}

/** qpdf's structural check (`--check`); true when the file parses cleanly. */
export async function checkPdf(runner: QpdfRunner, input: Uint8Array): Promise<boolean> {
  const result = await runner.run(['--check'], input, { output: false });
  return result.code === 0;
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim().length > 0) ?? '';
}

/** `1.5 MB → 1.1 MB (27% smaller)`. */
export function describeSavings(
  report: Pick<OptimizeReport, 'before' | 'after' | 'saved'>,
): string {
  const pct = Math.round(report.saved * 100);
  const trend = pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`;
  return `${formatBytes(report.before)} → ${formatBytes(report.after)} (${trend})`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
