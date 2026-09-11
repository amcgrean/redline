/**
 * Compress (PLAN §3.9): two modes with predictable results. Optimize is lossless (qpdf);
 * Reduce images downsamples and re-encodes images then optimizes. Both show the
 * before/after size first; the user then replaces the open document or downloads a copy.
 */

import { describeSavings, formatBytes } from '@redline/pdf-core';
import { actions, useEditorStore } from './store';

const DPIS = [150, 200, 300];
const QUALITIES: { value: number; label: string }[] = [
  { value: 0.6, label: 'Smaller (60)' },
  { value: 0.75, label: 'Balanced (75)' },
  { value: 0.85, label: 'Sharper (85)' },
];

export function CompressDialog({ onClose }: { onClose: () => void }) {
  const compress = useEditorStore((s) => s.compress);
  if (!compress) return null;
  const { phase, mode, dpi, quality } = compress;
  const busy = phase === 'running';
  return (
    <div className="dialog" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-label="Compress"
        className="compress-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <strong>Compress</strong>
        <div className="compress-modes" role="radiogroup" aria-label="Compress mode">
          <label>
            <input
              type="radio"
              name="compress-mode"
              checked={mode === 'optimize'}
              disabled={busy}
              onChange={() => actions.setCompressOptions({ mode: 'optimize' })}
            />{' '}
            Optimize (lossless)
          </label>
          <label>
            <input
              type="radio"
              name="compress-mode"
              checked={mode === 'reduce'}
              disabled={busy}
              onChange={() => actions.setCompressOptions({ mode: 'reduce' })}
            />{' '}
            Reduce images
          </label>
        </div>
        {mode === 'optimize' ? (
          <p className="muted small">
            Object streams, maximum flate, unreferenced objects dropped. Nothing is re-encoded;
            typically 10–30% on vector plan sets.
          </p>
        ) : (
          <div className="compress-options">
            <p className="muted small">
              Scanned pages and photos are downsampled and saved as JPEG, then optimized. Vector
              content and text are never rasterised. Typically 60–85% on scanned sets.
            </p>
            <label>
              Resolution
              <select
                value={dpi}
                disabled={busy}
                aria-label="Image resolution"
                onChange={(e) => actions.setCompressOptions({ dpi: Number(e.target.value) })}
              >
                {DPIS.map((d) => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quality
              <select
                value={quality}
                disabled={busy}
                aria-label="Image quality"
                onChange={(e) => actions.setCompressOptions({ quality: Number(e.target.value) })}
              >
                {QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="muted small">Current size: {formatBytes(compress.before)}</div>
        {phase === 'running' && (
          <div className="status" role="status">
            {compress.progress ?? 'Working…'}
          </div>
        )}
        {phase === 'error' && (
          <div className="status" role="alert">
            {compress.error}
          </div>
        )}
        {phase === 'done' && compress.report && (
          <div className="status" role="status" data-testid="compress-result">
            {describeSavings(compress.report)}
            {compress.report.images !== undefined && (
              <div className="muted small">
                {compress.report.images} image{compress.report.images === 1 ? '' : 's'} re-encoded
                {compress.report.skipped ? `, ${compress.report.skipped} left as is` : ''}.
              </div>
            )}
            {compress.report.warnings.length > 0 && (
              <div className="muted small">
                qpdf noted {compress.report.warnings.length} warning
                {compress.report.warnings.length === 1 ? '' : 's'}; the file was still written.
              </div>
            )}
          </div>
        )}
        <div className="row">
          <button type="button" onClick={onClose} disabled={busy}>
            {phase === 'done' ? 'Cancel' : 'Close'}
          </button>
          <span className="spacer" />
          {phase !== 'done' && (
            <button type="button" disabled={busy} onClick={() => void actions.runCompress()}>
              {busy ? 'Working…' : 'Preview size'}
            </button>
          )}
          <button
            type="button"
            disabled={phase !== 'done'}
            onClick={() => actions.downloadOptimized()}
            title="Save the compressed file next to the original"
          >
            Download copy
          </button>
          <button
            type="button"
            disabled={phase !== 'done'}
            onClick={() => void actions.applyOptimized()}
            title="Replace the open document with the compressed bytes (Save writes them)"
          >
            Use compressed
          </button>
        </div>
      </div>
    </div>
  );
}
