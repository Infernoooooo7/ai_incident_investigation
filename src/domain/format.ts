/**
 * Deterministic, locale-independent formatting helpers. Times are shown in UTC
 * so that an incident timeline reads the same for everyone looking at it.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function parseDate(iso: string): Date | undefined {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Milliseconds between two ISO timestamps, or undefined if either is invalid. */
export function msBetween(startIso: string, endIso: string): number | undefined {
  const start = parseDate(startIso);
  const end = parseDate(endIso);
  if (!start || !end) return undefined;
  return end.getTime() - start.getTime();
}

/** "640 ms", "30.0 s", "10m 05s", "1h 02m". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m ${pad(seconds)}s`;
}

/** Offset from the start of a run, e.g. "+00:31.2" or "+1:02:03.0". */
export function formatOffset(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const sign = ms < 0 ? '−' : '+';
  const tenths = Math.floor(Math.abs(ms) / 100);
  const totalSeconds = Math.floor(tenths / 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock =
    hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  return `${sign}${clock}.${tenths % 10}`;
}

/** "2026-10-24 14:02:11 UTC" */
export function formatUtcDateTime(iso: string): string {
  const date = parseDate(iso);
  if (!date) return iso;
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

/** "2026-10-24" (UTC) */
export function formatUtcDate(iso: string): string {
  const date = parseDate(iso);
  if (!date) return iso;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** "14:02:11.204" (UTC) */
export function formatUtcTime(iso: string): string {
  const date = parseDate(iso);
  if (!date) return iso;
  return (
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}` +
    `.${pad(date.getUTCMilliseconds(), 3)}`
  );
}

/** "Oct 24, 14:02 UTC" */
export function formatShortDateTime(iso: string): string {
  const date = parseDate(iso);
  if (!date) return iso;
  return (
    `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/** "820 B", "12.4 KB", "1.3 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Shortens long text for one-line previews and quotes. */
export function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}
