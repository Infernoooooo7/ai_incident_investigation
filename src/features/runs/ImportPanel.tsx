import { ClipboardPaste, FileUp, Inbox, Lock, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useStore } from '../../app/store';
import { MAX_IMPORT_BYTES, parseImportText, readImportFile } from '../../data/importRuns';
import type { ImportProblem } from '../../data/importRuns';
import type { LoadedRun } from '../../data/types';
import { cx } from '../../lib/cx';
import { SampleDownloadButton } from './SampleDownload';

export const PASTED_SOURCE = 'pasted JSON';

/** The outcome of one import action, which may cover several dropped files. */
export interface ImportAttempt {
  /** File names, or "pasted JSON". */
  sources: string[];
  runs: LoadedRun[];
  problems: Array<ImportProblem & { source: string }>;
}

type SourceText = { source: string; text: string } | { source: string; error: string };

interface ImportPanelProps {
  /** True when nothing has been imported yet; the panel then doubles as the empty state. */
  empty: boolean;
  onAttempt: (attempt: ImportAttempt) => void;
  onCancel?: () => void;
}

/**
 * Reads run JSON from a chosen file, a dropped file, or pasted text. Parsing
 * happens in this tab; nothing is uploaded or stored.
 */
export function ImportPanel({ empty, onAttempt, onCancel }: ImportPanelProps) {
  const { imports, addImports } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();
  const pasteId = useId();
  const pasteHintId = useId();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    if (pasteOpen) pasteRef.current?.focus();
  }, [pasteOpen]);

  const importTexts = (entries: SourceText[]) => {
    const existing = new Set(imports.map((loaded) => loaded.run.id));
    const importedAt = new Date().toISOString();
    const attempt: ImportAttempt = { sources: [], runs: [], problems: [] };
    for (const entry of entries) {
      attempt.sources.push(entry.source);
      if ('error' in entry) {
        attempt.problems.push({
          source: entry.source,
          label: 'file',
          issues: [{ path: '(file)', message: entry.error }],
        });
        continue;
      }
      const outcome = parseImportText(entry.text, existing, {
        fileName: entry.source,
        importedAt,
      });
      for (const loaded of outcome.runs) existing.add(loaded.run.id);
      attempt.runs.push(...outcome.runs);
      attempt.problems.push(
        ...outcome.problems.map((problem) => ({ ...problem, source: entry.source })),
      );
    }
    if (attempt.runs.length > 0) addImports(attempt.runs);
    onAttempt(attempt);
    return attempt;
  };

  const importFiles = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const entries = await Promise.all(
        files.map(async (file): Promise<SourceText> => {
          try {
            return { source: file.name, text: await readImportFile(file) };
          } catch (error) {
            return {
              source: file.name,
              error: error instanceof Error ? error.message : 'could not be read',
            };
          }
        }),
      );
      importTexts(entries);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const importPasted = () => {
    const size = new TextEncoder().encode(pasteText).length;
    const entry: SourceText =
      size > MAX_IMPORT_BYTES
        ? {
            source: PASTED_SOURCE,
            error: `is ${(size / (1024 * 1024)).toFixed(1)} MB; the import limit is 5 MB`,
          }
        : { source: PASTED_SOURCE, text: pasteText };
    const attempt = importTexts([entry]);
    if (attempt.runs.length > 0) {
      setPasteText('');
      setPasteOpen(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFiles([...event.dataTransfer.files]);
  };

  return (
    <section
      className={cx('import-panel', empty && 'import-panel--empty', dragging && 'is-dragging')}
      aria-labelledby={headingId}
    >
      {/* Drop target. Dragging is a pointer shortcut; the buttons below do the same by keyboard. */}
      <div
        className="import-panel__target"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div className="import-panel__intro">
          <span className="import-panel__icon" aria-hidden="true">
            <Inbox />
          </span>
          <div>
            <h2 id={headingId}>{empty ? 'No real runs imported yet' : 'Import a run'}</h2>
            <p>
              {empty
                ? 'Import a JSON trace exported from your agent to investigate it here. Imports are the only way real runs get into this app.'
                : 'Add another JSON trace. Runs with an ID that is already imported are reported instead of replacing the existing run.'}
            </p>
          </div>
          {onCancel && (
            <button type="button" className="icon-button import-panel__close" onClick={onCancel}>
              <X size={18} />
              <span className="visually-hidden">Close import</span>
            </button>
          )}
        </div>

        <div className="drop-zone">
          <FileUp className="drop-zone__icon" aria-hidden="true" />
          <p className="drop-zone__text">
            {dragging ? 'Drop to import' : 'Drop a .json file here, or'}
          </p>
          <div className="drop-zone__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp size={16} />
              {busy ? 'Reading file…' : 'Choose JSON file'}
            </button>
            <button
              type="button"
              className="button"
              aria-expanded={pasteOpen}
              aria-controls={pasteId}
              onClick={() => setPasteOpen((open) => !open)}
            >
              <ClipboardPaste size={16} />
              Paste JSON
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            data-testid="import-input"
            onChange={(event) => void importFiles([...(event.target.files ?? [])])}
          />
        </div>

        <div id={pasteId} className="paste-area" hidden={!pasteOpen}>
          <label htmlFor={`${pasteId}-text`} className="field-label">
            Run JSON
          </label>
          <p id={pasteHintId} className="field-hint">
            One run, a list of runs, or an object with a <code className="inline-code">runs</code>{' '}
            list.
          </p>
          <textarea
            id={`${pasteId}-text`}
            ref={pasteRef}
            className="paste-area__input"
            rows={8}
            spellCheck={false}
            autoComplete="off"
            aria-describedby={pasteHintId}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <div className="paste-area__actions">
            <button type="button" className="button button--primary" onClick={importPasted}>
              Import pasted JSON
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setPasteOpen(false);
                setPasteText('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="import-panel__footer">
          <p className="privacy-note">
            <Lock size={14} />
            Read in this browser tab only. Nothing is uploaded or saved, and imports are cleared
            when the tab closes.
          </p>
          <div className="import-panel__links">
            <SampleDownloadButton className="button--ghost button--small" />
            <a className="button button--ghost button--small" href="#/format">
              Import format
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
