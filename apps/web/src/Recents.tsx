/**
 * The empty state: drop zone plus recent files. A recent with a File System Access
 * handle reopens in place (after the browser's permission prompt); one without falls
 * back to the file picker.
 */

import { useEffect, useState } from 'react';
import { forgetRecent, listRecents, type RecentEntry } from './db';

interface Props {
  onOpenHandle: (entry: RecentEntry) => Promise<void>;
  onPick: () => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

export function Recents({ onOpenHandle, onPick }: Props) {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listRecents().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="recents" aria-label="Recent files">
      <div className="recents-title">Recent</div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="linklike"
              title={entry.handle ? 'Reopen (save in place)' : 'Reopen from disk'}
              onClick={() => (entry.handle ? void onOpenHandle(entry) : onPick())}
            >
              {entry.name}
            </button>
            <span className="recents-meta">
              {entry.pageCount} pages · {formatSize(entry.size)} ·{' '}
              {new Date(entry.openedAt).toLocaleDateString()}
            </span>
            <button
              type="button"
              className="linklike recents-remove"
              aria-label={`Remove ${entry.name} from recents`}
              onClick={() => {
                if (entry.id !== undefined) void forgetRecent(entry.id);
                setEntries((list) => list.filter((e) => e.id !== entry.id));
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
