/**
 * Where saved bytes go. PLAN §3.2: File System Access API on Chromium with a download
 * fallback everywhere else, behind one small interface.
 */

interface FileSystemWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** The subset of FileSystemFileHandle Redline uses. */
export interface FileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritable>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface PickerWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileHandleLike>;
}

const PDF_TYPES = [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }];

export function supportsSaveInPlace(): boolean {
  return typeof (window as unknown as PickerWindow).showOpenFilePicker === 'function';
}

/** Open through the picker so we hold writable handles. Empty when cancelled/unsupported. */
export async function pickFileHandle(multiple = false): Promise<FileHandleLike[]> {
  const picker = (window as unknown as PickerWindow).showOpenFilePicker;
  if (!picker) return [];
  try {
    return await picker({ types: PDF_TYPES, multiple });
  } catch {
    return [];
  }
}

/**
 * The writable handle behind a dropped file, when the browser offers one (Chromium's
 * `DataTransferItem.getAsFileSystemHandle`). Undefined elsewhere, or for directories.
 */
export async function handleFromDrop(
  item: DataTransferItem | undefined,
): Promise<FileHandleLike | undefined> {
  const getter = (item as unknown as { getAsFileSystemHandle?: () => Promise<unknown> } | undefined)
    ?.getAsFileSystemHandle;
  if (!item || typeof getter !== 'function') return undefined;
  try {
    const handle = (await getter.call(item)) as { kind?: string } | null;
    return handle && handle.kind === 'file' ? (handle as unknown as FileHandleLike) : undefined;
  } catch {
    return undefined;
  }
}

export interface FileTarget {
  name: string;
  /** Present when the file can be written in place. */
  handle?: FileHandleLike;
}

/** Save bytes: in place when we have a handle, otherwise Save As, otherwise download. */
export async function saveBytes(target: FileTarget, bytes: Uint8Array): Promise<FileTarget> {
  if (target.handle) {
    const permission =
      (await target.handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (permission === 'granted') {
      const writable = await target.handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return target;
    }
  }
  const savePicker = (window as unknown as PickerWindow).showSaveFilePicker;
  if (savePicker) {
    try {
      const handle = await savePicker({ suggestedName: target.name, types: PDF_TYPES });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { name: handle.name, handle };
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return target;
    }
  }
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = target.name.replace(/\.pdf$/i, '') + '.redline.pdf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return target;
}
