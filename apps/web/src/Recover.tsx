/**
 * Crash recovery: autosaves left behind by a session that did not close cleanly are
 * offered on the empty state. Recover reopens the bytes as a dirty document (Save is
 * still the user's call); Discard deletes them.
 */

import { useEffect, useState } from 'react';
import { listAutosaves } from './autosave';
import type { AutosaveEntry } from './db';
import { actions } from './store';

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export function Recover({ excludeKeys }: { excludeKeys: string[] }) {
  const [entries, setEntries] = useState<AutosaveEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listAutosaves().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = entries.filter((e) => !excludeKeys.includes(e.key));
  if (shown.length === 0) return null;

  return (
    <div className="recover" role="region" aria-label="Unsaved work">
      <div className="recover-title">Unsaved work from a previous session</div>
      <ul>
        {shown.map((entry) => (
          <li key={entry.key}>
            <span className="recover-name">{entry.name}</span>
            <span className="recents-meta">
              {entry.pageCount} pages · {formatSize(entry.size)} · autosaved{' '}
              {new Date(entry.savedAt).toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => {
                void actions.recover(entry);
                setEntries((list) => list.filter((e) => e.key !== entry.key));
              }}
              aria-label={`Recover ${entry.name}`}
            >
              Recover
            </button>
            <button
              type="button"
              className="linklike"
              onClick={() => {
                void actions.discardAutosave(entry.key);
                setEntries((list) => list.filter((e) => e.key !== entry.key));
              }}
              aria-label={`Discard ${entry.name}`}
            >
              Discard
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
