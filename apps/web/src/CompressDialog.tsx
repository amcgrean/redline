/**
 * Compress (PLAN §3.9): Optimize (lossless via qpdf) with a before/after size preview,
 * then either replace the open document or download a copy. "Reduce images" is a
 * follow-up (image downsample pipeline).
 */

import { describeSavings, formatBytes } from '@redline/pdf-core';
import { actions, useEditorStore } from './store';

export function CompressDialog({ onClose }: { onClose: () => void }) {
  const compress = useEditorStore((s) => s.compress);
  if (!compress) return null;
  return (
    <div className="dialog" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Compress"
        className="compress-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <strong>Compress</strong>
        <p className="muted small">
          Optimize is lossless: object streams, maximum flate, unreferenced objects dropped. Vector
          content and text are never rasterised.
        </p>
        {compress.phase === 'running' && (
          <div className="status" role="status">
            Optimizing {formatBytes(compress.before)}…
          </div>
        )}
        {compress.phase === 'error' && (
          <div className="status" role="alert">
            {compress.error}
          </div>
        )}
        {compress.phase === 'done' && compress.report && (
          <div className="status" role="status" data-testid="compress-result">
            {describeSavings(compress.report)}
            {compress.report.warnings.length > 0 && (
              <div className="muted small">
                qpdf noted {compress.report.warnings.length} warning
                {compress.report.warnings.length === 1 ? '' : 's'}; the file was still written.
              </div>
            )}
          </div>
        )}
        <div className="row">
          <button type="button" onClick={onClose}>
            {compress.phase === 'done' ? 'Cancel' : 'Close'}
          </button>
          <span className="spacer" />
          <button
            type="button"
            disabled={compress.phase !== 'done'}
            onClick={() => actions.downloadOptimized()}
            title="Save the optimized file next to the original"
          >
            Download copy
          </button>
          <button
            type="button"
            disabled={compress.phase !== 'done'}
            onClick={() => void actions.applyOptimized()}
            title="Replace the open document with the optimized bytes (Save writes them)"
          >
            Use optimized
          </button>
        </div>
      </div>
    </div>
  );
}
