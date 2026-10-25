/** Browser-only helpers for delivering exports. Kept apart from the pure report logic. */

export type ExportFormat = 'markdown' | 'json';

export const EXPORT_FORMATS: Record<
  ExportFormat,
  { label: string; extension: string; mimeType: string }
> = {
  markdown: { label: 'Markdown', extension: 'md', mimeType: 'text/markdown' },
  json: { label: 'JSON', extension: 'json', mimeType: 'application/json' },
};

export function reportFileName(runId: string, format: ExportFormat): string {
  const safeId = runId.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'run';
  return `incident-report-${safeId}.${EXPORT_FORMATS[format].extension}`;
}

/** Triggers a download of `content`. Throws with a readable message if the browser refuses. */
export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('This browser cannot create downloadable files. Use Copy instead.');
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the click has been handled so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is not available here. Use Download instead.');
  }
  await navigator.clipboard.writeText(text);
}
