/**
 * Dynamic stamp fields (PLAN §3.9 "Stamps"): `{date}`, `{time}`, `{user}`, `{file}`,
 * `{page}` are replaced at placement time so the value is baked into `/Contents` and
 * the appearance stream. No JavaScript in the file (CLAUDE.md #4 keeps `/Names
 * /JavaScript` untouched, and Redline never adds any).
 */

export interface FieldContext {
  now: Date;
  user: string;
  file?: string;
  /** 1-based page number. */
  page?: number;
  pageCount?: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `09/11/2026` — US order, as Beisser's paperwork reads. */
export function formatStampDate(date: Date): string {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

/** `2:05 PM`. */
export function formatStampTime(date: Date): string {
  const h = date.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(date.getMinutes())} ${suffix}`;
}

export function bakeFields(text: string, context: FieldContext): string {
  return text.replace(/\{(date|time|user|file|page|pages)\}/gi, (_, key: string) => {
    switch (key.toLowerCase()) {
      case 'date':
        return formatStampDate(context.now);
      case 'time':
        return formatStampTime(context.now);
      case 'user':
        return context.user;
      case 'file':
        return context.file ?? '';
      case 'page':
        return context.page === undefined ? '' : String(context.page);
      case 'pages':
        return context.pageCount === undefined ? '' : String(context.pageCount);
      default:
        return '';
    }
  });
}
